[English](../../../VALIDATION.md) · [fr](../../fr/docs/VALIDATION.md) · [es](VALIDATION.md) · [it](../../it/docs/VALIDATION.md) · [pt](../../pt/docs/VALIDATION.md) · [de](../../de/docs/VALIDATION.md)

# jaunt — entrega validada el 14 de septiembre de 2026

Entrega actual: [controles de sesión, retroalimentación del cliente, pruebas de liberación pública y limitaciones](SESSION_CONTROLS_VALIDATION.md). Anterior host beta.5 / Android beta.3 delivery: [informe histórico consolidado](PUBLIC_DELIVERY.md). Las secciones a continuación conservan observaciones históricas; informes posteriores superan sus recuentos de prueba y estado de versión específica.

**Page: https://moukrea.github.io/jaunt/**

**Relé: wss://jaunt-relay.moukrea.workers.dev**

**Release: [v0.1.0-beta.2](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.2)**

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

La forma anterior de este comando (`curl -fsSL … | bash`) fue ejecutado en un limpio Ubuntu VM sin fuente editable. Ver [bootstrap correcciones y Fedora pruebas](INSTALLER_FEDORA.md) para el comando actual. Los usuarios finales no crean GitHub/Cloudflare cuenta y no configura ni un servidor público ni un VPN**El protocolo y el producto permanecen sin una auditoría de seguridad independiente.** Las limitaciones de la SEGURIDAD, incluido el origen de las páginas compartidas, siguen vigentes.

## Historia y publicación

El archivo se integró sin leer la antigua implementación para la inspiración. Original commit `eb71cfe9b80749d3c53f11e428f027b0d64fb372` se conserva en `backup/pre-rewrite-20260914`. PRs [8](https://github.com/moukrea/jaunt/pull/8) y [9](https://github.com/moukrea/jaunt/pull/9) fueron fusionados después de cheques requeridos, sin evitar protecciones, la perforación de la fuerza, o la eliminación de la historia. Beta.1 sigue siendo inmutable; correcciones de host fueron publicadas en beta.2.

El propietario concedió a Wrangler OAuth a través del navegador. jaunt Versión del trabajo `00dd364c-c69c-4e89-8878-00ebd38ca414` usos `ROOMS` / `Room`, migración SQLite `v1`, y APP_ORIGIN `https://moukrea.github.io`No se utilizó el relé de otro proyecto. HTTP salud, WebSocket autenticación, enrutamiento bidireccional, ping/pong y rechazo de un origen no autorizado fueron verificados. shell La operación fue entonces probada públicamente.

[Liberación de beta.2]](https://github.com/moukrea/jaunt/actions/runs/34855623613): tres activos públicos (wheel, host-manifest.json, SHA256SUMS) descargados y verificados antes [Pagos](https://github.com/moukrea/jaunt/actions/runs/34855764137). GitHub variables jaunt_RELAY_URL, jaunt_RELEASE_TAG, y jaunt_PAGE_URL se establecieron. Las 25 solicitudes de recursos de la página, incluyendo módulos de JS, imágenes, licencias jsQR/xterm, instalador y trabajador de servicio, fueron comparadas con bytes entregados bajo `/jaunt/`. No hay tiempo de funcionamiento de la JS proveniente de un CDN.

Las credenciales de OAuth se almacenan encriptadas con una clave en el sistema local. CLOUDFLARE_ACCOUNT_ID se establece en GitHub; un futuro Implementación de relé de Acciones todavía requiere su propio CLOUDFLARE_API_TOKEN. El despliegue observado utilizado local OAuth, no un token GitHub o una API de token OAuth copiado permanente.

## Comandos y resultados observados

Configuración de desarrollo: `python3 -m venv .venv`, luego `pip install -e . -r requirements-dev.txt pip-audit` y `npm ci`. La instalación de desarrollo editable está separada de las pruebas de rueda.

TEN TERRITORIO TERRITORIO TERRITORIO TERRITORIO TERRITORIO TERRITORIO TERRITORIO TERRITORIO TERRITORIO TERRENO
|---|---|
Silencio `npm install`, luego `npm ci` ANTE Real package-lock.json resuelto y comprometido; instalación reproducible
TEN `npm run prepare-web` ANTE 20 recursos; jsQR 1.4.0 y Apache licencia copiado localmente ANTE
Silencio `pytest -q` Silencio **36 pasado**; real PTY, interoperabilidad Web Crypto, actualización atómica, interrumpido enviar  suya
Silencio `npm test` Silencio **17 pasados**
Silencio `npm run test:relay` Silencio **1 real workerd/Miniflare integration passed**, SQLite y WebSockets ANTE
Silencio `python scripts/check_project.py` Silencio Pasado sin la exención `--source`
TENIDO `python scripts/build_release.py` ANTE Beta.2 rueda, manifiesto y sumas de comprobación construidas
Silencio `python -m playwright install chromium` Silencio Chromium realmente instalado
Silencio `python tests/browser_e2e.py` Silencio **20 escenarios pasados** en CI con el relé Python Silencio
TENIDO `jaunt_E2E_RELAY=workerd python tests/browser_e2e.py` TENIDO **20 escenarios pasados**, localmente y en CI TENIDO
Silencio `python tests/installer_e2e.py` Silencio **8 cheques pasados** en beta.2, localmente y en CI Silencioso
TEN `jaunt_INSTALLER_ONLINE=1 python tests/installer_e2e.py` ANTE **8 cheques pasados** en beta.1, utilizando un espejo de retroceso y dependencias de PyPI en entornos frescos TEN
Silencio `npm audit` Silencio **0 vulnerabilidades conocidas** en el gráfico resuelto
TEN `pip-audit` ANTE **0 vulnerabilidades conocidas**; el paquete jaunt local está ausente de PyPI y por lo tanto no está cubierto ANTE

[Beta.2 CI](https://github.com/moukrea/jaunt/actions/runs/34855112550): siete trabajos exitosos, incluyendo 36 pruebas de host en Linux/macOS × Python 3.11/3.13 y ambos conjuntos de 20 escenarios del navegador. Requisitos de protección de rama `lint` y `test` ejecutan cheques reales; el último depende de todas las suites que tengan éxito.

Versiones locales: Python 3.14.2, Node 25.5.0, npm 11.8.0, pytest 9.1.1, Playwright 1.62.0, Chromium 151.0.7922.34. Node 22, Python 3.11/3.13 Host: websockets 16.0, cryptography 50.0.1, qrcode 8.2, pywebpush 2.5.0. Construido: setuptools 84.0.0, pip 26.2.1, Wrangler 4.131.2, direct Miniflare 4.20260730.0; Wrangler también utiliza Miniflare 5.20260911.1-alfa. Miniflare overrides: sharp 0.35.4 y undici 7.29.0.

criptografía/pip inicial y Miniflare/sharp/undici advisories were addressed with pinned updates and overrides, then retested. Fuentes: [cryptography](https://github.com/pyca/cryptography/security/advisories), [sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [undici](https://github.com/advisories/GHSA-4cwx-7wf7-3272). La procedencia/versión exacta del paquete xterm suministrado sigue siendo limitada como se describe en THIRD_PARTY_NOTICES.md; npm la auditoría no cubre este paquete.

## Prueba de aceptación pública en una máquina limpia

QEMU/KVM Ubuntu 24.04 VM, Python 3.12.3, imagen oficial verificada contra SHA-256 `612b2c0cc1bc413a6cb8c38fd611794caf0f2b436c50013d8b3794db12ad7354`. No hay código fuente o tiempo de ejecución editable fue instalado allí. Instalación pública beta.1 produjo un código QR y el servicio de usuario sistematizado habilitado; un reinicio real confirmado arranque automático, reiniciación continuada.

Un script de aceptación privada llevó SSH y Chromium contra la página pública. Corrió el comando de instalación entonces corriente, `jaunt status`, `jaunt pair --json`, `systemctl --user` comandos, e interacciones UI. Los códigos QR y la salida privada permanecen fuera del repositorio. Resultados:

- Pareado público y un canal encriptado autenticado a través de Cloudflare.
- Arbitrary shell, `printf`/`cat`, y `PUBLIC_jaunt_PROVED` verificados tanto en el terminal como en un archivo; segunda pestaña y volver al primero.
- Multi-chunk Unicode/bloquear cargas y descargas en comparación con byte para byte.
- Imagen transferida y citada ruta insertada sin Enter; un archivo centinela verificó que nada se ejecutó automáticamente. Pasta nativa fue deshabilitada en este VM sin cabeza.
- Recargar página con identidad recordada y sin nuevo código QR.
- Interrupción de red de salida real mediante una regla temporal limitada a esa VM y eliminada en un bloque `finally`: mismo shell PID y sesión, con un comando `RESUMED` probado después de reconectarse sin emparejar.
- Actualización pública rechazada con dos activos shells ordinario; daemon retenido.
- Actualización con `jaunt_ALLOW_RESTART=1`: reinicio explícito, shells terminado, servicio activo, host/device identidades preservadas, navegador reconectado.
- La revocación desconectó el navegador y la creación shell deshabilitada.
- No hay excepción de navegador inexplorado.

Las once comprobaciones se registraron en `docs/evidence/public-report.json`, junto con las pruebas de instalador y beta.2. En ese momento, `browser-report.json` retuvo la carrera local de 18 escenarios como evidencia histórica; el CI referenciado demostró la suite de 20 escenarios. Los archivos de evidencia se han actualizado desde entonces para la entrega posterior descrita en PUBLIC_DELIVERY.md.

## Fallos fijos sin quitar características o afirmaciones

- Una respuesta de lista de directorios tardía superó la ruta tipod: los borradores por hospedaje y las revisiones de solicitud lo fijaron; la prueba retrasa respuestas cifradas reales.
- Las aserciones leen el terminal antes de la entrega asincrónica: las esperas atadas ahora comprueban la salida real, la inserción o el apego completado.
- Un cheque de Bash separado de la apagada correda con la creación shell: la actualización de daemon atómico cierra la admisión.
- Relay pongs enmascarada pérdida de host: los mensajes anfitriones autenticados son monitoreados por separado y activan la reconexión. La prueba suspende el host real mientras deja el relé corriendo.
- Una excepción WebSocket durante el envío terminó la tarea de salida PTY: los envíos interrumpidos se convierten en ConnectionError y cerrar el canal. Dos regresiones reales-PTY fallan con el viejo transporte y pasan después de la fijación, incluyendo repetición y salida fresca en el mismo PID.
- Pruebas sin cabeza heredaron el entorno de escritorio y perfiles personales: las variables gráficas se eliminan y prueban shells ejecutar sin perfiles en directorios temporales.
- Matar sólo al padre Miniflare dejó conectado el arnés: el arnés ahora interrumpe su propio grupo de proceso aislado.

## Limitaciones e informes que deben seguir siendo visibles

Estas observaciones describen la entrega inicial beta.2; validación posterior a continuación y en los registros PUBLIC_DELIVERY.md posterior progreso.

- El agente no utilizó teléfono físico. El usuario reportó un emparejamiento móvil exitoso después de olvidar una entrada recordada; que no valida la cámara, teclado/IME, galería, rotación, Wi-Fi/mobile handoff, suspendida PWA, o empuje de pantalla bloqueada. El usuario también informó que falló Android pasta de captura en Claude Code; ese flujo específico seguía siendo investigado.
- La entrega real Web Push y pasta nativa dentro de Claude/Codex no fueron validados. Un camino insertado no es un accesorio nativo; ningún portapapeles OS se promete en un host sin cabeza.
- lanzado, instalación macOS/WSL, bootstrap sin Python, Safari/Firefox, tmux real, carga sostenida, cuotas de relé y costes, y SLA no fueron validados en esta ejecución inicial.
- El protocolo, host, frontend y relay no tienen auditoría independiente.

## Objetos y privacidad

Los tres activos de cada lanzamiento fueron descargados, comprobaciones verificadas y el contenido de la rueda inspeccionado. Gitleaks 8.30.1 no encontró ninguna fuga en las ruedas. La instantánea inicial produjo una revisión falsa positiva: xterm's JavaScript FourKeyMap/TwoKeyMap inicialización. Los cheques cubren el proyecto y sus accesorios, nunca escaneos destructivos de directorios personales. QR código, bóveda, secreto o privado terminal se publica el contenido. Se revisaron los flujos de trabajo y se utilizaron npm c; Páginas verifica los tres activos antes del despliegue. El ZIP se construye desde un perímetro, con cheques de CRC, comparaciones de bytes y comprobaciones per-file. La licencia jsQR se conserva intacta, incluyendo su nueva línea final.

## Solución de la usabilidad después de la retroalimentación del usuario

Paste podría tratar el texto vacío como una pasta de éxito. Ahora abre un área de pasta rica cuando la API no proporciona contenido útil, acepta imágenes FileList/DataTransfer y datos PNG integrados desde HTML, y ni inserta HTML ni descarga URL externas. Una sola imagen se envía automáticamente al portapapeles de host y luego Ctrl+V en la sesión de captura cuando un backend nativo está disponible.

El flujo obrero local alcanzó **22 escenarios**, incluyendo la lectura de una imagen real a través de la API de Clipboard de Chromium y simulando un resultado de texto vacío seguido de pasta rica a un host real. Este último simula sólo entrada de portapapeles; no reclama la interacción Android.

Un Xvfb/X11 VM separado también recibió la imagen del navegador a través de la rueda pública Worker e instalado beta.2. El PNG xclip coincidió con el archivo cargado exactamente, y el PTY recibidos únicamente `16` (Ctrl+V), sin Enter. Esta prueba de prepublicación inyectó los archivos UI de la rama en el cromo en el origen de la página; véase `native-clipboard-report.json`. No prueba la pantalla de acceso interior real Claude Code/Codex. El usuario informó que ambos modos Attach funcionaban en su dispositivo; la solución Paste-specific todavía esperaba confirmación en su teléfono.

Transferencias ya no es una pestaña permanente. Seguimiento, cancelación y caminos permanecen disponibles bajo Archivos → Actividad de transferencia después de una transferencia; el navegador guarda descargas.

macOS CI reveló otro caso de cierre: la bandera viva del segador podría permanecer fiel después de que el proceso hubiera salido realmente. Cierre ahora comprueba Popen.poll antes de señalar el grupo de proceso. EPERM se tolera sólo si el proceso ha salido; el fracaso en un niño vivo sigue siendo un error. Una regresión verifica que un PID ya salido nunca se señale.

## Cliente Android y seguimiento beta.3 — 2026-09-14

PR #10 pasó cada trabajo de CI, incluyendo 37 Python pruebas en Linux/macOS y ambos relés del navegador backends, luego fusionados como `f85b9cb`. Anfitrión pública `v0.1.0-beta.3` fue publicado por run `34859426583`; los tres activos públicos, el contenido de la rueda y las sumas de comprobación fueron verificadas, y el escaneo secreto de la rueda no encontró filtraciones. `34859891960` sucedió; su configuración beta.3 y los recursos de interfaz cambiados se compararon con la fuente fusionada. Ubuntu VM mejorada del instalador público con su identidad preservada y su servicio de usuario activo.

Android local construye observaciones:

- JDK 17; Gradle 9.5.0 con distribución oficial SHA-256; AGP 9.3.2; compilar SDK 37.0 / target 36 / mínimo 26.
- `android/gradlew -p android :app:assembleRelease :app:lintRelease :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug --write-locks --write-verification-metadata sha256 --no-daemon`: exitoso. Se aprobaron dos pruebas de unidad de protocolo nativo (encriptación bidireccional, rechazo replay/tamper y unión de pruebas). El canal nativo también autentificó contra el host Python público, independientemente de estos accesorios de unidad.
- Android lint: no hay errores. Las advertencias restantes se refieren al objetivo deliberadamente retenido API 36, la versión Gradle compatible, JavaScript está habilitado para el análisis de interfaz de red y de vanguardia; estos son límites revisados, no afirmaciones suprimidas. Posteriormente se añadió un callback de recuperación de pérdida de renderizado después de la advertencia del forro WebKit.
- OSV queried all 21 resolved Android lanzamiento runtime artefactos Maven: no reportó asesorías en 2026-09-14. Esto es cobertura de la base de datos, no una auditoría de seguridad. WebKit fue actualizado a 1.17.0 y la biblioteca de pruebas JVM JSON a 20260814 después de comprobar las versiones disponibles.
- `apksigner verify --verbose --print-certs`: lanzamiento firmado APK verifica con APK Signature Scheme v2, RSA 4096, certificate SHA-256 `0c94f35fe68a30eb155c4aa5b9003f633b5b4884f191c54f84bdeeec956348fe`. Local signed APK la instalación y el lanzamiento tuvieron éxito en el emulador. La depuración de la liberación es deshabilitado; la automatización de extremo a extremo debajo usó la construcción de la depuración WebView depurando, no un punto final de depuración de la producción.
- Android emulador de 14/API 34 x86_64: instalado APK → public Cloudflare relé → public release-installed beta.3 host → real shell fichero de comando y salida; nativo Android clipboard de texto ida y vuelta; canal de notificación encriptada de Java nativa; real Android notificación con la aplicación de fondo y emulador pantalla apagada; nativo Android portapapeles → subir → host aislado X11 clipboard → PTY byte `16` (Ctrl+V), no Enter, PNG bytes igual; rotación y red de toggle mantener el mismo shell ID/PID; Android Guardar diálogo escribe exactamente los bytes de fijación binaria.
- La fijación de portapapeles Android es una instrumentación separada APK. No está en la aplicación firmada. Todas las pruebas de host/clipboard/image utilizaron datos sintéticos en el aislado VM/emulator, nunca el portapapeles de escritorio del usuario o carpetas personales.
- Después de la integración de la interfaz compartida: `npm test` y `npm run test:relay` real pasaron; `python tests/browser_e2e.py` pasó los 22 escenarios del navegador; `python scripts/check_project.py` pasó. GitHub CI repite ambos backends del navegador antes de combinar.

Evidencia: `docs/evidence/android-report.json` y `android-dependency-audit.json`. Escaneo de cámara Físico Android, comportamiento real del teclado/IME, variantes de galería, despachamiento real Wi-Fi/mobile, comportamiento profundo de la batería de idle/OEM y reconocimiento de apego dentro de una versión real Claude Code5ZXQ no se reclaman.

Una publicación bloqueada de arranque en blanco específico de liberación durante la validación. El contenedor nativo ahora mantiene una pantalla de apertura/retry explícita hasta que la aplicación enganchada confirma la preparación y pide una rodaja. Tres inicios consecutivos de frío de la liberación firmada no depurable luego mostraron el espacio de trabajo. El CI de funcionamiento limpio inicial también rechazó dos comprobaciones de metadatos de Gradle; una resolución de cupo de dependencia fresca generó la verificación POM/modulesum.

## Actualizaciones automáticas — validación de la aplicación

El actualizador de host solicitado añade seis pruebas de fallo/seguridad: una actualización descargada se retrasa con un estado real de la sesión activa incluso cuando se hereda la autorización de reinicio; los bytes de rueda manipulados no pueden llegar a apagado de host; tiras de instalación automática reinician y desenvuelven el desarrollador; reinicio explícito se maneja por separado; las etiquetas de liberación mayores/inválidas son rechazadas; deshabilitar actualizaciones automáticas previene el acceso a la red. `pytest -q`: **43 pasó**. La suite del instalador real todavía pasa todos **8 cheques**, incluyendo activo PTY rechazo y reinicio explícito. Public automatic version-to-version instalación y Android's real update installer se rastrean por separado de estas pruebas y debe ser registrado después de la publicación de la publicación.

El firmado (no despreciable) APK emparejado con éxito Android's Documents/gallery picker utilizando un QR imagen, contra el público beta.3 host y Cloudflare Relé. Android's diálogo de autorización de cámara real y el lanzamiento del escáner ZXing nativo también se ejercieron; una cámara física real decodificando una QR todavía no se reclama. APK deliberadamente despide a los viejos WebView's BarcodeDetector para la galería QR decodificación: que API se estrelló en el emulador cuando Google Play Services estaba ausente; agrupado jsQR decodificado el mismo emparejamiento con éxito.

El protector de apagado automático actualizado ahora también se deduce durante las transferencias de archivos. Una carga temporal real sigue siendo útil después de un reinicio rechazado y completa con bytes idénticos antes de que se permita el cierre completo. Python suite ahora informa **45 aprobado**. Android descubrimiento de la liberación utiliza el canal de página pública verificado en lugar de requerir que cada dispositivo para consumir GitHub cuota de API. Pruebas JVM nativas: **3 aprobado**. La firma APK también ejecutó un comando a través de su Android Composición / entrada de teclado; el archivo anfitrión resultante contenía los bytes esperados exactos.

## Liberación del espacio de trabajo compartido

Ver [validación del espacio de trabajo](WORKSPACE_VALIDATION.md) para el escritorio actual / compartido-sesión, geometría terminal, insets Android y cambios de notificación. Observaciones anteriores beta permanecen históricas y no implican que cada nueva combinación de plataforma fue probada.

## Regresos posteriores a la entrega

Ver [Arreglos de regresión de entrega](DELIVERY_REGRESSIONS.md) para el entorno shell, Ubuntu startup, lanzador/icon, Android descubrimiento y defectos de notificación descubiertos después de la entrega anterior.
