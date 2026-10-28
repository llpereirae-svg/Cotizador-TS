# Contrato de renovación propuesto

**Propuesta no validada.** El backend y PayPhone deben confirmar el contrato, las reglas, los estados y las rutas antes de integrar. La vista actual es local: no realiza solicitudes, no envía comprobantes ni códigos y no procesa pagos.

## Identidad y cotización

El backend identifica la cuenta mediante un mecanismo seguro acordado y devuelve los datos que corresponde mostrar. Un RUC recibido en la URL no autoriza una renovación.

El backend debe calcular y validar la cotización y la vigencia definitiva. La interfaz puede mostrar una estimación provisional. Para las pruebas visuales se usa el patrón observado: seis dólares fijos más veinte centavos por documento anual, con IVA del 15 %. Esto no sustituye la tarifa configurada por el servidor.

## Código de correo

La interfaz necesita solicitar el envío de un código al correo asociado a la cuenta y comprobar el código. El servidor debe gestionar destino, vencimiento, reintentos y resultado. En la integración real la solicitud del código debe iniciarse solo después de que el backend confirme la carga del comprobante; seleccionar un archivo no es suficiente. El backend debe validar formato, contenido y tamaño (máximo 500,000 bytes). En la maqueta la solicitud es simulada al seleccionar un JPG, JPEG, PNG o PDF válido y ningún archivo sale del navegador. Si el comprobante cambia, debe invalidarse la verificación anterior. En la maqueta las operaciones son locales, no envían correo y solo aceptan el código de ejemplo mostrado.

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

Si `tipoOperacion` es `deposito`, la maqueta requiere además `tipoDeposito`, con valor `cheque` o `efectivo`. Este campo no se incluye para una transferencia. Los nombres y valores son propuestos; el backend debe acordarlos y validarlos antes de la integración.

## Tarjeta

La página reserva el contenedor visual `#payphone-container` para la integración oficial de PayPhone; actualmente no procesa ni solicita datos de tarjeta. El backend debe crear y confirmar la operación, proteger sus credenciales, conciliar el resultado y evitar cobros duplicados. Un timeout no equivale a cancelación: el resultado debe quedar pendiente hasta confirmar el estado o el reverso. No reintentar un cobro ni completar otro pago mientras no se resuelva el estado anterior, aunque se permita cambiar de método o salir. El backend debe mantener y verificar este estado entre recargas y dispositivos. La maqueta solo conserva el estado en memoria y su botón de cancelación confirmada es una simulación, no una consulta ni una cancelación real.

## Estados que el backend debe definir

Cotización disponible o inválida; comprobante recibido y pendiente de revisión; código enviado, verificado, vencido o inválido; pago de tarjeta pendiente, confirmado, rechazado o cancelado; renovación aceptada o rechazada. Las reglas de activación, emisión de factura, plazos y reversos deben ser verificadas con los responsables.

No hay rutas de API, credenciales, certificados ni números de cuenta definidos en este documento.

## Términos y condiciones

El documento de términos y su aceptación real están pendientes de integración. La casilla de la maqueta solo reconoce que se está usando una vista de prueba; no representa una aceptación legal.

## Pruebas locales de regresión

Con el servidor local descrito en el README y Playwright con Chromium instalado, ejecuta:

```powershell
node --test tests/renovacion-regresion.test.mjs
```

Si Playwright está instalado fuera de este proyecto, define `PLAYWRIGHT_MODULE_PATH` con la ruta al directorio del paquete antes de ejecutar la prueba. Se verificó con Playwright 1.64.1. La prueba solo acepta servidores locales y bloquea solicitudes externas.
