import { createServer } from 'node:net';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createLocalAttemptStore } from './local-store.mjs';

/** Diálogo con inyección explícita de almacén y terminal para pruebas aisladas. */
export async function recoveryDialogue({ store, input = stdin, output = stdout }) {
  const say = message => output.write(`${message}\n`);
  const candidate = store.recoveryCandidate('demo-unica');
  if (!candidate) {
    say('No hay ninguna reserva activa. No se cambió nada.');
  } else if (candidate.status !== 'reserved' || candidate.providerTransactionId !== null) {
    say('Esta operación no puede cerrarse manualmente. Sigue bloqueada; revisa su estado con PayPhone.');
  } else {
    say(`Identificador de la orden de prueba: ${candidate.clientTransactionId}`);
    say('Verifica con PayPhone, usando ese identificador, que no existe transacción o que está cancelada.');
    say('Un error visible en la Cajita, cerrar la ventana o esperar no confirma el resultado.');
    const prompt = createInterface({ input, output });
    try {
      const answer = (await prompt.question('Escribe NO EXISTE o CANCELADA solo después de verificarlo; Enter para salir: ')).trim();
      const attestation = answer === 'NO EXISTE' ? 'no_transaction' : answer === 'CANCELADA' ? 'canceled' : null;
      if (!attestation) {
        say('Sin declaración de verificación; la reserva sigue bloqueada.');
      } else if (store.closeManually({ clientTransactionId: candidate.clientTransactionId, attestation })) {
        say('Cierre manual registrado en el historial local. Ahora puedes iniciar otra orden de prueba.');
      } else {
        say('El estado cambió; la reserva sigue bloqueada. Consulta con PayPhone.');
      }
    } finally { prompt.close(); }
  }
}

async function main() {
  // Se reserva el mismo puerto del ensayo para impedir la recuperación con el
  // servidor abierto y la Cajita anterior aún accesible.
  const lock = createServer();
  try {
    await new Promise((resolve, reject) => {
      lock.once('error', reject);
      lock.listen(8131, '127.0.0.1', resolve);
    });
  } catch {
    console.error('El puerto 8131 está ocupado. Cierra la Cajita y detén el servidor de ensayo antes de continuar.');
    process.exitCode = 1;
    return;
  }
  let store;
  try {
    const dbPath = join(tmpdir(), 'tributasoft-payphone-local', 'attempts.sqlite');
    if (!existsSync(dbPath)) throw new Error('No existe una base local de ensayos.');
    store = createLocalAttemptStore({ filename: dbPath });
    await recoveryDialogue({ store });
  } catch {
    console.error('No se pudo completar la revisión local. No inicies otra operación.');
    process.exitCode = 1;
  } finally {
    store?.close();
    await new Promise(resolve => lock.close(resolve));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
