[English](../../../ANDROID_RELEASE_NOTES.md) · [fr](../../fr/docs/ANDROID_RELEASE_NOTES.md) · [es](ANDROID_RELEASE_NOTES.md) · [it](../../it/docs/ANDROID_RELEASE_NOTES.md) · [pt](../../pt/docs/ANDROID_RELEASE_NOTES.md) · [de](../../de/docs/ANDROID_RELEASE_NOTES.md)

# jaunt Android 0.1.0-beta.7

Esta actualización agrega el desplazamiento táctil con el impulso, preserva la posición de lectura a través del tamaño del teclado, utiliza iconos de interfaz de Lucide agrupados, y envuelve el logotipo original en un icono de lanzador adaptativo. Utiliza el icono original de jaunt, proporciona el gestor de sesión compartido y temas, y recibe notificaciones automáticas terminal bell/program/session-exit cuando está habilitado.

Esta versión regula la entrada rápida terminal para evitar el desbordamiento de la cola de entrada atada del host. La entrada pendiente se descarta si el canal cifrado cambia; los comandos nunca se reproducen después de la reconexión.

Instala el activo `.apk` firmado a continuación en Android 8 o nuevo. Permite la instalación de su navegador cuando Android pregunta, abra jaunt, luego escanea el QR producido por `jaunt pair` en su host. No Android, GitHub o Cloudflare es necesario

Este es un Android APK instalado con una interfaz WebView y integraciones nativas, no un PWA y no un Android completamente reescrito:

- Cámara nativa QR escaneado y galería / selección de archivos.
- Android imagen/text clipboard access. Se carga una imagen pegada y, cuando el host tiene un portapapeles OS compatible, copiado allí antes de enviar Ctrl+V al shell seleccionado, sin Enter. Los hosts sin cabeza conservan un retroceso explícito de carga/pago.
- Sistema Guardar diálogo para descargas; el progreso de transferencia verificada permanece disponible en Archivos.
- Opcional conexión de primer plano para notificaciones, incluyendo mientras que la aplicación se basa. Hágalo en Ajustes. La notificación de Android persistente incluye Stop. Las notificaciones muestran el título/cuerpo emitido por los programas; tapping uno abre la sesión de coincidencia. Android de privacidad de pantalla de bloqueo todavía aplican.
- Los pares guardados sobreviven a actualizaciones de aplicaciones y cambios de red. Las claves están excluidas de la copia de seguridad; las identidades de los servicios de fondo están cifradas con Android Keystore.

El host debe permanecer en funcionamiento; el instalador público de un solo comando configura su servicio de usuario. Android fuerza-stop, restricciones de baterías, salidas de host/network y programación OS puede retrasar o prevenir notificaciones. Esto no promete la entrega garantizada durante el ocio profundo. El protocolo no ha sufrido una auditoría de seguridad independiente.

El informe de validación distingue las pruebas de emulador de la prueba de teléfono físico y el clipboard exacto/Ctrl+V entrega del reconocimiento como un accesorio dentro de una versión Claude Code/Codex. Ver `docs/ANDROID.md` y `docs/VALIDATION.md` en la fuente etiquetada.

El APK verifica automáticamente las actualizaciones. Ajustes también ofrece un cheque inmediato. Las descargas se verifican contra los cheques de liberación y la identidad de firma instalada antes de Android pide confirmación de instalación. Actualizaciones preservan los datos de aplicaciones y emparejamientos; desinstalar los elimina.

Los controles de sesión ahora mantienen abierto, renombrado, vista estrecha y terminan dentro de cada tarjeta de sesión sensible. shell crea un nombre automático terminal Inmediatamente nuevo shell en carpeta ofrece navegación de directorios y un nombre opcional. El host puede heredar el activo shell’s directorio actual. Escritorio tiene controles separados lado a lado y por encima de / por debajo de los controles de división, una elección inline de las sesiones nuevas o existentes, y un botón para mover cada panel en su propia pestaña. Mobile conserva las pestañas de sesión ordinarias. Cerrar una vista mantiene su shell viva; la terminación todavía requiere confirmación explícita.

Las interrupciones de conexión ahora comparten un estandarte de estado persistente. Los resultados del apretón de manos asincrónico tardíos no pueden sobreescribir una conexión de reemplazo. Los errores de diálogo permanecen inline; los errores de acción persisten sin cascadas de tostadas. Las transferencias exponen la espera/cancelación/compleción, la actividad completa colapsa en la historia accesible, y la disponibilidad de actualización mantiene su acción visible.
