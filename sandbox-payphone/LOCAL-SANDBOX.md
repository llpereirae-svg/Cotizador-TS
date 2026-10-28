# Ensayo local de la Cajita PayPhone

Este servidor independiente prepara una única orden ficticia, sirve la Cajita
oficial y procesa su retorno con la confirmación de PayPhone. Es solo para una
aplicación y credenciales **verificadas en Prueba**. No está conectado con la
página pública de GitHub Pages ni con el backend o servicios de producción.

Antes de comenzar, el responsable debe verificar en PayPhone Developer que la
aplicación y el token correspondan al entorno de pruebas y que el probador esté
habilitado. La URL de la API no identifica por sí misma el ambiente. El token
se entrega al navegador porque la Cajita oficial lo requiere y también se usa
para confirmar; su alcance completo no se ha confirmado con PayPhone. Usar
solo un equipo privado y una credencial de prueba; no guardarla en Git, no
pegarla en chat ni usar credenciales de producción.

El dominio y retorno de la aplicación deben coincidir con `http://localhost:8131`
y `http://localhost:8131/respuesta-payphone.html`. El puerto 8131 debe estar
libre. Detén normalmente cualquier servidor anterior con Ctrl+C. Se necesita
Node con `node:sqlite`, por ejemplo Node 24.

Desde una terminal privada ubicada en la carpeta del repositorio, ejecuta el
lanzador. Comprueba el puerto antes de solicitar credenciales y pide el token
sin mostrarlo. Los datos no se guardan en Git ni en ningún archivo:

```powershell
powershell -ExecutionPolicy Bypass -File .\sandbox-payphone\iniciar-prueba.ps1
```

Abre `http://localhost:8131/renovacion.html` en **esta computadora**, elige una
cantidad de documentos y la pestaña TC/TD. Al pulsar «Preparar Cajita de prueba»
el servidor recalcula el importe de la orden de demostración, crea una reserva
persistente y carga el SDK oficial; introducir datos y finalizar el pago requiere
una acción adicional de la persona probadora. La transferencia y el correo
continúan simulados y el cliente es ficticio: no hay autenticación ni renovación
real. También está disponible la página mínima `http://localhost:8131/sandbox-payphone`
con una orden fija para diagnóstico. No pegues números de tarjeta en el chat. Detén el servidor
con Ctrl+C al terminar; el lanzador limpia sus variables de entorno al salir.
El entorno de prueba de PayPhone, según su documentación,
no se conecta a bancos; nuestro código no puede comprobar si el token ingresado
pertenece realmente a ese entorno.

La base SQLite se crea en una carpeta temporal del sistema, fuera del repo. Se
mantiene una sola orden de demostración activa: recargas o procesos adicionales
no habilitan un pago duplicado. Si la respuesta es desconocida o se agota la
espera, queda bloqueada para conciliación. Ocultar la Cajita tras un minuto no
confirma cancelación. El proveedor documenta reversión automática si una
transacción no se confirma en cinco minutos, pero el estado debe comprobarse.
No borres ni restablezcas una orden pendiente para reintentar sin verificarla.
Si la Cajita no llega a abrir por un error de configuración, cierra la pestaña y
detén el servidor con Ctrl+C. Puedes revisar el identificador del intento con:

```powershell
node .\sandbox-payphone\recuperar-ensayo.mjs
```

El programa mostrará el identificador de la orden y pedirá una declaración
manual. Antes de responder, verifica con PayPhone usando ese identificador que
no existe ninguna transacción o que está cancelada. Un mensaje de error, una
lista vacía sin verificar el ambiente, cerrar el navegador o esperar no son por
sí solos confirmación. Si no puedes verificarlo, pulsa Enter: la orden seguirá
bloqueada. Si la confirmación es concluyente, escribe `NO EXISTE` o `CANCELADA`,
según corresponda. El cierre se conserva como declaración manual en el historial;
no se presenta como confirmación automática de PayPhone. Solo se admite para
reservas sin ID de proveedor; estados que ya se están confirmando, pendientes
con ID o aprobados siguen bloqueados. La herramienta no funciona mientras el
servidor usa el puerto 8131. Cierra también cualquier otra pestaña de la Cajita.

El estado aprobado también bloquea otra orden para la misma demostración. El
servidor restaura la sesión local tras un reinicio para que el mismo navegador
pueda confirmar el retorno pendiente; conservar la URL de retorno si el
navegador no la vuelve a abrir automáticamente.

Esta versión no ofrece aún un botón para crear una segunda orden ficticia tras
la aprobación. Para repetir el ensayo, el desarrollador debe implementar una
nueva referencia de orden de prueba y conservar el historial; no debe borrar
ni desbloquear transacciones pendientes. No se elimina la base como atajo.

Este ensayo no reemplaza autenticación real de clientes, contratos del negocio,
notificaciones, conciliación operativa ni backend de producción. El retorno se
confirma en servidor y compara identificadores, importe, moneda y estado, pero
debe probarse con las respuestas reales del entorno de PayPhone antes de darlo
por compatible. El almacenamiento SQLite es solo para un equipo y no debe
reutilizarse como arquitectura de producción.

Pruebas sin red ni credenciales:

```powershell
node --test sandbox-payphone/*.test.mjs integrations/payphone/*.test.mjs
```

Referencias: [Cajita oficial](https://docs.payphone.app/cajita-de-pagos) y
[configuración del ambiente](https://docs.payphone.app/configuracion-de-ambiente-y-credenciales).
