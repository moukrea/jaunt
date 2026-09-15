[English](../../../PUBLIC_DELIVERY.md) · [fr](../../fr/docs/PUBLIC_DELIVERY.md) · [es](PUBLIC_DELIVERY.md) · [it](../../it/docs/PUBLIC_DELIVERY.md) · [pt](../../pt/docs/PUBLIC_DELIVERY.md) · [de](../../de/docs/PUBLIC_DELIVERY.md)

# Entrega pública - 15 de septiembre de 2026

Para la siguiente beta de host.9 / beta de escritorio.7 / Android beta.5 correcciones y verificación pública, véase [ resultados de regresión de entrega](DELIVERY_REGRESSIONS.md). Las observaciones a continuación describen la versión anterior.

La aplicación publicada es **https://moukrea.github.io/jaunt/**. Los usuarios finales no necesitan una cuenta GitHub o Cloudflare, VPN, o configuración de servidor inbound.

- Host: [v0.1.0-beta.8](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.8), Python versión `0.1.0b8`.
- Escritorio: [0.1.0-beta.6](https://github.com/moukrea/jaunt/releases/tag/desktop-v0.1.0-beta.6), Linux x64/ARM64 tar/deb/rpm y macOS x64/ARM64 paquetes zip/dmg.
- Android: [firmado beta.4 APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.4/jaunt-android-v0.1.0-beta.4.apk), [release and checksums](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.4).
- Relé del proyecto: `wss://jaunt-relay.moukrea.workers.dev`, con `APP_ORIGIN=https://moukrea.github.io`.

## Instalación validada

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

El comando exacto extraído de la página pública instalado `0.1.0b8` en un nuevo contenedor Fedora 43. Un posterior `jaunt gui --install-only` descargado y verificado el archivo de escritorio y creó su entrada de aplicación-menu. El instalador normal realiza esta configuración de escritorio automáticamente cuando detecta un host gráfico. `jaunt gui` abre la aplicación de escritorio instalada; Linux también están disponibles paquetes de distribución de escritorio

Un Ubuntu 24.04.5 VM separado actualizó la rueda beta pública no editable.5 a beta pública.8, conservando las identidades de host y dispositivo y su servicio de usuario activo habilitado. La actualización inicial seleccionó explícitamente la nueva versión pública antes de que el canal de Páginas predeterminados se conmutara. La receta posterior de aceptación pública utilizó el instalador predeterminado publicado sin una versión override.

Las actualizaciones automáticas de host conservan el shells y las transferencias ordinarias. La autorización de reinicio explícito es necesaria para destruir shells activo, incluyendo trabajos de fondo que sobreviven un shell. El código final también elimina el entorno actual y el legado de las instalaciones automáticas. Android verifica las actualizaciones y utiliza el instalador del sistema Android; sus restos de confirmación.

## Comprobaciones observadas

[PR #18](https://github.com/moukrea/jaunt/pull/18) se fusionó después de que sus cheques pasaran.](https://github.com/moukrea/jaunt/actions/runs/34950530292), [liberación del anfitrión](https://github.com/moukrea/jaunt/actions/runs/34950562658), [desktop release](https://github.com/moukrea/jaunt/actions/runs/34948505167), yAndroid liberación](https://github.com/moukrea/jaunt/actions/runs/34948504993) pasadas. Lanzamientos precedidos [Despliegue de los Pagos](https://github.com/moukrea/jaunt/actions/runs/34951111652).

Mando permanente o entorno actual Silencioso
|---|---|
Silencio `pytest -q` Silencioso 61 aprobado; Linux/macOS, Python 3.11 y 3.13
Silencio `npm test` Silencio 21 pasados
TEN `npm run test:relay` ANTE Dos pruebas reales Miniflare/workerd: origenes web y de escritorio nativos, autenticado routing y hibernación ping; orígenes extranjeros rechazados TEN
TEN `npm run prepare-web`; `python scripts/check_project.py` TENIDO activos y licencias locales Pinned jsQR/xterm generados; cheques de recursos/import/syntax pasados
TENIDO `python scripts/build_release.py` ANTE Rueda, manifiesto y SHA256SUMS construidos
Silencio `python tests/browser_e2e.py`, con relé de desarrollo y `jaunt_E2E_RELAY=workerd` Silencioso 23 escenarios por backend, con PTYs real y transferencias
Silencio `python tests/shared_workspace_e2e.py` bajo Xvfb Silencio Mismo PTY en Electron/browser; la última vista activa lo tamaño; cierre/reabierto y terminación; pestañas persistentes divididas y aplanamiento móvil TEN
TEN `python tests/terminal_render_e2e.py` ANTE Scroll a último, final fila/column bounds, selección de texto, persistencia de tema, salida sincronizada; Claude Code/Codex startup localmente TEN
Silencio `python tests/installer_e2e.py` ANTE 8 aprobado, incluyendo tampering de la suma de comprobación, importación no editable, identidades retenidas y negativa de reiniciar implícita
TEN Fedora 43/44 CI; `installer_namespace_e2e.py`; `installer_storage_e2e.py` ANTE La instalación pública, el curl aislado, el almacenamiento temporal completo y la recuperación del terrorismo de rl-escritura pasado Silencio
TEN Android Unidad de Gradle/lint/debug/release builds and `apksigner verify` ANTE Passed; public APK conserva el certificado de firma establecido
Silencio `python tests/android_workspace_e2e.py` ANTE Android 14 emulator: real public relay and shell, real keyboard opening/resize, system-bar bounds, rotacion y notificaciones terminal-BEL con pantalla apagada
TEN Public APK beta.3 → beta.4, instalado con `adb install -r` TEN Mismo dispositivo autorizado vuelve a conectarse sin emparejar; este cheque no reclama un flujo de sistema-instalador in-app
Silencio Public Linux `.deb` instalado en Ubuntu VM Silencio Real shell ejecutados; renderer Seccomp=2 y NoNewPrivs=1, sin una override de la caja de arena
TEN `python tests/desktop_remote_e2e.py`; instalado el escritorio público en VM Silencio El escritorio nativo autentita como un cliente remoto a través de WSS público, ejecuta un comando probado y termina la sesión ANTE
← Escritor público + público Página + rueda pública Silencio Dos comandos probados en un PTY compartido; cierre/reabierto lo retiene; la terminación remota elimina ambos puntos de vista
TEN Public install host, shell salió con el trabajo de fondo obstinado TEN no aprobado reinicio; el escritorio Terminate mata el trabajo restante y elimina la sesión ANTE
Silencio Activos públicos Silencio Tres activos anfitriones, tres activos Android y todos los diez paquetes de escritorio verificados contra chequesums; caminos de archivo, firmante APK y recursos de icono originales revisados
TEN Public Page ← Corregir tres etiquetas de liberación; 25 recursos revisados bajo `/jaunt/` contra bytes construidos, incluyendo la JS local y licencias Silencio
Silencio Relé Público Silencio Salud HTTP 200, real WebSocket HTTP 101 y ping/pong; origen del navegador extranjero rechazado con 403 Silencio
TEN `gitleaks dir` en fuente de Git exportada, rueda pública y aplicación de escritorio extraída TEN No hay filtraciones detectadas TEN
TEN `npm audit`; `pip-audit --local --skip-editable` TEN No se conocen vulnerabilidades reportadas en los entornos de dependencia comprobados ANTE

El conductor de aceptación pública corrió **12 cheques** contra el VM instalado en la versión: emparejamiento, comprobado arbitrario-shell salida, una explosión de entrada de 512 caracteres, segunda pestaña y retorno, comparación de byte de carga/descarga, carga de imagen más ruta citada sin Enter en un host sin cabeza, recargar sin QR, real IPv4/IPv6 interrupción con la misma shell PID después, rechazo de la mejora implícita, reiniciación autorizada identidades, revocación, y ningún error de navegador no descubierto. Véase [public-report.json](../../../evidence/public-report.json). Cada ejecución utilizó un directorio de fijación fresca; no se escanearon ni eliminaron carpetas personales.

La revisión final del relé es `698962dd-b16a-49f8-b658-a3c5953b3da9` (Wrangler 4.131.2). Añade el origen nativo exacto `jaunt://app` junto con el origen web configurado. Ambos orígenes públicos fueron revisados con actualizaciones WebSocket real/ping-pong, y pareados/commands de clientes remotos fueron verificados desde el paquete de escritorio no cambiado requerido.

Las versiones de herramientas y los hallazgos de desarrollo están en [WORKSPACE_VALIDATION.md](WORKSPACE_VALIDATION.md). Los archivos entregados UI y paquete utilizan la obra original. El candidato anfitrión beta.6 fue superado antes de convertirse en el canal predeterminado; el flujo de trabajo de publicación beta.7 fue cancelado antes de que se creara una versión.

## Limitaciones de validación

El protocolo de seguridad personalizado sigue siendo **independientemente no auditado**. Las pruebas automatizadas y los escáneres de dependencia no establecen una certificación de seguridad.

No se disponía de material Android. La captura de la cámara QR, las variaciones de la galería/OEM, la navegación de gestos físicos, la entrega de Wi-Fi/mobile, el empuje de vela profunda y de pantalla cerrada en un teléfono real no se han validado. Los resultados del emulador se reportan como resultados del emulador.

macOS de ejecución de escritorio y avisos de confianza, hardware ARM, presentación de notificación de escritorio a través de entornos, y la entrega del navegador push-provider siguen siendo límites de validación específicas de la plataforma. Las construcciones de escritorio macOS no se firman. Los archivos Linux por usuario requieren una caja de arena cromium de trabajo; use el paquete de distribución donde los espacios de nombres de usuario están restringidos.

Las pantallas de arranque Claude Code/Codex fueron probadas sin autenticación ni solicitudes de modelo. Las conversaciones de agente completo y cada aplicación de acceso a imagen específica de agente no se reclaman como probadas. Subir imagen más inserción de la ruta sigue siendo diferente del portapapeles OS nativos condicionales más Ctrl+V; ninguno envía Enter automáticamente.

Cerrar una vista preserva su shell. La terminación explícita termina sus trabajos de POSIX-session; procesos deliberadamente daemonizados que crean una sesión de OS separada están fuera de ese límite. Ordinary shells no puede sobrevivir un reinicio de host o reinicio de daemon; tmux sigue siendo opcional para ese requisito de persistencia independiente.
