import { DatabaseSync } from 'node:sqlite';
import { requiredText, positiveInteger } from '../integrations/payphone/protocol.mjs';

/**
 * Registro SQLite para ensayos locales. El archivo debe estar fuera del repo;
 * el responsable de la integración elige y protege su ubicación. Este módulo
 * no verifica el ambiente de PayPhone ni ejecuta solicitudes de red.
 */
export function createLocalAttemptStore({ filename } = {}) {
  if (typeof filename !== 'string' || !filename.trim()) {
    throw new TypeError('Se requiere una ruta SQLite explícita.');
  }
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sandbox_attempts (
      client_tx_id TEXT PRIMARY KEY,
      renewal_ref TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      monthly INTEGER NOT NULL CHECK (monthly > 0),
      currency TEXT NOT NULL,
      provider_id INTEGER,
      status TEXT NOT NULL CHECK (status IN ('reserved','confirming','pending','approved','canceled')),
      finalized INTEGER NOT NULL DEFAULT 0 CHECK (finalized IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS sandbox_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sandbox_manual_resolutions (
      client_tx_id TEXT PRIMARY KEY REFERENCES sandbox_attempts(client_tx_id),
      attestation TEXT NOT NULL CHECK (attestation IN ('no_transaction', 'canceled', 'not_submitted')),
      recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Las bases creadas antes no aceptaban la declaración not_submitted.
  // Migrar dentro de una transacción conserva todas las declaraciones previas.
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = db.prepare('PRAGMA table_info(sandbox_attempts)').all();
    if (!columns.some(column => column.name === 'finalized')) {
      db.exec('ALTER TABLE sandbox_attempts ADD COLUMN finalized INTEGER NOT NULL DEFAULT 0 CHECK (finalized IN (0, 1))');
    }
    if (!columns.some(column => column.name === 'payment_kind')) {
      db.exec("ALTER TABLE sandbox_attempts ADD COLUMN payment_kind TEXT NOT NULL DEFAULT 'cajita' CHECK (payment_kind IN ('cajita','button'))");
    }
    db.exec("DROP INDEX IF EXISTS sandbox_one_active_per_renewal; CREATE UNIQUE INDEX sandbox_one_active_per_renewal ON sandbox_attempts(renewal_ref) WHERE status != 'canceled' AND finalized = 0");
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sandbox_manual_resolutions'").get()?.sql;
    if (!schema) throw new Error('No se encontró el historial de declaraciones.');
    if (!schema.includes("'not_submitted'")) {
      db.exec(`
        CREATE TABLE sandbox_manual_resolutions_new (
          client_tx_id TEXT PRIMARY KEY REFERENCES sandbox_attempts(client_tx_id),
          attestation TEXT NOT NULL CHECK (attestation IN ('no_transaction', 'canceled', 'not_submitted')),
          recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO sandbox_manual_resolutions_new (client_tx_id, attestation, recorded_at)
          SELECT client_tx_id, attestation, recorded_at FROM sandbox_manual_resolutions;
        DROP TABLE sandbox_manual_resolutions;
        ALTER TABLE sandbox_manual_resolutions_new RENAME TO sandbox_manual_resolutions;
      `);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  const insert = db.prepare(`INSERT INTO sandbox_attempts
    (client_tx_id, renewal_ref, amount_cents, currency, monthly, payment_kind, status)
    VALUES (?, ?, ?, ?, ?, ?, 'reserved')`);
  const find = db.prepare(`SELECT client_tx_id AS clientTransactionId,
    renewal_ref AS renewalRef, amount_cents AS amountCents, currency, payment_kind AS paymentKind,
    provider_id AS providerTransactionId,
    CASE WHEN EXISTS (SELECT 1 FROM sandbox_manual_resolutions m WHERE m.client_tx_id = sandbox_attempts.client_tx_id)
      THEN 'closed_manually' ELSE status END AS status
    FROM sandbox_attempts WHERE client_tx_id = ?`);
  const take = db.prepare(`UPDATE sandbox_attempts SET provider_id = ?, status = 'confirming'
    WHERE client_tx_id = ? AND renewal_ref = ? AND status = 'reserved'`);
  const finish = db.prepare(`UPDATE sandbox_attempts SET status = ?
    WHERE client_tx_id = ? AND renewal_ref = ? AND provider_id = ? AND status = 'confirming'`);
  const findActive = db.prepare(`SELECT status, monthly, payment_kind AS paymentKind FROM sandbox_attempts WHERE renewal_ref = ? AND status != 'canceled' AND finalized = 0`);

  return Object.freeze({
    session(candidate) {
      const value = requiredText(candidate, 'session');
      db.prepare("INSERT OR IGNORE INTO sandbox_metadata(key, value) VALUES ('session', ?)").run(value);
      return db.prepare("SELECT value FROM sandbox_metadata WHERE key = 'session'").get().value;
    },
    active(renewalRef) {
      const result = findActive.get(requiredText(renewalRef, 'renewalRef'));
      return result ? { ...result } : null;
    },
    finalizeApproved(renewalRef) {
      return db.prepare("UPDATE sandbox_attempts SET finalized = 1 WHERE renewal_ref = ? AND status = 'approved' AND finalized = 0").run(requiredText(renewalRef, 'renewalRef')).changes === 1;
    },
    /** Reservar antes de mostrar la Cajita; no reutilizar una orden activa. */
    reserve(order) {
      const renewalRef = requiredText(order?.renewalRef, 'renewalRef');
      const clientTransactionId = requiredText(order?.clientTransactionId, 'clientTransactionId');
      const amountCents = positiveInteger(order?.amountCents, 'amountCents');
      const monthly = positiveInteger(order?.monthly, 'monthly');
      const currency = requiredText(order?.currency, 'currency');
      const paymentKind = order?.paymentKind ?? 'cajita';
      if (!['cajita', 'button'].includes(paymentKind)) throw new TypeError('Tipo de pago inválido.');
      if (currency !== 'USD' || clientTransactionId.length > 50) throw new TypeError('Orden inválida.');
      try {
        insert.run(clientTransactionId, renewalRef, amountCents, currency, monthly, paymentKind);
        return true;
      } catch (error) {
        if (error?.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(error.message)) return false;
        throw error;
      }
    },
    get(clientTransactionId) {
      const row = find.get(requiredText(clientTransactionId, 'clientTransactionId'));
      return row ? { ...row } : null;
    },
    /** Consulta local para cotejar el intento en el portal; no altera el estado. */
    recoveryCandidate(renewalRef) {
      const row = db.prepare(`SELECT client_tx_id AS clientTransactionId, status,
        provider_id AS providerTransactionId FROM sandbox_attempts
        WHERE renewal_ref = ? AND status != 'canceled' AND finalized = 0`).get(requiredText(renewalRef, 'renewalRef'));
      return row ? { ...row } : null;
    },
    /** Registra una declaración manual, no una confirmación automática del proveedor. */
    closeManually({ clientTransactionId, attestation } = {}) {
      const id = requiredText(clientTransactionId, 'clientTransactionId');
      if (!['no_transaction', 'canceled', 'not_submitted'].includes(attestation)) throw new TypeError('Declaración inválida.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT status, provider_id AS providerTransactionId FROM sandbox_attempts WHERE client_tx_id = ?').get(id);
        if (!row || row.status !== 'reserved' || row.providerTransactionId !== null) {
          db.exec('ROLLBACK');
          return false;
        }
        db.prepare('INSERT INTO sandbox_manual_resolutions (client_tx_id, attestation) VALUES (?, ?)').run(id, attestation);
        const result = db.prepare("UPDATE sandbox_attempts SET status = 'canceled' WHERE client_tx_id = ? AND status = 'reserved' AND provider_id IS NULL").run(id);
        if (result.changes !== 1) throw new Error('No se pudo cerrar la reserva.');
        db.exec('COMMIT');
        return true;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    /** La confirmación solo puede reclamar la reserva una vez. */
    claim(attempt) {
      const renewalRef = requiredText(attempt?.renewalRef, 'renewalRef');
      const clientTransactionId = requiredText(attempt?.clientTransactionId, 'clientTransactionId');
      const providerId = positiveInteger(attempt?.providerTransactionId, 'providerTransactionId');
      return take.run(providerId, clientTransactionId, renewalRef).changes === 1;
    },
    record(attempt) {
      const renewalRef = requiredText(attempt?.renewalRef, 'renewalRef');
      const clientTransactionId = requiredText(attempt?.clientTransactionId, 'clientTransactionId');
      const providerId = positiveInteger(attempt?.providerTransactionId, 'providerTransactionId');
      if (!['approved', 'pending', 'canceled'].includes(attempt?.status)) throw new TypeError('Estado inválido.');
      return finish.run(attempt.status, clientTransactionId, renewalRef, providerId).changes === 1;
    },
    close() { db.close(); }
  });
}
