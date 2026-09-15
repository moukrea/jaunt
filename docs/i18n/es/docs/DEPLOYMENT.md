[English](../../../DEPLOYMENT.md) · [fr](../../fr/docs/DEPLOYMENT.md) · [es](DEPLOYMENT.md) · [it](../../it/docs/DEPLOYMENT.md) · [pt](../../pt/docs/DEPLOYMENT.md) · [de](../../de/docs/DEPLOYMENT.md)

# Despliegue de los contenedores

Los usuarios finales solo instalan el host. El propietario **proyecto** despliega estos dos componentes una vez:

1. Páginas GitHub: HTML, JavaScript, CSS, logo, instalador y configuración pública.
2. Cloudflare Worker with a SQLite Durable Object: WebSocket relay. No lo reemplace con un trabajo de GitHub Actions, un túnel personal u otros servidores públicos del proyecto.

## Preparación

Preserve el repositorio existente en una rama de copia de seguridad, luego integre los archivos en una rama de trabajo. No sobreescriba la historia o la fuerza-push. Instalar Python y Node 22+, luego corre `pip install -e . -r requirements-dev.txt`, `npm ci`, y `npm run prepare-web`. La construcción copias jsQR 1.4.0 y su licencia localmente y genera una versión PWA Encomendar a la auténtica solución `package-lock.json` y revisar licencias; nunca inventar un archivo de bloqueo.

Las herramientas de desplegamiento se fijan y el archivo de bloqueo resuelto se comete. El punto/vacío anula la dirección de los asesores conocidos en la dependencia de prueba Miniflare 4; vea [VALIDATION.md](VALIDATION.md).

## Relay

- Cree o seleccione una cuenta Cloudflare autorizada para los trabajadores y objetos duraderos SQLite. Compruebe los términos y cuotas actuales de la cuenta.
- Autorizar al agente a desplegar, o establecer secretos de acción `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` a través de la interfaz segura de GitHub. El token debe permitir el despliegue del trabajador y la migración de objetos duraderos en esa cuenta.
- `relay.yml` ejecuta Wrangler con `relay/wrangler.jsonc`: nombre inicial `jaunt-relay`, unión `ROOMS`, clase `Room`, migración SQLite `v1`.
- APP_ORIGIN debe ser `https://moukrea.github.io` (el origen, sin `/jaunt/`). No utilizar `*` en producción. `config.json` debe contener la realidad del trabajador WSS URL, sin un apéndice `/v1/room/...` camino; el cliente construye ese camino.
- Verificar `/health`, luego ** emparejamiento real y un comando cifrado**. Una respuesta sanitaria HTTP 200 no valida WebSockets.

## Host, escritorio y Android libera, entonces Páginas

1. Pass CI. Cree la etiqueta host, actualmente `v0.1.0-beta.10` (Python versión `0.1.0b10`). El flujo de trabajo de lanzamiento construye la rueda y la publica con `host-manifest.json` y `SHA256SUMS`. Las versiones de Beta están marcadas explícitamente como pre-releases. Nunca sobreescribir los activos de una versión existente.
2. Para Android, publique la etiqueta, actualmente `android-v0.1.0-beta.7`, con su APK firmado, `SIGNING-CERTIFICATE.txt`, y `SHA256SUMS`; verifique los activos públicos. Mantenga la misma clave de firma para actualizaciones.
3. Publicar `desktop-v0.1.0-beta.9`: Linux x64/ARM64 archivos, paquetes deb/rpm, macOS x64/ARM64 paquetes zip/dmg, y `SHA256SUMS`. Verificar los archivos públicos antes de publicarlos. El paquete Linux debe retener el soporte de caja de arena de cromo; macOS
4. Establecer variables de repositorio `jaunt_RELAY_URL` (actual WSS URL), `jaunt_RELEASE_TAG` (`v0.1.0-beta.10`), `jaunt_ANDROID_RELEASE_TAG` (`android-v0.1.0-beta.7`), `jaunt_DESKTOP_RELEASE_TAG` (`desktop-v0.1.0-beta.9`), y opcionalmente `jaunt_PAGE_URL` (predeterminados a la página URL del repositorio).
5. Activar Páginas en modo GitHub Acciones. `pages.yml` construye la aplicación web, valida la configuración, copia el instalador y la publica.
6. No ejecute Páginas con una liberación inexistente. El impulso de implementación requiere este orden.

## Pruebas de aceptación remota requeridas

En una Linux máquina sin un puerto entrante expuesto: instalar desde la página publicada, escanear el QR código en Chrome Android, crear un shell, ejecutar un comando, subir y descargar un archivo, pegar una imagen, probar ambos modos de imagen de acuerdo con las capacidades de host, cerrar / reabrir PWA, cambio Wi-Fi/Moviles redes, volver a la misma shell sin un QR código, empuje de prueba con la pantalla bloqueada, y revocar el dispositivo. Repita la ruta mínima en macOS y Firefox/Safari cuando esté disponible.

Nunca marque una prueba no ejecutada como validada. El informe local incluido no prueba por sí mismo la conectividad Cloudflare ni el comportamiento físico-teléfono.

## Publicación y operaciones

Mantener registros técnicos sin cargas de pago, monitorear errores y cuotas, planificar la rotación de identidad y copias de seguridad privadas del estado anfitrión, y no convertir el relé en almacenamiento de archivos. Las actualizaciones de los trabajadores pueden romper las conexiones; hosts y clientes deben volver a conectarse sin emparejarse de nuevo.

Fuentes primarias: [Objeto cultivable WebSockets1ZXQ, [Comandos de Windows](https://developers.cloudflare.com/workers/wrangler/commands/), [GitHub Páginas flujos de trabajo](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [uv installation](https://docs.astral.sh/uv/getting-started/installation/).

## Despliegue anterior, 14 a 15 de septiembre, 2026

Véase [el informe de entrega actual](SESSION_CONTROLS_VALIDATION.md) para versiones posteriores y resultados de aceptación observados.

Páginas: https://moukrea.github.io/jaunt/; relé: `wss://jaunt-relay.moukrea.workers.dev`; host release: `v0.1.0-beta.9` ; APK: `android-v0.1.0-beta.5`.

El trabajador fue desplegado utilizando Wrangler OAuth, autorizado por el propietario, almacenado localmente con encriptación y una clave en el llavero del sistema. `CLOUDFLARE_ACCOUNT_ID` se establece en GitHub; un futuro despliegue de relés a través de Acciones necesitará su propio `CLOUDFLARE_API_TOKEN`. Ninguna ficha OAuth temporal fue copiada en un secreto permanente de API. Los usuarios finales no necesitan tomar ninguna Cloudflare o GitHub acción. Véase [VALIDATION.md](VALIDATION.md) para los resultados observados y sus limitaciones.
