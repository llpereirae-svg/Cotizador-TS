# Punto de integración para la Cajita de PayPhone

Esta carpeta prepara el **contrato y puente de montaje**, pero no carga el SDK,
no monta la Cajita por sí sola, no almacena credenciales y no realiza pagos ni
conexiones automáticamente. El backend definitivo se integra por separado. No
hay endpoints de negocio fijados.

## Configuración que necesita la Cajita

La [documentación oficial de la Cajita](https://docs.payphone.app/cajita-de-pagos)
describe el constructor `PPaymentButtonBox` y su método `render`. Sus recursos
se cargan desde PayPhone; este proyecto todavía no los carga automáticamente.
La configuración incluye el token, el identificador de tienda, un identificador
único de transacción y el desglose monetario **en centavos enteros**. El total
es la suma de base gravada, base no gravada, impuesto, servicio y propina.

`cajita-config.mjs` construye ese objeto desde una reserva que el backend ya
debe haber creado. Exige una declaración explícita del modo de prueba y un
origen local declarado; valida identificadores y montos, pero **no verifica por
sí mismo** el ambiente de la cuenta ni que la reserva sea auténtica o persistente.

`cajita-mount.mjs` ofrece `createSandboxCajitaMount`: el integrador debe
proporcionar explícitamente el constructor oficial `PPaymentButtonBox`, el
documento local y una función que solicite la reserva al backend. El puente
no carga la librería de PayPhone ni implementa esa función. Solo tras una
acción explícita puede invocarse `mount` con el identificador del contenedor;
el puente solicita la reserva, comprueba el objeto y llama a `render` del SDK
inyectado. La espera total está limitada a un minuto; si la reserva o el SDK no
responden, devuelve `pending`, retira el contenedor y no reintenta
automáticamente. Una vez montado, el SDK oficial puede efectuar solicitudes;
los tests inyectan un constructor falso y nunca cargan el SDK real. Retirar el
contenedor no confirma que PayPhone haya cancelado ni garantiza que un SDK
deje de procesar; el backend debe conciliar antes de otro intento.

El plazo cubre la función de reserva y el valor o promesa que devuelve
`render`. Si el SDK devuelve de inmediato y continúa trabajando por su cuenta,
este puente no detecta una espera posterior ni mide la operación de pago. El
backend y la interfaz deben vigilar el estado real, permitir salir y mantener
la operación pendiente hasta que pueda conciliarse.

El puente compara el origen declarado con el origen del documento y solo admite
un origen local. Esta comprobación en JavaScript no es una frontera de
seguridad: el servidor de prueba también debe limitarse a la interfaz local y
el backend debe verificar autenticación y autorización.

Ejemplo de conexión **orientativo y no ejecutable por sí solo**, después de
resolver los requisitos de seguridad y los contratos con el backend:

```js
import { createSandboxCajitaMount } from './cajita-mount.mjs';

const puente = createSandboxCajitaMount({
  mode: 'test',
  sandboxVerified: verificacionManualDelAmbiente,
  siteOrigin: window.location.origin,
  token: configuracionDePrueba.token,
  storeId: configuracionDePrueba.storeId,
  document,
  requestReservation: () => backend.reservarRenovacion(),
  widgetConstructor: window.PPaymentButtonBox
});

// Invocar en respuesta a una acción explícita, con el contenedor ya visible.
await puente.mount('pp-button');
```

Las variables de configuración y la función del backend son marcadores de
integración; no hay credenciales ni rutas implementadas en este repositorio.
El resultado `mounted` solo indica que se pidió mostrar la Cajita: no significa
que el pago esté aprobado ni que una renovación haya sido procesada.

Los bloqueos del puente solo existen en esa instancia del navegador. El backend
debe rechazar otra reserva para la misma renovación entre recargas, dispositivos
e instancias; el hecho de que el objeto recibido diga `reserved` no demuestra
que la reserva sea auténtica ni duradera. El ambiente de prueba declarado en
el código tampoco demuestra el ambiente efectivo de la credencial.

El campo `token` del objeto preparado es visible para el código del navegador
que recibe la configuración. La guía oficial usa el mismo token para la Cajita
y para confirmar. Antes de exponer cualquier credencial hay que confirmar con
PayPhone su alcance y las restricciones disponibles. No guardar credenciales
en Git, volcarlas en registros ni compartirlas en el chat.

## Lo que debe aportar el backend antes de un pago

1. Identificar y autorizar al cliente, crear una orden y calcular importes y
   vigencia en el servidor.
2. Reservar de forma atómica y duradera una sola operación activa por
   renovación **antes** de mostrar la Cajita, manteniéndola al recargar o en
   otra instancia. El frontend no sustituye este control.
3. Entregar una reserva con estado `reserved`, `clientTransactionId` único,
   `reference`, `currency`, `amount`, `amountWithoutTax`, `amountWithTax`,
   `tax`, `service` y `tip`. Estos nombres son una propuesta interna; deben
   acordarse con el desarrollador. Los importes definitivos provienen del
   backend, no de los valores que envíe el navegador.
4. Recibir el retorno, autenticar su relación con la orden y confirmar contra
   PayPhone desde el servidor, verificando identificadores, monto y moneda.
   `integrations/payphone/` contiene un adaptador ensayado con transporte falso,
   todavía sin transporte real ni almacenamiento de producción.
5. Conciliar respuestas inciertas y evitar otro cobro mientras uno esté
   pendiente. Un minuto de espera no garantiza que se haya cancelado.

La aplicación local registrada en PayPhone usa una página de retorno estática
de ejemplo. Esa página no procesa parámetros ni confirma pagos. Sustituirla por
un retorno real autenticado es obligatorio antes de cualquier transacción.

## Pruebas locales sin red

```powershell
node --test sandbox-payphone/cajita-config.test.mjs sandbox-payphone/cajita-mount.test.mjs
```

Los datos del test son ficticios. Para probar con la Cajita real deben primero
confirmarse con PayPhone el ambiente de prueba de la aplicación y credencial,
su dominio, el alcance del token visible y la disponibilidad de un probador.
La misma URL de la API no demuestra que la credencial pertenezca a pruebas.
Según PayPhone, las operaciones en su entorno de pruebas se aprueban; rechazos
y demoras deben cubrirse con simulaciones adicionales.
