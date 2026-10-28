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
      status TEXT NOT NULL CHECK (status IN ('reserved','confirming','pending','approved','canceled'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sandbox_one_active_per_renewal
      ON sandbox_attempts(renewal_ref) WHERE status != 'canceled';
    CREATE TABLE IF NOT EXISTS sandbox_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const insert = db.prepare(`INSERT INTO sandbox_attempts
    (client_tx_id, renewal_ref, amount_cents, currency, monthly, status)
    VALUES (?, ?, ?, ?, ?, 'reserved')`);
  const find = db.prepare(`SELECT client_tx_id AS clientTransactionId,
    renewal_ref AS renewalRef, amount_cents AS amountCents, currency,
    provider_id AS providerTransactionId, status
    FROM sandbox_attempts WHERE client_tx_id = ?`);
  const take = db.prepare(`UPDATE sandbox_attempts SET provider_id = ?, status = 'confirming'
    WHERE client_tx_id = ? AND renewal_ref = ? AND status = 'reserved'`);
  const finish = db.prepare(`UPDATE sandbox_attempts SET status = ?
    WHERE client_tx_id = ? AND renewal_ref = ? AND provider_id = ? AND status = 'confirming'`);
  const findActive = db.prepare(`SELECT status, monthly FROM sandbox_attempts WHERE renewal_ref = ? AND status != 'canceled'`);

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
    /** Reservar antes de mostrar la Cajita; no reutilizar una orden activa. */
    reserve(order) {
      const renewalRef = requiredText(order?.renewalRef, 'renewalRef');
      const clientTransactionId = requiredText(order?.clientTransactionId, 'clientTransactionId');
      const amountCents = positiveInteger(order?.amountCents, 'amountCents');
      const monthly = positiveInteger(order?.monthly, 'monthly');
      const currency = requiredText(order?.currency, 'currency');
      if (currency !== 'USD' || clientTransactionId.length > 50) throw new TypeError('Orden inválida.');
      try {
        insert.run(clientTransactionId, renewalRef, amountCents, currency, monthly);
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
