# Producto

<!-- impeccable:product-schema 1 -->

## Plataforma

Web adaptable a celular y computadora.

## Usuarios y propósito

- El público consulta una estimación para un plan anual de facturación electrónica.
- Los clientes existentes pueden renovar su servicio después de identificarse mediante el backend.

## Flujo y restricciones

- El cálculo observado en cuatro pruebas usa seis dólares fijos más veinte centavos por documento anual; las pruebas mostraron un IVA del 15 %. El backend debe determinar la tarifa y la vigencia definitivas.
- La renovación contempla transferencia o depósito con comprobante y verificación por correo, y tarjeta mediante la Cajita de PayPhone.
- La maqueta solo simula datos, correo y pagos. No envía información ni procesa transacciones.
- Ante un pago de tarjeta sin resultado confirmado, la operación debe permanecer pendiente hasta su conciliación; el backend real debe evitar cobros duplicados.
- Las credenciales, la identidad del cliente, el precio definitivo y los estados de pago deben gestionarse de forma segura en la integración real. No se han definido rutas de API definitivas.

## Identidad

Mantener la identidad visual de la página de registro de TributaSoft, con sus colores, logotipo y tipografías, en una interfaz clara y sobria.

## Implementación actual

La vista previa usa HTML, CSS y JavaScript estáticos; la simulación aislada de pagos tiene pruebas con Node.js. El backend y el entorno de despliegue finales aún no están definidos.
