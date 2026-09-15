[English](../../../WORKSPACE_VALIDATION.md) · [fr](../../fr/docs/WORKSPACE_VALIDATION.md) · [es](WORKSPACE_VALIDATION.md) · [it](../../it/docs/WORKSPACE_VALIDATION.md) · [pt](../../pt/docs/WORKSPACE_VALIDATION.md) · [de](../../de/docs/WORKSPACE_VALIDATION.md)

# validación del espacio de trabajo — 2026-09-15

Este informe registra observaciones, no una certificación. El protocolo personalizado sigue sin ser estudiado. El despliegue público y los controles de liberación instalados se registran en [PUBLIC_DELIVERY.md](PUBLIC_DELIVERY.md); en la tabla siguiente se registran los controles de desarrollo y plataforma.

## Observaciones locales

Orden permanente / medio ambiente Silencio Resultado observado
|---|---|
TEN `.venv/bin/python -m pytest -q` ANTE 61 aprobado, incluyendo un verdadero trabajo shell/background que ignora la terminación graciosa, trabajos sobrevivientes después de la salida shell, propiedad de geometría compartida, pareado de OSC dividido, encriptación/replay, y actualizaciones seguras TENIDO
Silencio `npm test` Silencio 21 aprobado, incluyendo retención de árboles divididos, temas, criptografía, estimulación de entrada/orden y desconexión sin repetición de entrada
| `npm run test:relay` ← Trabajador realMiniflare WebSocket actualización, registro de objetos duraderos, enrutamiento e hibernación ping pasado
TEN `npm run prepare-web` ANTE Bundles pinned xterm/fit y jsQR localmente, preserva sus licencias, copias instalador, regenera el inventario de servicio-trabajador ←
TEN `python scripts/check_project.py` ANTE importaciones locales, vías de recurso y sintaxis pasadas TENIS
Silencio `python scripts/build_release.py` ANTE Una verdadera rueda de host no editable, manifiesto y SHA256SUMS construidos con éxito
TEN `python tests/browser_e2e.py` ANTE 23 escenarios pasados: comandos reales PTY y ráfagas de 512 caracteres, clientes independientes, recuperación de red, transferencias de bytes exactos, comportamiento de imagen/pata/cabeza, bloqueo de la bóveda y revocación
TEN `DISPLAY=:179 python tests/shared_workspace_e2e.py` ANTE Actual Proceso Electron y navegador independiente comparten un PTY; el tamaño pasivo no roba el tamaño; cierre/reabierto retiene shell; terminan cerrando todas las vistas; pestañas divididas sobreviven la recarga y aplanar en móvil TENCIÓN
TEN `python tests/terminal_render_e2e.py` TENIDO Pergamino de rueda de salida larga y volver a los límites de fila final / columna, control de selección de textos nativos, temas persistentes, fijación de salida sincronizada; instalado Claude Code/Codex pantallas de inicio en perfiles aislados y no autenticados TEN
TEN Android Pruebas de depuración de Gradle build/unit ← Construir y pruebas de unidad nativas pasadas
TEN `python tests/android_workspace_e2e.py` ANTE Android 14 emulador: instalado APK → relé público de propiedad del proyecto → host real aislado → comando probado; el grifo de pantalla real abre IME y encoge el viewport; límites de barra de estado, rotación y pantalla de la notificación del sistema operativo de un terminal BEL pasado TEN
← Installed `.deb` en Ubuntu 24.04.5 VM Silencio Aplicación nativa abierta, rueda candidata no editable ejecutó un probado comando PTY local, renderizado tenía Seccomp=2 y NoNewPrivs=1, y ninguna revisión de la caja de arena estaba presente ←
Silencio `npm audit` ANTE Zero reportó vulnerabilidades en el árbol de dependencia resuelto

La cadena de herramientas local incluida Python 3.14.2, Node 25.5.0, npm 11.8.0, Java 17, Gradle 9.5.0, Electron 44.3.0, xterm 6.0.0, FitAddon 0.11.0, and jsQR 1.4.0. CI uses Node 22 y su configuración Python/Linux/macOS matriz. La instalación actual CLI cheques de inicio utilizados Claude Code 2.1.272 y codex-cli 0.154.0; no presentaron solicitudes modelo ni inspeccionaron conversaciones de usuario/credenciales.

Las referencias de la versión fueron comprobadas contra [Electron's official release](https://releases.electronjs.org/release/v44.3.0) y [ Notas de lanzamiento de xterm](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0). xterm 6 incluye soporte de salida sincronizado. La auditoría de npm no reemplaza una revisión de seguridad Chromium/Electron o audita el protocolo personalizado.

## Conclusiones corregidas durante la validación

- FitAddon midió a un padre acolchado, asignando filas/columnes fuera del área de visualización real. Un montaje separado sin apadrinar ahora proporciona el área medida; pruebas comprobar ambos límites visibles.
- La aplicación Android acolchada WebView en lugar de su diseño exterior. El marco exterior ahora consume insets sistema/cutout/IME, y la interfaz de usuario compartida recibe el estado del teclado.
- El icono Android original era un dibujo terminal no relacionado. Android ahora envía el PNG exactamente suministrado; las referencias navegador/favicon/notification/desktop utilizan la misma obra de arte.
- El paquete terminal suministrado carecía de procedencia exacta de construcción. Ahora se reconstruye a partir de dependencias npm fijas y ambas licencias de corriente.
- Cierre sólo una vista y matar el shell subyacente fueron conflados. Ahora tienen acciones y pruebas de interfaz de usuario diferentes.
- Los permisos de paquete de escritorio heredaron un umask de construcción privada, haciendo que el directorio instalado inaccesible a los usuarios ordinarios. El gancho de embalaje ahora normaliza los directorios de aplicaciones y permisos ejecutables/data. validación de caja de arena embalada se rastrea por separado de las pruebas de renderizado de origen. Ubuntu VM expuso una biblioteca perdida.

CI también captó macOS Bash 3.2 compatibilidad en el bootstrap del medio ambiente-alias y un desajuste de directorio de estado de instalación antigua. El bootstrap de compatibilidad ahora funciona antes de importar una rueda vieja, incluyendo las invocaciones posteriores de CLI. El verdadero Fedora concurl de prueba confinado pasa con la rueda pública beta.5 e instalador candidato.

La matriz anfitriona pasó adelante Linux y macOS con Python 3.11 y 3.13. macOS, el host utiliza el sistema de unión de espera cuando Python lo omite, siguiendo al público de Apple [wait.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/wait.h) y [signal.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/signal.h) definiciones, tanto corriendo como saliendo...shell La terminación del trabajo de fondo se ejerce mediante las mismas pruebas de procesamiento real en ambos sistemas operativos.

La prueba Electron sin cabeza de movimiento fuente utiliza un override de caja de arena de sólo prueba en un servidor X aislado. El cheque independiente de paquete instalado pasó sin esa override en el Ubuntu VM. Producción principal / código de carga nunca deshabilita la caja de arena.

## Límites de validación restantes

No se disponía de un práctico Android. Cámara real QR captura, variaciones de la galería, comportamiento OEM de navegación por gestos, rotación física, transferencia Wi-Fi/móvil, y entrega de notificación de identificación profunda siguen sin ser validadas. Emulator IME/bar sistema/pantalla de pantalla no reemplaza esas pruebas.

Actual CLI startup y una fijación de salida sincronizada son probados; una conversación modelo autenticada completa, cada comportamiento de recrudecimiento de la versión CLI, y cada aplicación de acceso de imagen específica de agente no se reclaman como validados. El transporte de portapapeles nativos y la distinción explícita de subida/pataje sin cabeza permanecen separados del reconocimiento de adjunto de un agente.

macOS ejecución de escritorio, avisos de confianza del sistema operativo, hardware de ARM, presentación de notificación de escritorio en entornos de escritorio, y la entrega del navegador del proveedor requieren evidencia específica de plataforma. Los resultados de construcción por sí solo no son validación de tiempo de ejecución. El retroceso del navegador sigue disponible, y no se promete una entrega incondicional o un comportamiento perfecto en cada terminal/phone.
