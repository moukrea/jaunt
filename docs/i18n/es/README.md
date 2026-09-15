[English](../../../README.md) · [fr](../fr/README.md) · [es](README.md) · [it](../it/README.md) · [pt](../pt/README.md) · [de](../de/README.md)

# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

Tu shells, tus archivos, tu máquina.

jaunt ofrece aplicaciones nativas de escritorio y Android, un cliente web móvil/desktop y un host POSIX. Te conecta a terminales reales, incluyendo shells arbitrarios, Claude Code y Codex. La aplicación web estática utiliza un relé compartido para llevar conexiones externas cifradas desde el host y cliente.

**Host: 0.1.0-beta.11 · Escritorio: 0.1.0-beta.10 · Android0.1.0-beta.8.** [Abrir jaunt](https://moukrea.github.io/jaunt/). La publicación y validación de la publicación de la versión se registran en el informe de validación. El protocolo **no ha recibido una auditoría de seguridad independiente**.](docs/SEAMLESS_WORKSPACE_VALIDATION.md) para los resultados de prueba observados y las limitaciones no validadas.

## Instalar el host

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Apoyos Linux, macOS, y WSL. Requiere `curl`. El instalador utiliza un sistema compatible Python 3.11–3.14 horas de ejecución o instala un privado Python tiempo de ejecución a través de uv. El host se instala sin privilegios de administrador. Ubuntu con espacios de usuario restringidos, la aplicación de escritorio opcional utiliza el instalador de paquetes del sistema y puede solicitar una contraseña de administrador para configurar su caja de arena. SHA-256, crea un entorno privado, y comienza un servicio de usuario cuando está disponible. Se habilitan actualizaciones automáticas. shell procesos durante el reemplazo de tiempo de ejecución y esperar a que las transferencias terminen.

Encendida Android, [instalar el firmado APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.8/jaunt-android-v0.1.0-beta.8.apk), luego escanear el QR código mostrado por el host. En un escritorio o en un navegador, abrir **https://moukrea.github.io/jaunt/**. También puede pegar el `jaunt1.…` La cuerda de pareado. QR el código expira después de diez minutos y se puede utilizar sólo una vez. Cada dispositivo record entonces utiliza su propia llave, por lo que cambiar Wi-Fi o las redes móviles no requieren emparejar de nuevo. Mantenga la pestaña abierta para la reconexión automática; vuelva a abrir la aplicación si el sistema operativo móvil suspende o la mata.

```sh
jaunt gui                        # Open/install the native desktop workspace
jaunt pair                       # Pair another device
jaunt service install            # Install and enable the user service
jaunt status                     # Host and shell status
jaunt update                     # Check for an update without closing shells
jaunt doctor                     # Diagnostics without exposing secrets
jaunt devices                    # List authorized devices
jaunt revoke -- DEVICE_ID           # Revoke a lost device
jaunt notify "Build finished"     # Notify connected devices
jaunt run -- make test            # Notify when a command finishes
jaunt clipboard < notes.txt      # Make text available to the client
jaunt stop                       # Stop the host AND its non-tmux shells
```

El acceso de los subsidios de emparejamiento como la cuenta **sistema que ejecuta el host**, con todos los permisos de esa cuenta. No ejecutar como raíz para uso ordinario. Un código QR otorga acceso shell: nunca publicarlo.

## Características

TEN TERRITORIO ANTERIOR ANTERIOR
|---|---|
tención Terminales TEN Real PTYs, teclado interactivo, múltiples pestañas, crear/renombrar/abrir/detach/terminar, tamaño compartido, Ctrl/Alt/Esc/Tab/arrow keys TEN
← Reconexión Silencio Historia refinada, reconexión automática, estado recordado; una desconexión del navegador no cierra el shell Silencio
← Existing tmux sesiones ← Legacy tmux siguen siendo compatibles; nuevas sesiones en la UI son compartidas ordinariamente shells
Ø Archivos ANTERIENTE Browsing, archivos ocultos, paginación, crear directorios, renombre, eliminación no recursiva, subida/descarga, texto/image preve
Ø Transferencias TEN VIDA Progreso visible y resultados de éxito/error retenidos; seguimiento detallado en Archivos → Actividad de transferencia; 48 KiB chunks, red reanudar offsets, subir SHA-256, finalización atómica, cancelación
TEN Imágenes ANTERIGEN Galería, recolector de archivos, pasta y drag-and-drop; conversión de PNG para formatos descriptibles para el navegador; inserción de ruta o pasta nativa condicional
← Clipboard ← Selección, copiado de desplazamiento retenido, lectura/escritura de portapapeles de host cuando esté disponible, buffer de texto sin cabeza, copia-sólo OSC 52
TEN PROTECCIÓN TENIDO Códigos QR de uso único, claves per-dispositivo, revocación, opcional PIN/password-protegida bóveda del navegador y bloqueo automático TEN
TEN Notificaciones ANTERI Opcional Android servicio o navegador Web Push; terminal campanas, eventos del programa, salida de sesión, Prueba de configuración y CLI `notify`/`run` ANTE
TEN Interface ← Aplicaciones de escritorio nativo y Android con una interfaz compartida; cliente del navegador; local JavaScript TEN

## cliente de escritorio sólo

Para conectarse a otros anfitriones sin instalar un servicio de host local o jaunt CLI:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash -s -- --client-only'
```

Esto instala la misma aplicación de escritorio y lanzador, con pares remotos, sesiones, archivos, notificaciones y actualizaciones automáticas de aplicaciones. No inicia un daemon o muestra controles locales de host. No desinstala un host instalado previamente. Ejecute el comando normal de instalación de host para permitir la integración local de host más adelante.

La aplicación del navegador instalada se llama **jaunt (PWA)** para que pueda distinguirse de la aplicación **jaunt** nativa. Ambos utilizan el logotipo original transparente. Native Android utiliza la misma obra de arte sin un fondo oscuro agrupado; los lanzadores individuales pueden aplicar su propio tratamiento de iconos.

## Espacio de trabajo de escritorio compartido

Abran.jaunt** desde el menú de aplicaciones o la ejecución del host `jaunt gui`. Los clientes anfitriones y remotos comparten lo mismo común shells sin embargo tmux**Nuevo shell** abre un nombre automático shell inmediatamente, heredando el activo anterior shell’s directorio actual. El botón de carpeta le permite navegar por los directorios del host y, opcionalmente, nombrar el nuevo shell**Sesiones** listas de sesiones de funcionamiento y salida: abrir, renombrar, cerrar sólo su vista, o terminar explícitamente una shell para todos. También puede cambiar el nombre de una pestaña haciendo doble clic en su título, o haciendo doble clic en el título de un panel. Arrastre las pestañas para reordenarlos; seleccionando una pestaña nunca cambia su posición. El dispositivo que interactúa con controles compartidos terminal tamaño.

Los dos iconos **split** arreglan los paneles lado a lado o superior/bajo en el escritorio, utilizando una sesión nueva o existente. Cada panel puede moverse en su propia pestaña. Los diseños sobreviven la reapertura; el móvil muestra sus sesiones como pestañas normales. La barra lateral de escritorio puede colapsar, con la preferencia retenida.](docs/WORKSPACE.md) y [informe de validación](docs/WORKSPACE_VALIDATION.md).

## Manejo de imágenes

El progreso se mantiene visible durante la carga y el portapapeles/pataje. Las operaciones completas colapsan en un resultado compacto; **Mostrar historia** conserva los detalles. Cancelar una transferencia se muestra como cancelación, y los errores permanecen con su operación. El resultado final indica exactamente lo que sucedió; los errores permanecen visibles con una acción de reingreso. Ctrl+V la entrega no prueba que Claude Code o Codex reconoció un apego.

**Paste:** cuando hay un backend nativo, una imagen se carga en el portapapeles de host y se pega en la sesión seleccionada con Ctrl+V. Si el navegador devuelve un portapapeles vacío, la UI ofrece un área de pasta rica y un selector de imagen. Attach conserva ambos modos explícitos. No se envía la tecla Enter.

**Retroceder con una conexión activa:** seleccionar o pegar una imagen, subirla al host, e insertar su ruta de escape apropiadamente en el terminal. Nada envía el comando automáticamente. Claude, Codex, u otra herramienta puede leer el archivo si su propio modo lo soporta.

** Pasta nativa convencional:** cuando el anfitrión tiene un portapapeles gráfico accesible (macOS, Wayland con `wl-clipboard`, o X11 con `xclip`), jaunt pone el PNG allí y envía Ctrl+V a la terminal. Esto también depende de CLI El atajo y el comportamiento de la herramienta. jaunt no puede fabricar un nativo Claude/Codex adjunto: se remonta a un archivo y su ruta.** HEIC y otros formatos que el navegador no puede decodificar todavía se pueden transferir como archivos, pero no se convierten a PNG.

## Actualizaciones automáticas

Silencio Componente Silencio Comportamiento de actualización Silencio
|---|---|
← Host / CLI TENS Mismo instalación. Chequea el canal publicado cada 15 minutos, verifica las descargas y reemplaza los tiempos de ejecución compatibles sin terminar shell procesos. Transferencias terminan primero. Ajustes o `jaunt update` cheques de inmediato. Los anfitriones más antiguos sin aplazamiento de entrega de tiempo de ejecución mientras ordinario shells son activos; terminan shells todavía requiere confirmación explícita.
← Aplicación de escritorio ← Versión separada del host. Comprobaciones automáticas, descargas y verifica una actualización; se instala cuando se cierra la aplicación. Ajustes proporciona un cheque manual, una actualización automática y **Install and reopen**. Actualización del GUI no detiene el host o sus paquetes del sistema shells. Los paquetes del sistema pueden solicitar autorización del sistema operativo.
Silencio Android APK Silencio Comprobaciones automáticas para un nuevo APK. Un diálogo de verificación/descarga visible conduce a la confirmación de instalación de Android. El certificado de verificación y firma de APK se verifica; Android no permite la autoinstalación silenciosa.
TEN cliente Web TENIDO Utiliza la versión publicada en Pages. Reabrir/recargar para activar una actualización de servicio-trabajador descargado.

Las instalaciones existentes necesitan la liberación que contiene su actualizador antes de que el actualizador pueda funcionar. Re-running el comando host oficial actualiza el host e instala la aplicación de escritorio anunciada; se niega a cerrar silenciosamente el shells activo. Las teclas de emparejamiento se mantienen. Ver [actualizaciones y protección de reinicio](docs/UPDATES.md).

## Reacción de conexión y operación

Una interrupción de la red tiene un banner de conexión persistente con una acción de reingreso. jaunt vuelve a conectarse usando la clave del dispositivo guardado; no vuelve a reproducir la entrada terminal. La revocación y la verificación de host fallido detienen la conexión y explican el siguiente paso. Errores en una estancia de diálogo en ese diálogo; otros errores de acción permanecen visibles hasta que se des.

Subidas, descargas, instalación de servicios y actualizaciones de cheques muestran progreso y un resultado final en Actividad. Las pausas de red son explícitas, cancelación de transferencia está disponible, y la historia completa se puede ampliar. Las actualizaciones disponibles proporcionan una acción directa en lugar de un brindis expiatorio.

## Notificaciones

Permitir notificaciones en **Configuración** y utilizar su acción de prueba. Los títulos de notificación del programa y el texto se conservan cuando se suministra; una campana terminal no tiene un cuerpo de mensaje para recuperar. Hacer clic en una notificación selecciona el host correspondiente y sesión. Notificaciones de escritorio requieren que la aplicación se ejecute; Android utiliza su servicio de conexión de primer plano opcional; el cliente web utiliza el contenido de navegador Web Push.

## Limitaciones conocidas

- Hasta 16 shells activos, 32 vistas retenidas, 2 MiB de reproducción cruda por PTY, y 10.000 líneas de desplazamiento xterm. Copiar todas las cubiertas historia retenida, no un registro ilimitado.
- Limite de archivo host: 512 MiB. Las descargas en memoria se limitan a 128 MiB en los navegadores sin escritura de archivo directa; las previsiones se limitan a 16 MiB. Hasta ocho cargas simultáneas y 1 GiB de tamaño total declarado.
- Reanuda las descargas después de las interrupciones de la red mientras que el host y la página conservan la transferencia. Reiniciar la carga después de un reinicio host o recarga de página completa; jaunt no obtiene acceso persistente no autorizado a los archivos locales del teléfono.
- shells común sobrevive la desconexión y actualizaciones de tiempo de ejecución compatibles, ** no una parada/reinicial explícita de daemon o reinicio de máquina**. tmux puede sobrevivir un reinicio de daemon, pero no un reinicio de sistema operativo.
- Solo una pestaña de aplicación jaunt por perfil del navegador puede poseer la bóveda a la vez. Se admiten múltiples pestañas terminal dentro de jaunt y varios dispositivos.
- Las notificaciones del navegador requieren permiso y soporte Web Push. En el APK, active notificaciones de fondo Android en Ajustes; las restricciones de la batería Android pueden retrasar la entrega. En iOS, utilice el PWA instalado. La entrega depende de la red y el proveedor de empuje; no está garantizada en tiempo real.
- Un host para dormir o apagado es inalcanzable. No hay un despertar remoto, túnel TCP arbitrario, escritorio gráfico o soporte Windows shell.
- Los paquetes de escritorio Linux están disponibles para x64 y ARM64; los archivos macOS no se firman y no se fijan. No se ha validado ningún paquete de escritorio Windows nativo. El comportamiento del teléfono físico Android y la autorización de actualización macOS no se han validado; los resultados del emulador se documentan por separado.
- Los costos de relé de producción, las cuotas y la disponibilidad dependen de la cuenta Cloudflare. Las salvaguardias básicas de relé no son un servicio de protección de abusos comerciales garantizado.

## Desarrollo local

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm ci
npm run prepare-web
python scripts/dev.py
```

El corredor sólo escucha en `127.0.0.1`, inicia un host y relé local, y muestra un código QR de prueba. **Esto no expone el host a Internet.** Use el despliegue HTTPS en un teléfono físico: `localhost` se refiere al teléfono, no al PC.

```sh
pytest -q                        # Python tests and Node interoperability tests
npm test                         # Relay model, protocol/UI helpers and desktop updater
npm run test:relay               # Real Miniflare runtime; npm dependencies required
python scripts/check_project.py  # Resource consistency and syntax
python scripts/build_release.py  # Wheel, manifest, and SHA256SUMS
python tests/browser_e2e.py       # Real browser and host in temporary isolation
python tests/shared_workspace_e2e.py # Electron + browser sharing real PTYs; needs a display
python tests/terminal_render_e2e.py  # Scroll, selection and terminal geometry
python tests/installer_e2e.py        # Real wheel install and protected upgrade
```

Establecer `jaunt_BROWSER_EXECUTABLE=/path/to/chromium` para utilizar un navegador del sistema. De lo contrario, ejecute `python -m playwright install chromium`. Los exámenes nunca cambian las políticas de seguridad de su navegador.

## Despliegue inicial - una vez, por el propietario del proyecto

Dar [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md) a un agente con GitHub acceso. Configura GitHub Páginas, un lanzamiento de host, y **uno Cloudflare relé para todo el proyecto**. Cloudflare se requiere autorización; GitHub token no lo proporciona. Los usuarios finales no crean infraestructura.

jaunt no presta relés de sshx, Happy o Zedra. No depende de sus servidores, Tailscale o de una cuenta de usuario jaunt. La cuenta Cloudflare del propietario puede incurrir en cuotas o costos; no se promete relé gratuito o ilimitado.

## Documentación

[Deployment](docs/DEPLOYMENT.md) · [Security](SECURITY.md) · [Protocol](docs/PROTOCOL.md) · [ Solución de fallos](docs/TROUBLESHOOTING.md) · [Validación](docs/VALIDATION.md) · [Noticias de terceros](../../../THIRD_PARTY_NOTICES.md)

Traducción: [Français](../fr/README.md), [English](README.md), [Italiano](../it/README.md), [Português](../pt/README.md), [Deutsch](../de/README.md). Cada árbol traducido incluye las guías de seguridad, despliegue y validación.

Web, Android y el escritorio selecciona el lenguaje del sistema automáticamente. Sobrescribirlo en **Ajustes → Idioma**. CLI utiliza el sistema local; `jaunt --language fr --help` anula una invocación y `jaunt language fr` ahorra la preferencia. Uso `system` para restaurar la selección automática. Nombres de mando, argumentos, terminal la salida y el contenido del usuario nunca se traducen.

La dirección web pública introduce el proyecto; **Abre espacio de trabajo** entra al cliente. Las aplicaciones nativas abren el espacio de trabajo directamente.

## Aplicación Android

El cliente Android es un APK con una interfaz WebView y las integraciones de portapapeles nativas, cámara, archivo y notificaciones de fondo. Ver [Android instalación, arquitectura y validación](docs/ANDROID.md). La página anuncia el APK después de que sus activos públicos hayan sido verificados.

El APK es un paquete nativo Android con un paquete WebView agrupado, no una instalación PWA. La interfaz y la tipografía se comparten con las aplicaciones web y de escritorio; la integración nativa suministra cámara, portapapeles, selección de archivos y notificaciones. Vea la tabla de actualización anterior para requisitos de confirmación de instalación.
