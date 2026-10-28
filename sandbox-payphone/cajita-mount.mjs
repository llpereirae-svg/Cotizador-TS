import { assertSandboxContext, buildSandboxCajitaConfig } from './cajita-config.mjs';

async function beforeDeadline(operation, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return { kind: 'timeout' };
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation).then(value => ({ kind: 'ok', value }), () => ({ kind: 'error' })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ kind: 'timeout' }), remaining); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Puente deliberadamente inerte hasta que el integrador inyecte el constructor
 * oficial, un documento local y una función del backend que cree la reserva.
 * No carga scripts, lee credenciales ni contiene transporte de red propio.
 * Los controles del navegador NO son una frontera de seguridad: el backend
 * debe reservar atómicamente antes de autorizar la apertura de la Cajita.
 */
export function createSandboxCajitaMount({
  mode, sandboxVerified, siteOrigin, token, storeId,
  document: pageDocument, requestReservation, widgetConstructor, timeoutMs = 60000
} = {}) {
  const context = { mode, sandboxVerified, siteOrigin, token, storeId };
  assertSandboxContext(context);
  const actualOrigin = pageDocument?.defaultView?.location?.origin;
  if (typeof actualOrigin !== 'string' || actualOrigin !== new URL(siteOrigin).origin ||
      typeof pageDocument.getElementById !== 'function') {
    throw new Error('La Cajita de prueba requiere el documento local configurado.');
  }
  if (typeof requestReservation !== 'function' || typeof widgetConstructor !== 'function') {
    throw new Error('Faltan la reserva del backend o el constructor oficial de la Cajita.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
    throw new RangeError('La espera debe estar entre 1 y 60000 milisegundos.');
  }

  let attempted = false;
  return Object.freeze({
    /** Ejecutar solo tras una acción explícita del usuario. */
    async mount(containerId) {
      if (attempted) throw new Error('La operación ya fue iniciada; verifica su estado antes de reintentar.');
      const container = typeof containerId === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(containerId)
        ? pageDocument.getElementById(containerId) : null;
      if (!container || typeof container.remove !== 'function') {
        throw new Error('Contenedor de pago inválido.');
      }

      // Un error o timeout después de iniciar la reserva puede ser ambiguo.
      // El backend conserva la reserva y decide cuándo es seguro reintentar.
      attempted = true;
      const deadline = Date.now() + timeoutMs;
      const pending = reason => {
        // Impide interactuar con contenido que el SDK pueda añadir tarde al
        // contenedor. No implica que PayPhone haya cancelado la transacción.
        try { container.remove(); } catch { /* El backend sigue conciliando. */ }
        return { status: 'pending', reason };
      };
      try {
        const reservationResult = await beforeDeadline(() => requestReservation(), deadline);
        if (reservationResult.kind === 'timeout') return pending('reservation_timeout');
        if (reservationResult.kind !== 'ok') return pending('reservation_error');
        const config = buildSandboxCajitaConfig({ ...context, reservation: reservationResult.value });
        const widget = new widgetConstructor(config);
        if (!widget || typeof widget.render !== 'function') throw new Error('SDK inválido.');
        const renderResult = await beforeDeadline(() => widget.render(containerId), deadline);
        if (renderResult.kind === 'timeout') return pending('sdk_timeout');
        if (renderResult.kind !== 'ok') return pending('sdk_error');
        return { status: 'mounted' };
      } catch {
        // No propagar respuestas ni excepciones de dependencias que pudieran
        // incluir credenciales o datos de la transacción.
        return pending('integration_error');
      }
    }
  });
}
