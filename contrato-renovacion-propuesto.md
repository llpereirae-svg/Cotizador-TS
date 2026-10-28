# Contrato de renovación propuesto

**Propuesta no validada.** El backend y PayPhone deben confirmar el contrato, las reglas, los estados y las rutas antes de integrar. La vista actual es local: no realiza solicitudes, no envía comprobantes ni códigos y no procesa pagos.

## Identidad y cotización

El backend identifica la cuenta mediante un mecanismo seguro acordado y devuelve los datos que corresponde mostrar. Un RUC recibido en la URL no autoriza una renovación.

Hay dos entradas funcionales: la URL pública abre el cotizador sin requerir una cuenta; la opción Renovar dentro del ERP abre la renovación para la cuenta autenticada. El backend debe determinar la cuenta, comprobar que la persona tiene permiso para renovarla y entregar a la interfaz el RUC asociado. La maqueta utiliza un RUC ficticio: no consulta el ERP ni demuestra una sesión real.

Referencia de la captura del sistema anterior: la entrada de renovación al cotizador se observó como una petición GET con parámetros de RUC y nombre en la URL; el cálculo posterior se envió por POST a la misma página y recibió una respuesta parcial de JSF. Esta observación no demuestra cómo se obtiene o valida la identidad en el servidor, ni obliga a replicar esa ruta o el mecanismo JSF. No guardar URLs concretas con datos personales, cookies o valores de sesión. El contrato y la autenticación finales deben acordarse con el desarrollador del backend.

El backend debe calcular y validar la cotización y la vigencia definitiva. La interfaz puede mostrar una estimación provisional. Para las pruebas visuales se usa el patrón observado: seis dólares fijos más veinte centavos por documento anual, con IVA del 15 %. Esto no sustituye la tarifa configurada por el servidor.

## Código de correo

La interfaz necesita solicitar el envío de un código al correo asociado a la cuenta y comprobar el código. El servidor debe gestionar destino, vencimiento, reintentos y resultado. En la integración real la solicitud del código debe iniciarse solo después de que el backend confirme la carga del comprobante; seleccionar un archivo no es suficiente. El backend debe validar formato, contenido y tamaño (máximo 500,000 bytes). En la maqueta, tras validar los campos y pulsar Continuar, se abre una ventana con un código simulado; ningún archivo o correo sale del navegador. Si el comprobante cambia, debe invalidarse la verificación anterior. Tras la aprobación de la tarjeta, el correo y la ventana de verificación también dependen del backend de negocio; el ensayo local solo muestra una simulación.

### Ejemplos conceptuales para el código

Al solicitar el envío, el servidor identifica el destino desde la cuenta y puede devolver una referencia sintética como esta:

```json
{ "solicitudReferencia": "solicitud-de-ejemplo", "estado": "codigo_enviado" }
```

Para validar, la interfaz enviaría la referencia y el código proporcionado por el usuario:

```json
{ "solicitudReferencia": "solicitud-de-ejemplo", "codigo": "123456" }
```

Una respuesta de ejemplo podría ser:

```json
{ "estado": "verificado", "verificacionReferencia": "verificacion-de-ejemplo" }
```

Estos campos y estados son una propuesta, no una API existente. El código mostrado es ficticio. El backend debe vincular la verificación a la cuenta y a la operación correspondiente.

## Datos de renovación

Ejemplo conceptual de datos que la interfaz necesitaría entregar o confirmar; nombres y estructura pendientes de acuerdo:

```json
{
  "documentosPorMes": 10,
  "documentosPorAnio": 120,
  "fechaVencimiento": "2027-11-01",
  "metodoPago": "transferencia_o_deposito",
  "banco": "banco-pacifico-ahorros",
  "tipoOperacion": "transferencia",
  "fechaPago": "2026-11-01",
  "comprobanteReferencia": "referencia-de-ejemplo",
  "verificacionCorreoReferencia": "referencia-de-ejemplo"
}
```

El servidor debe validar la identidad y recalcular los importes, la cantidad anual y la fecha. La fecha mostrada por la maqueta es una estimación calculada localmente y no sustituye el vencimiento autorizado por el backend. Los identificadores de bancos son propuestos y deben acordarse con el backend. La referencia al comprobante y la verificación son ejemplos de contrato, no identificadores reales. La selección del archivo en la maqueta nunca sale del navegador. El mecanismo y las reglas de carga segura deben acordarse con el backend.

La maqueta distingue depósito y transferencia con `tipoOperacion`; no solicita tipo de depósito. Los nombres y valores son propuestos y deben acordarse y validarse con el backend antes de integrar.

## Tarjeta

La página reserva el contenedor visual `#payphone-container` para la integración oficial de PayPhone; actualmente no procesa ni solicita datos de tarjeta. El backend debe crear y confirmar la operación, proteger sus credenciales, conciliar el resultado y evitar cobros duplicados. Un timeout no equivale a cancelación: el resultado debe quedar pendiente hasta confirmar el estado o el reverso. No reintentar un cobro ni completar otro pago mientras no se resuelva el estado anterior, aunque se permita cambiar de método o salir. El backend debe mantener y verificar este estado entre recargas y dispositivos. La maqueta solo conserva el estado en memoria y su botón de cancelación confirmada es una simulación, no una consulta ni una cancelación real.

## Deuna

Deuna es un método previsto para una fase posterior. No aparece como opción en la interfaz, no se inicia ningún pago y aún faltan su integración y las definiciones del backend.

## Estados que el backend debe definir

Cotización disponible o inválida; comprobante recibido y pendiente de revisión; código enviado, verificado, vencido o inválido; pago de tarjeta pendiente, confirmado, rechazado o cancelado; renovación aceptada o rechazada. Las reglas de activación, emisión de factura, plazos y reversos deben ser verificadas con los responsables.

No hay rutas de API, credenciales, certificados ni números de cuenta definidos en este documento.

## Términos y condiciones

La interfaz incluye un borrador para revisión, no una versión contractual aprobada. Antes de producción, TributaSoft debe aprobar el texto y el backend debe registrar la aceptación de la versión correspondiente. En transferencia o depósito se pide aceptar antes de continuar; en tarjeta se pide antes de reservar y abrir la Cajita. Las casillas y el booleano del ensayo local no constituyen una aceptación legal persistente ni sustituyen el registro del backend.

El borrador presenta al proveedor y al cliente, el servicio, el precio, la revisión del pago y una cláusula informativa de protección de datos. Antes de publicarlo como contrato deben confirmarse la identificación legal y domicilio del proveedor, la identidad de la cuenta, los cargos, el responsable y canal de privacidad, las finalidades, bases de licitud, destinatarios, conservación y el contenido completo del aviso de privacidad. El equipo jurídico debe aprobar el texto y el mecanismo de registro de aceptación. La casilla contractual no sustituye automáticamente una base de licitud o consentimiento específico cuando corresponda.

Referencias para la revisión: [normativa de protección de datos de la SPDP](https://www.spdp.gob.ec/docs/proteccion-de-datos-personales/general/normativa/), [derechos de los titulares](https://www.spdp.gob.ec/docs/proteccion-de-datos-personales/cuales-son-mis-derechos/) y [bases de tratamiento en la LOPDP](https://www.spdp.gob.ec/docs/consultas-absueltas/2025-2/oficio-n-spdp-ird-2025-0090-o/).

## Pruebas locales de regresión

Con el servidor local descrito en el README y Playwright con Chromium instalado, ejecuta:

```powershell
node --test tests/renovacion-regresion.test.mjs
```

Si Playwright está instalado fuera de este proyecto, define `PLAYWRIGHT_MODULE_PATH` con la ruta al directorio del paquete antes de ejecutar la prueba. Se verificó con Playwright 1.64.1. La prueba solo acepta servidores locales y bloquea solicitudes externas.
