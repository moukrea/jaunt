[English](../../../DESKTOP_RELEASE_NOTES.md) · [fr](../../fr/docs/DESKTOP_RELEASE_NOTES.md) · [es](DESKTOP_RELEASE_NOTES.md) · [it](../../it/docs/DESKTOP_RELEASE_NOTES.md) · [pt](../../pt/docs/DESKTOP_RELEASE_NOTES.md) · [de](../../de/docs/DESKTOP_RELEASE_NOTES.md)

# jaunt escritorio 0.1.0-beta.10

Una aplicación de escritorio nativa que comparte la misma interfaz de usuario receptiva que el navegador y el cliente Android, con controles locales de host. Los dispositivos locales y remotos se adhieren a la misma shells ordinaria sin tmux. Las pestañas de escritorio soportan paneles de división persistentes y reparables; los diseños móviles muestran esas sesiones como pestañas separadas.

**Sesiones** listas de sesiones de funcionamiento y salida, abre shells existente, cierra sólo una vista, o termina explícitamente un shell y sus trabajos para todos los espectadores. Hacer clic o escribir selecciona qué dispositivo controla el tamaño compartido de terminal.

La aplicación utiliza el original jaunt artwork, temas oscuros/ligeros/sistema/circadiano, nombres de host/orden/defaults y notificaciones opcionales de sistema operativo privado. Puede iniciar un servicio de host instalado y conectarse a otros hosts. El instalador oficial también ofrece `--client-only`, que instala el cliente de escritorio sin un host local o controles de host locales.

Linux: instalar el `.deb` o `.rpm`, o uso `jaunt gui` para una instalación verificada de archivos por usuario. macOS: abrir el archivo de aplicaciones de CPU que coincida con la imagen de disco, o utilizar `jaunt gui` de un host instalado. Las construcciones de escritorio no se firman en macOS. No se puede desactivar el buzón de arena de Chromium. Las notificaciones requieren que la aplicación funcione.

El protocolo no ha recibido una auditoría de seguridad independiente. Ver `docs/WORKSPACE.md` y `docs/WORKSPACE_VALIDATION.md` para comportamiento, pruebas observadas y límites de validación restantes.

Esta actualización reemplaza los pictogramas de interfaz con Lucide, muestra el texto de notificación del programa, y conserva objetivos de notificación a través de reconexiones. Los paquetes Linux contienen tamaños estándar de iconos y metadatos de lanzamiento legibles. En Ubuntu con espacios de usuario restringidos, el instalador de host selecciona el paquete para configurar el soporte de caja de arena.

Los controles de sesión ahora mantienen abierto, renombrado, vista estrecha y terminan dentro de cada tarjeta de sesión sensible. shell crea un nombre automático terminal Inmediatamente nuevo shell en carpeta ofrece navegación de directorios y un nombre opcional. El host puede heredar el activo shell’s directorio actual. Escritorio tiene controles separados lado a lado y por encima de / por debajo de los controles de división, una elección inline de las sesiones nuevas o existentes, y un botón para mover cada panel en su propia pestaña. Mobile conserva las pestañas de sesión ordinarias. Cerrar una vista mantiene su shell viva; la terminación todavía requiere confirmación explícita.

La aplicación de escritorio ahora comprueba las actualizaciones automáticamente, descarga y verifica el lanzamiento de emparejamiento, e instala cuando cierra la aplicación. Configuración ofrece Consultar actualización de escritorio, una actualización automática, e Instalar y reabrir cuando esté listo. Las instalaciones del sistema pueden pedir autorización del sistema operativo. Esto actualiza la interfaz por separado del host y no detiene el host shells. Actualizar y actualizar cheques ahora muestran un progreso visible y un resultado retenido.

Las interrupciones de conexión ahora comparten un estandarte de estado persistente. Los resultados del apretón de manos asincrónico tardíos no pueden sobreescribir una conexión de reemplazo. Los errores de diálogo permanecen inline; los errores de acción persisten sin cascadas de tostadas. Las transferencias exponen la espera/cancelación/compleción, la actividad completa colapsa en la historia accesible, y la disponibilidad de actualización mantiene su acción visible.

Esta versión fija el diseño de Ajustes, orden de pestañas estables, renombramiento de doble clic, retroalimentación/actualización y anclaje de desplazamiento móvil. Añade una barra lateral persistente colapsada y seis idiomas detectados por el sistema con una anulación explícita. El título de ventana es simplemente `jaunt`. Claude y Codex utilizan los iconos de marca Meteor agrupados localmente.
