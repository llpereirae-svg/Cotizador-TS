# Cajita de Payphone: preparación y simulación local

## Estados y errores de la confirmación

La documentación oficial de la Cajita indica que la confirmación devuelve `statusCode` 3 y `transactionStatus` `Approved` para una operación aprobada, o `statusCode` 2 y `transactionStatus` `Canceled` para una cancelada. El backend debe cotejar además los identificadores, el importe y la moneda con la orden antes de aceptar el resultado.

Una respuesta HTTP exitosa no demuestra por sí sola que el pago haya sido aprobado. Un timeout, error de red, respuesta incompleta o datos discordantes dejan el resultado **pendiente de conciliación**; no se debe asumir cancelación ni iniciar otro cobro para esa orden. La documentación de PayPhone presenta, por ejemplo, `errorCode` 20 cuando no encuentra la transacción; ese error por sí solo no demuestra que otro intento sea seguro.

PayPhone documenta un reverso automático si una transacción no se confirma dentro de cinco minutos. Una espera de un minuto en la interfaz no demuestra que se haya producido el reverso: el backend debe verificar el estado.

Referencias oficiales: [Cajita de pagos](https://docs.payphone.app/cajita-de-pagos) y [códigos de error](https://docs.payphone.app/codigos-de-error).

Este directorio describe un **prototipo**, no una implementación para
producción. El simulador no usa red ni credenciales. El adaptador de
confirmación acepta un token y un transporte inyectado; no se suministra
ninguno de los dos ni se realizan conexiones por defecto. Si se le inyecta
un transporte real y una credencial inadecuada, podría conectarse al servicio
real: no debe hacerse antes de verificar el ambiente y el diseño de seguridad.

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
El adaptador de confirmación construye la solicitud oficial, pero no incluye
transporte HTTP ni credenciales y no se conecta por sí solo. Requiere declarar
modo de prueba y verificación explícita de la cuenta. Esas banderas son una
medida operativa: **no pueden comprobar por sí mismas** que el token sea de
pruebas. Un integrador podría inyectar un transporte real, por lo que no debe
hacerlo hasta verificar inequívocamente el ambiente de la aplicación, el dominio,
la URL de respuesta y las credenciales con Payphone. No guardar credenciales
en Git ni pegarlas en el chat.

## Uso local

Desde la raíz del repositorio:

```powershell
node --test integrations/payphone/mock-gateway.test.mjs integrations/payphone/confirmation-client.test.mjs
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

## Solicitud de confirmación preparada, sin transporte real

`integrations/payphone/confirmation-client.mjs` construye la solicitud oficial
`POST` de Confirm con el cuerpo `id` y `clientTxId`, y utiliza la respuesta
para comparar identificadores, monto en centavos y moneda con una orden
confiable del backend. Requiere:

- `mode: 'test'` y `sandboxVerified: true`; ambos faltan por defecto.
- Token obtenido fuera del repositorio, sin imprimirlo ni transmitirlo en
  logs, capturas, mensajes de error o respuestas al navegador.
- Un `transport` inyectado. No se proporciona ningún transporte de red.
  Su contrato es recibir `{ url, method, headers, json, signal }` y devolver
  `{ httpStatus, data }`; las pruebas usan uno falso que nunca abre la red.
- Un `attemptStore` inyectado con `claim(attempt)` y `record(attempt)`.
  Ambos deben devolver `true` solo tras completar su operación de forma
  atómica y persistente. Antes de devolver `true`, `claim` debe registrar
  la renovación, ambos identificadores y el estado pendiente, además de
  bloquear la transacción y la renovación entre instancias. Si el proveedor
  no responde, no se llamará a `record`: esos datos persistidos son necesarios
  para conciliar. `false` debe significar
  inequívocamente que esa llamada no adquirió reserva alguna; un error, timeout
  o valor ambiguo no debe convertirse en `false`. Un resultado incierto debe
  seguir bloqueado hasta su reconciliación. El almacén de las pruebas es de
  memoria y no cumple estos requisitos de producción.

**La exclusión debe comenzar antes de crear el intento y de mostrar la
Cajita**, cuando el backend reserva una sola operación activa por renovación.
Este adaptador participa solo en la confirmación posterior: no impide que ya
se hayan iniciado dos cobros. El almacén debe distinguir la reserva existente
de la orden y el permiso de confirmar esa misma operación, conservando ambos
de forma atómica y persistente. La prueba de almacén en memoria solo ilustra
la interfaz; no implementa la reserva previa ni demuestra seguridad entre
servidores.

El retorno de Payphone llega con parámetros controlables desde una URL. Antes
de reclamar el intento, el backend debe autenticar y vincular la solicitud con
la orden legítima. Un identificador inválido o una respuesta ambigua puede
dejar el intento bloqueado de forma conservadora; es necesaria una vía de
consulta y conciliación acordada con Payphone y el backend. Este adaptador no
autentica al usuario, no determina por sí mismo el resultado de ese caso y no
reintenta la confirmación automáticamente.

La configuración y el token residen en el backend, pero el SDK oficial de la
Cajita solicita un token en el navegador: su alcance y tratamiento seguro
siguen pendientes de aclaración con Payphone.

El adaptador espera hasta un minuto en total. Si falla o vence la espera,
el estado queda pendiente y no repite la confirmación automáticamente. Una
operación inyectada que no responda a la señal de cancelación podría seguir
ejecutándose después: el timeout no prueba que la solicitud no llegó ni que
el pago se canceló. La aplicación debe consultar y reconciliar el estado con
datos persistentes antes de aceptar otro cobro.

El bloqueo adicional de esta implementación se conserva en memoria. Si el
almacén responde `false` de forma inequívoca, se liberan las claves locales
adquiridas por esa llamada; el almacén sigue decidiendo si otro intento puede
continuar. Ante errores, timeout o valores ambiguos se mantienen bloqueadas.
Si una operación que esta instancia sí adquirió se resuelve en otra instancia,
el bloqueo local puede persistir hasta reiniciarla. Este control no sustituye
la recuperación del backend y requiere revisión antes de usarse en un servidor
persistente.
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
