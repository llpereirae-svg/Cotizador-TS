# Cotizador TributaSoft · vista previa

Esta copia contiene propuestas visuales locales con datos ficticios. No realiza pagos, consultas de clientes, envío de correos ni cargas de archivos.

Para servir el proyecto en Windows desde esta carpeta:

```powershell
python -m http.server 8131 --bind 127.0.0.1
```

Abre en el navegador la vista disponible en tu rama: `http://127.0.0.1:8131/cotizacion.html` para cotización o `http://127.0.0.1:8131/renovacion.html` para renovación. Para detener el servidor, pulsa Ctrl+C en la terminal.

Los archivos comunes están en `assets/`. Cada vista tiene sus propios HTML, CSS y JavaScript para facilitar su trabajo en ramas separadas. El adaptador de renovación es local y simulado; el contrato propuesto de backend se documenta en la rama de renovación.

Para instalar las herramientas de prueba y verificar el cálculo:

```powershell
npm ci
npm test
```

En la rama de renovación, el contrato propuesto describe las pruebas con Playwright y la documentación de PayPhone explica las pruebas del simulador local.

La tarifa y el IVA de la maqueta son ejemplos observados y el servidor debe confirmar las reglas vigentes.

## Procedencia visual

- Foco de marca: [imagen publicada en el registro de TributaSoft](https://signup.tributasoft.ec/assets/Logo%20TributaSoft.png).
- Avenida: [fuente publicada en el registro de TributaSoft](https://signup.tributasoft.ec/assets/Avenida.otf).
- Inter: [archivo latino de Google Fonts](https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2), con su licencia incluida en `assets/fonts/Inter-LICENSE.txt`.
- DM Sans: [archivo latino de Google Fonts](https://fonts.gstatic.com/s/dmsans/v17/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2), con su licencia incluida en `assets/fonts/DM-Sans-LICENSE.txt`.
- Lobster: [archivo latino de Google Fonts](https://fonts.gstatic.com/s/lobster/v32/neILzCirqoswsqX9zoKmMw.woff2), con su licencia incluida en `assets/fonts/Lobster-LICENSE.txt`.

Los archivos de licencia de Inter, DM Sans y Lobster indican SIL Open Font License 1.1. No se encontró una licencia para Avenida ni para el logo; debe confirmarse su autorización de uso antes de publicar o redistribuir esta copia.
