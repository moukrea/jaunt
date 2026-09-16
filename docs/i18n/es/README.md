[English](../../../README.md) · [fr](../fr/README.md) · [es](README.md) · [it](../it/README.md) · [pt](../pt/README.md) · [de](../de/README.md)

# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

**Tus máquinas, tus shells, tus archivos. En todas tus pantallas.**

jaunt conecta los dispositivos que llevas encima con las máquinas en las que trabajas. Instala un pequeño host en cada máquina Linux o macOS, empareja tu teléfono, portátil o equipo de escritorio una sola vez, y todos ellos mostrarán el mismo espacio de trabajo: shells reales en PTY reales, los archivos que están al lado y las sesiones que dejaste en marcha. Abre, renombra, divide, reordena, cierra o termina shells en cualquier host desde cualquier dispositivo; con las *sesiones abiertas compartidas* activadas, las mismas pestañas, paneles y shell activo te siguen de una pantalla a otra. Claude Code y Codex se ejecutan ahí como cualquier otro programa, y cuando ambos están instalados en un host, un único interruptor permite que sus sesiones sobre el mismo proyecto se conozcan entre sí e intercambien mensajes. Clientes: un navegador (también instalable como PWA), una aplicación nativa para Android y una aplicación nativa de escritorio; las tres incluyen la misma interfaz. Las conexiones salen desde el host a través de un relé, cifradas de extremo a extremo, sin puertos abiertos, sin VPN y sin cuenta.

**Host: 0.1.0-beta.22 · Escritorio: 0.1.0-beta.16 · Android: 0.1.0-beta.14.** [Abrir jaunt](https://moukrea.github.io/jaunt/). La publicación y la validación de cada versión se registran en el informe de validación. El protocolo **no ha recibido una auditoría de seguridad independiente**. Consulta el [último informe de validación](docs/SEAMLESS_WORKSPACE_VALIDATION.md) para ver los resultados de prueba observados y las limitaciones no validadas.

## Instalar el host

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Compatible con Linux, macOS y WSL. Requiere `curl`. El instalador utiliza un runtime de Python 3.11–3.14 compatible o instala un runtime privado de Python mediante uv. El host se instala sin privilegios de administrador. En Ubuntu con espacios de nombres de usuario restringidos, la aplicación de escritorio opcional usa el instalador de paquetes del sistema y puede pedir una contraseña de administrador para configurar su sandbox. El instalador verifica el SHA-256 de la versión, crea un entorno privado e inicia un servicio de usuario cuando está disponible. Las actualizaciones automáticas están activadas. Los hosts compatibles conservan sus procesos de shell durante el reemplazo del runtime y esperan a que terminen las transferencias.

En Android, [instala el APK firmado](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.14/jaunt-android-v0.1.0-beta.14.apk) y escanea el código QR que muestra el host. En un equipo de escritorio o en un navegador, abre **https://moukrea.github.io/jaunt/**. También puedes pegar la cadena de emparejamiento `jaunt1.…`. El código QR caduca a los diez minutos y solo puede usarse una vez. A partir de ahí, cada dispositivo recordado utiliza su propia clave, así que cambiar de red Wi-Fi o móvil no obliga a emparejar de nuevo. Mantén la pestaña abierta para que la reconexión sea automática; vuelve a abrir la aplicación si el sistema operativo móvil la suspende o la cierra.

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

El emparejamiento concede acceso como la **cuenta del sistema que ejecuta el host**, con todos los permisos de esa cuenta. No lo ejecutes como root para el uso habitual. Un código QR concede acceso a un shell: no lo publiques nunca.

## Funcionalidades

| Área | Comportamiento |
|---|---|
| Hosts | Empareja tantas máquinas Linux/macOS como quieras; cada una conserva sus propias sesiones, archivos, ajustes y nombre descriptivo; cambia de una a otra desde una única barra lateral; host predeterminado y orden configurable |
| Terminales | PTY reales con tu propio shell, teclado interactivo, pestañas, crear/renombrar/abrir/desacoplar/terminar, arrastrar para reordenar, paneles divididos (lado a lado o apilados), tamaño compartido, teclas Ctrl/Alt/Esc/Tab/flechas en móvil, cuadro de redacción para entradas largas |
| Sesiones abiertas compartidas | Por host: todos los clientes y el propio host muestran las mismas pestañas, paneles, orden y shell activo; modo opcional «solo existen las sesiones mostradas» |
| Reconexión | Historial acotado, reconexión automática, estado recordado; una desconexión del navegador no cierra el shell; los shells sobreviven a las actualizaciones in situ del host |
| Sesiones tmux existentes | Las sesiones tmux heredadas siguen siendo compatibles; las sesiones nuevas creadas en la interfaz son shells compartidos normales |
| Archivos | Navegación, archivos ocultos, paginación, creación de directorios, renombrado, eliminación no recursiva, subida/descarga, vista previa de texto e imágenes |
| Transferencias | Progreso visible y resultados de éxito/error conservados; seguimiento detallado en Archivos → Actividad de transferencia; fragmentos de 48 KiB, reanudación por desplazamiento tras cortes de red, SHA-256 en las subidas, finalización atómica, cancelación |
| Imágenes | Galería, selector de archivos, pegado y arrastrar y soltar; conversión a PNG de los formatos que el navegador puede decodificar; inserción de la ruta o pegado nativo condicional |
| Portapapeles | Selección, copia del historial conservado, lectura/escritura del portapapeles del host cuando está disponible, búfer de texto para hosts sin entorno gráfico, OSC 52 solo para copiar |
| Claude Code ↔ Codex | Un interruptor por host: las sesiones sobre el mismo proyecto se conocen entre sí a través de sus hooks y pueden enviar mensajes a la conversación abierta de la otra; al desactivarlo se elimina todo lo que jaunt añadió |
| Protección | Códigos QR de un solo uso, claves por dispositivo, revocación, bóveda del navegador opcional protegida por PIN/contraseña y bloqueo automático |
| Notificaciones | Servicio nativo de Android opcional o Web Push del navegador; campanas del terminal, eventos de programas, fin de sesión, prueba desde Ajustes y `notify`/`run` desde la CLI |
| Interfaz | Aplicaciones nativas de escritorio y Android con la misma interfaz integrada; cliente de navegador y PWA; seis idiomas; temas oscuro, claro, del sistema y circadiano |
| Actualizaciones | El host se reemplaza a sí mismo in situ sin terminar los shells; la aplicación de escritorio y el APK comprueban, verifican e instalan sus propias actualizaciones |

## Solo cliente de escritorio

Para conectarte a otros hosts sin instalar un servicio de host local ni la CLI de jaunt:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash -s -- --client-only'
```

Esto instala la misma aplicación de escritorio y su lanzador, con emparejamiento remoto, sesiones, archivos, notificaciones y actualizaciones automáticas de la aplicación. No inicia ningún daemon ni muestra los controles del host local. Tampoco desinstala un host instalado previamente. Ejecuta el comando de instalación del host normal para activar más adelante la integración con el host local.

La aplicación de navegador instalada se llama **jaunt (PWA)** para distinguirla de la aplicación nativa **jaunt**. Ambas usan el logotipo transparente original. En Android nativo se usa la misma imagen sin fondo oscuro incorporado; cada lanzador puede aplicar su propio tratamiento al icono.

## Espacio de trabajo de escritorio compartido

Abre **jaunt** desde el menú de aplicaciones del host o ejecuta `jaunt gui`. El host y los clientes remotos comparten los mismos shells normales, sin tmux. **Nuevo shell** abre de inmediato un shell con nombre automático, que hereda el directorio actual del shell activo anterior. El botón de carpeta permite recorrer los directorios del host y, si quieres, dar nombre al nuevo shell. **Sesiones** lista las sesiones en ejecución y las finalizadas: abrir, renombrar, cerrar solo tu vista o terminar explícitamente un shell para todos. También puedes renombrar una pestaña haciendo doble clic en su título, o hacer doble clic en el título de un panel. Arrastra las pestañas para reordenarlas; seleccionar una pestaña nunca cambia su posición. El dispositivo con el que interactúas controla el tamaño del terminal compartido.

Los dos **iconos de división** colocan los paneles lado a lado o uno encima de otro en escritorio, usando una sesión nueva o una existente. Cada panel puede moverse a su propia pestaña. Las disposiciones se conservan al volver a abrir la aplicación; en móvil, esas sesiones se muestran como pestañas normales. La barra lateral de escritorio puede plegarse y la preferencia se recuerda. Ajustes incluye los nombres descriptivos de los hosts, su orden y el host predeterminado, los temas oscuro/claro/del sistema/circadiano y los controles de notificaciones. Los ajustes del host siguen inmediatamente a la máquina seleccionada, incluidos su identidad y sus controles de actualización. La aplicación nativa de escritorio también gestiona el servicio del host local y se empareja con otros hosts; los controles del servicio local solo aparecen para el host local, y las actualizaciones de la aplicación de escritorio se gestionan aparte. Consulta la [guía del espacio de trabajo](docs/WORKSPACE.md) y el [informe de validación](docs/WORKSPACE_VALIDATION.md).

**Puente Claude Code ↔ Codex.** Cuando `claude` y `codex` están instalados en un host, Ajustes muestra un único interruptor. Al activarlo, las sesiones reales de Claude Code y Codex abiertas en shells de jaunt sobre el mismo proyecto se conocen automáticamente entre sí (como contexto normal de hooks) y pueden enviar mensajes a la conversación abierta de la otra, a petición tuya o por iniciativa propia. Está desactivado por defecto; al desactivarlo se elimina todo lo que jaunt añadió a ambos runtimes. Consulta la [guía del puente](../../../docs/BRIDGE.md).

## Gestión de imágenes

El progreso permanece visible durante la subida y la entrega por portapapeles o por ruta. Las operaciones completadas se pliegan en un resultado compacto; **Mostrar historial** conserva los detalles. Cancelar una transferencia se muestra como cancelación, y los errores se quedan junto a su operación. El resultado final indica exactamente qué ocurrió; los errores siguen visibles con una acción de reintento. Que la inserción de una ruta o la entrega con Ctrl+V hayan tenido éxito no demuestra que Claude Code o Codex hayan reconocido un adjunto.

**Pegar:** cuando hay un backend nativo disponible, la imagen se sube al portapapeles del host y se pega en la sesión seleccionada con Ctrl+V. Si el navegador devuelve un portapapeles vacío, la interfaz ofrece un área de pegado enriquecido y un selector de imágenes. Adjuntar conserva ambos modos explícitos. Nunca se envía la tecla Intro.

**Alternativa con conexión activa:** selecciona o pega una imagen, súbela al host e inserta en el terminal su ruta correctamente escapada. Nada envía el comando de forma automática. Claude, Codex u otra herramienta pueden leer el archivo si su propio modo lo permite.

**Pegado nativo condicional:** cuando el host dispone de un portapapeles gráfico accesible (macOS, Wayland con `wl-clipboard` o X11 con `xclip`), jaunt coloca ahí el PNG y envía Ctrl+V al terminal. Esto depende también del atajo y del comportamiento de la herramienta de CLI. **En un host sin entorno gráfico, jaunt no puede fabricar un adjunto nativo de Claude/Codex: recurre a un archivo y a su ruta.** HEIC y otros formatos que el navegador no puede decodificar se pueden transferir igualmente como archivos, pero no se convierten a PNG.

## Actualizaciones automáticas

| Componente | Comportamiento de actualización |
|---|---|
| Host / CLI | Misma instalación. Comprueba el canal publicado cada 15 minutos, verifica las descargas y reemplaza los runtimes compatibles sin terminar los procesos de shell. Las transferencias terminan primero. Ajustes o `jaunt update` lanzan una comprobación inmediata. Los hosts antiguos sin traspaso de runtime posponen la actualización mientras haya shells normales activos; terminar esos shells sigue exigiendo una confirmación explícita. |
| Aplicación de escritorio | Versión independiente de la del host. Comprueba, descarga y verifica automáticamente una actualización, y la instala al cerrar la aplicación. Ajustes ofrece una comprobación manual, un interruptor de actualización automática e **Instalar y reabrir**. Actualizar la GUI no detiene el host ni sus shells. Los paquetes del sistema pueden pedir autorización al sistema operativo. |
| APK de Android | Comprueba automáticamente si hay un nuevo APK. Un diálogo visible de comprobación/descarga lleva a la confirmación de instalación de Android. Se verifican la suma de comprobación y el certificado de firma del APK; Android no permite la autoinstalación silenciosa. |
| Cliente web | Usa la versión publicada en Pages. Vuelve a abrir o recarga para activar una actualización del service worker ya descargada. |

Las instalaciones existentes necesitan la versión que incluye su actualizador antes de que dicho actualizador pueda ejecutarse. Volver a ejecutar el comando oficial del host actualiza el host e instala la aplicación de escritorio anunciada; se niega a cerrar en silencio los shells normales activos. Las claves de emparejamiento se conservan. Consulta [actualizaciones y protección frente a reinicios](docs/UPDATES.md).

## Información sobre la conexión y las operaciones

Una interrupción de red muestra un único banner de conexión persistente con una acción de reintento. jaunt se reconecta con la clave de dispositivo guardada; no reenvía la entrada de terminal que no llegó a enviarse. La revocación y un fallo en la verificación del host detienen la conexión y explican el siguiente paso. Los errores de un diálogo se quedan en ese diálogo; los demás errores de acciones siguen visibles hasta que los descartas. Los avisos breves de confirmación se deduplican y se limitan a dos.

Las subidas, descargas, la instalación del servicio y las comprobaciones de actualización muestran su progreso y un resultado final en Actividad. Las pausas de red son explícitas, se puede cancelar una transferencia y el historial completado puede desplegarse. Las actualizaciones disponibles ofrecen una acción directa en lugar de un aviso que caduca.

## Notificaciones

Activa las notificaciones en **Ajustes** y usa su acción de prueba. Los títulos y el texto de las notificaciones de programas se conservan cuando se proporcionan; una simple campana del terminal no tiene cuerpo de mensaje que recuperar. Hacer clic en una notificación selecciona el host y la sesión correspondientes. Las notificaciones de escritorio requieren que la aplicación esté en ejecución; Android usa su servicio opcional de conexión en primer plano; el cliente web usa Web Push del navegador. El contenido de las notificaciones puede aparecer en la pantalla de bloqueo según los ajustes del sistema operativo.

## Limitaciones conocidas

- Hasta 16 shells activos, 32 vistas conservadas, 2 MiB de repetición en bruto por PTY y 10.000 líneas de historial de xterm. Copiar todo abarca el historial conservado, no un registro ilimitado.
- Límite de archivo en el host: 512 MiB. Las descargas en memoria se limitan a 128 MiB en navegadores sin escritura directa de archivos; las vistas previas se limitan a 16 MiB. Hasta ocho subidas simultáneas y 1 GiB de tamaño total declarado.
- Las subidas se reanudan tras una interrupción de red mientras el host y la página conserven la transferencia. Vuelve a iniciar la subida tras un reinicio del host o una recarga completa de la página; jaunt no obtiene acceso persistente no autorizado a los archivos locales del teléfono.
- Los shells normales sobreviven a las desconexiones y a las actualizaciones de runtime compatibles, **no a una parada o reinicio explícito del daemon ni a un reinicio de la máquina**. tmux puede sobrevivir a un reinicio del daemon, pero no a un reinicio del sistema operativo.
- Solo una pestaña de la aplicación jaunt por perfil de navegador puede poseer la bóveda a la vez. Sí se admiten varias pestañas de terminal dentro de jaunt y varios dispositivos.
- Las notificaciones del navegador requieren permiso y compatibilidad con Web Push. En el APK, activa las notificaciones en segundo plano de Android en Ajustes; las restricciones de batería de Android pueden retrasar la entrega. En iOS, usa la PWA instalada. La entrega depende de la red y del proveedor de push; no está garantizada en tiempo real.
- Un host suspendido o apagado es inalcanzable. No hay encendido remoto, túneles TCP arbitrarios, escritorio gráfico ni compatibilidad con shells nativos de Windows.
- Los paquetes de escritorio para Linux están disponibles para x64 y ARM64; los archivos de macOS no están firmados ni notarizados. No se proporciona ningún paquete de escritorio nativo para Windows. El comportamiento en teléfonos Android físicos y la autorización protegida del actualizador en macOS no se han validado; los resultados en emulador se documentan por separado.
- Los costes, cuotas y disponibilidad del relé de producción dependen de la cuenta de Cloudflare. Las salvaguardas básicas del relé no son un servicio comercial garantizado de protección contra abusos.

## Desarrollo local

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm ci
npm run prepare-web
python scripts/dev.py
```

El lanzador solo escucha en `127.0.0.1`, inicia un host y un relé local y muestra un código QR de prueba. **Esto no expone el host a Internet.** En un teléfono físico usa el despliegue HTTPS: `localhost` se refiere al teléfono, no al PC.

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
python tests/client_update_e2e.py    # Browser-driven host self-update, pushed progress, refusal of a broken release
python tests/bridge_e2e.py           # Real Claude Code and Codex sessions discover and message each other through the bridge (uses your real accounts)
python tests/workspace_sync_e2e.py   # Shared open sessions between two clients, close-or-terminate choice, displayed-only mode
```

Define `jaunt_BROWSER_EXECUTABLE=/path/to/chromium` para usar un navegador del sistema. Si no, ejecuta `python -m playwright install chromium`. Las pruebas nunca modifican las políticas de seguridad de tu navegador.

## Despliegue inicial: una sola vez, por el propietario del proyecto

Entrega [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md) a un agente con acceso a GitHub. Configura GitHub Pages, una versión del host y **un único relé de Cloudflare para todo el proyecto**. Se necesita autorización de Cloudflare; un token de GitHub no la proporciona. Los usuarios finales no crean infraestructura.

jaunt no toma prestados los relés de sshx, Happy ni Zedra. No depende de sus servidores, de Tailscale ni de una cuenta de usuario de jaunt. La cuenta de Cloudflare del propietario puede estar sujeta a cuotas o costes; no se promete ningún relé gratuito ni ilimitado.

## Documentación

[Despliegue](docs/DEPLOYMENT.md) · [Seguridad](SECURITY.md) · [Protocolo](docs/PROTOCOL.md) · [Solución de problemas](docs/TROUBLESHOOTING.md) · [Validación](docs/VALIDATION.md) · [Avisos de terceros](../../../THIRD_PARTY_NOTICES.md)

El inglés es el idioma canónico de la documentación. Traducciones: [English](../../../README.md), [Français](../fr/README.md), [Italiano](../it/README.md), [Português](../pt/README.md), [Deutsch](../de/README.md). Cada árbol traducido incluye las guías de seguridad, despliegue y validación.

Web, Android y escritorio seleccionan automáticamente el idioma del sistema. Puedes cambiarlo en **Ajustes → Idioma**. La CLI usa la configuración regional del sistema; `jaunt --language fr --help` lo cambia para una sola invocación y `jaunt language fr` guarda la preferencia. Usa `system` para volver a la selección automática. Los nombres de comandos, los argumentos, la salida del terminal y el contenido del usuario nunca se traducen.

La dirección web pública presenta el proyecto; **Abrir espacio de trabajo** entra en el cliente. Las aplicaciones nativas abren el espacio de trabajo directamente.

## Aplicación Android

El cliente Android es un APK con una interfaz WebView integrada e integraciones nativas de portapapeles, cámara, archivos y notificaciones en segundo plano. Consulta [instalación, arquitectura y validación en Android](docs/ANDROID.md). La página anuncia el APK una vez verificados sus recursos públicos.

El APK es un paquete nativo de Android con un WebView integrado, no una instalación de PWA. La interfaz y la tipografía son las mismas que en las aplicaciones web y de escritorio; la integración nativa aporta cámara, portapapeles, selección de archivos y notificaciones. Consulta la tabla de actualizaciones anterior para conocer los requisitos de confirmación de instalación.
