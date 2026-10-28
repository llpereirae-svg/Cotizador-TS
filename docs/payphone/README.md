# Cajita de Payphone: preparación y simulación local

Este directorio describe un **prototipo**. Los archivos en
`integrations/payphone/` no cargan la Cajita, no se conectan con Payphone,
no aceptan credenciales y no procesan pagos. No son una implementación para
producción.

## Lo confirmado en la documentación oficial

- La Cajita se inserta en la página web. Al terminar, Payphone redirige a la
  URL de respuesta configurada por el comercio.
- El sistema del comercio confirma la transacción mediante una solicitud
  HTTP POST con `id` y `clientTxId`, y verifica su resultado.
- La aplicación de Payphone se configura en modo **PRUEBAS** o
  **PRODUCCIÓN**. La guía indica que, en pruebas, las transacciones se
  aprueban sin conectarse al procesador bancario. Para probar rechazos,
  demoras o interrupciones se necesitan simulaciones adicionales.
- La guía del comercio exige una cuenta Payphone Business activa, un usuario
  desarrollador, una aplicación web, Token, StoreID, dominio y URL de
  respuesta configurados.
- Payphone indica un reverso automático cuando un pago realizado no se
  confirma en los cinco minutos siguientes. Eso **no** demuestra que un
  pago con una respuesta demorada un minuto esté cancelado.

Fuentes oficiales: [Cajita de Pagos](https://docs.payphone.app/cajita-de-pagos)
y [Configuración de ambiente y credenciales](https://docs.payphone.app/configuracion-de-ambiente-y-credenciales).

## Límite importante antes de conectar

La documentación muestra el token de la aplicación en la configuración
JavaScript de la Cajita y también lo usa como credencial de confirmación. No
hemos comprobado que exista un token distinto, de uso público o de alcance
limitado. Hay que confirmar con Payphone el alcance del token y el mecanismo
correcto antes de integrarlo en una página accesible por terceros. No se debe
interpretar este prototipo como una solución comprobada para ocultarlo.

La guía presenta la selección de entorno en la configuración de la
aplicación; no hemos verificado un dominio de confirmación exclusivo de
pruebas. **Una URL por sí sola no garantiza que una credencial sea de prueba.**
Por esa razón, aquí no hay ningún cliente HTTP real ni configuración que
permita conectar con la pasarela. Antes de habilitarla, el desarrollador debe
verificar en la cuenta de Payphone que la aplicación y las credenciales
seleccionadas pertenecen inequívocamente al ambiente de pruebas, y revisar el
dominio y la URL de respuesta. No guardar credenciales en Git ni pegarlas en
el chat.

## Uso local

Desde la raíz del repositorio:

```powershell
node --test integrations/payphone/mock-gateway.test.mjs
```

La aplicación de PayPhone de prueba se puede configurar con el dominio local
`http://localhost:8131` y la página `http://localhost:8131/respuesta-payphone.html`
mientras se ejecute el servidor local indicado en el README principal. Esa página
es solo un marcador visual: **no procesa los parámetros de retorno ni confirma
pagos**. No debe utilizarse para realizar transacciones, ni siquiera de prueba,
hasta que exista una integración de confirmación comprobada en el backend.

El simulador requiere activar explícitamente el modo ficticio:

```js
import { createPayphoneSimulation } from './integrations/payphone/mock-gateway.mjs';

const pagos = createPayphoneSimulation({ mode: 'mock' });
const intento = pagos.createAttempt({
  renewalRef: 'renovacion-ejemplo',
  clientTransactionId: 'intento-ejemplo',
  amountCents: 3450,
  currency: 'USD'
});

pagos.markTimedOut(intento.clientTransactionId); // Sigue pendiente.
```

El retorno de Payphone se documenta con los parámetros `id` y
`clientTransactionId`; el cuerpo de confirmación usa `id` y
`clientTxId`. El módulo ofrece `buildConfirmBody` para construir ese
objeto. Los importes se expresan como enteros en centavos.

La función `applyMockConfirmation` recibe una respuesta ficticia preparada
por una prueba. Solo marca aprobación o cancelación cuando coinciden
identificador, referencia, monto, moneda y estado esperado. Una respuesta
ausente, desconocida o incongruente permanece pendiente. La salida no conserva
campos de tarjeta ni el detalle completo de la respuesta.

El simulador bloquea un segundo intento para la misma renovación mientras
hay uno pendiente o aprobado; una cancelación ficticia verificada permite
crear otro con un identificador nuevo. Estos controles están **solo en
memoria** y no sobreviven a reinicios ni funcionan entre instancias.

## Trabajo pendiente para la integración real

1. Acordar con el desarrollador el contrato del backend y el uso seguro de las
   credenciales de Payphone. La identidad, la renovación y el precio deben
   verificarse del lado del servidor.
2. Crear y conservar la intención de pago con un identificador único y estado
   persistente, con protección contra solicitudes repetidas.
3. Recibir el retorno, consultar la confirmación oficial desde el backend y
   comparar referencia, identificador, moneda y monto con la orden antes de
   activar la renovación o emitir la factura.
4. Si la respuesta tarda, mantener el intento pendiente, permitir salir de la
   pantalla y reconciliar su resultado. No anunciar que fue cancelado ni
   completar un segundo cobro hasta confirmar su estado.
5. Preparar por separado transferencia o depósito: banco, tipo, fecha,
   comprobante y verificación de correo, conservando el proceso de revisión
   que determine el negocio.
6. Tras comprobar configuración, dominio y credenciales de **pruebas**, usar
   únicamente datos ficticios autorizados por Payphone y verificar que no se
   produzcan cobros. Los resultados adversos deben ensayarse con mocks.
