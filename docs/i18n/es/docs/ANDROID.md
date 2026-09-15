[English](../../../ANDROID.md) · [fr](../../fr/docs/ANDROID.md) · [es](ANDROID.md) · [it](../../it/docs/ANDROID.md) · [pt](../../pt/docs/ANDROID.md) · [de](../../de/docs/ANDROID.md)

# jaunt Android

El Android cliente empaqueta la interfaz funcional existente en un APK. Código nativo Java implementa el acceso a portapapeles, cámara QR escaneado, selección de archivos/salvar y una conexión de notificación de primer plano. La UI permanece HTML/JS en Android Sistema WebView. No hay tiempo de ejecución JavaScript viene de un CDN o de la página pública: los activos se agrupan en APK.

## Uso

Instala el APK firmado desde la versión Android, luego abre jaunt y escanea el `jaunt pair` QR del host. Android puede pedirle que permita la instalación desde el navegador utilizado para descargarlo. Este permiso es sólo para la instalación; no se necesita nueva cuenta de nube.

Abrir un shell y utilizar Paste después de copiar una captura de pantalla. Con un portapapeles compatibles la imagen es subida, copiada en ese portapapeles y Ctrl+V se envía al seleccionado PTY sin embargo Enter. De lo contrario, quedan las opciones de ruta/aprendizaje explícitas existentes. Android's file/gallery picker. Imágenes compartidas de otra aplicación requieren una confirmación nombrando el destino shell. Descargas abiertas AndroidEs Guardar diálogo.

Habilitación Android notificaciones de antecedentes en Configuración para cada huésped. Android solicitud de permiso de notificación; una notificación persistente muestra el recuento de conexión y ofrece Stop. Las notificaciones muestran el título y el mensaje del programa y abren su host/sesión cuando se reproduce. Android controla la visibilidad de la pantalla de bloqueo. jaunt no se raspa terminal producto para fabricar el texto de notificación. `jaunt notify "Need your attention"` y `jaunt run -- command` El servicio de usuario del host debe estar activo.

Android puede restringir el acceso a la red en las políticas de baterías profundas o bajo proveedores. Parada de fuerza evita el funcionamiento automático hasta que la aplicación se abra de nuevo. No se garantiza la entrega de notificaciones. Un servicio de primer plano no es un VPN y no requiere credenciales Firebase/FCM.

## Límites de seguridad

- `WebViewAssetLoader` solo sirve activos agrupados en `https://moukrea.github.io/jaunt/`. Los activos perdidos fallan cerrados. Enlaces externos abiertos fuera del privilegiado WebView.
- El puente de mensajes nativos acepta sólo el origen HTTPS exacto y el marco principal. No se habilita ninguna carga de URL de archivo/contenido, tráfico de texto claro, liberación WebView depuración o copia de seguridad.
- Las identidades de notificación Android usan la tecla de dispositivo ya emparejado y jaunt v1 PSK-authenticated ephemeral P-256/HKDF/AES-GCM canal. Los contadores certificados estrictos rechazan la repetición. La interoperabilidad del protocolo nativo se prueba contra el host Python instalado.
- Sólo la opción explícita de la notificación de antecedentes copia los campos de identidad requeridos en el almacenamiento cifrado Android Keystore. Olvídalo/revocación los elimina. El bloqueo Vault oculta los datos terminal pero no desactiva una conexión de fondo separadamente activada.
- Los códigos de unión, el contenido del portapapeles, las claves de firma, los registros terminal y las identidades locales no son activos de liberación.
- El protocolo y esta nueva implementación nativa han **no ha tenido una auditoría de seguridad independiente**.

## Construir y soltar

Usar JDK 17, Android SDK plataforma 37.0, herramientas de construcción 36.0.0 y el envoltorio de Gradle. El comportamiento objetivo es Android 16/API 36; instalación mínima API es 26. Las dependencias de Gradle y las compruebas de artefactos se generan a partir de la resolución real y se registran.

```sh
npm ci
npm run prepare-web
android/gradlew -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

`android-v*` tags run `.github/workflows/android.yml`. La etiqueta debe coincidir `versionName`. La firma utiliza secretos de repositorio `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD` y `ANDROID_KEY_ALIAS`; la llave se materializa sólo en el directorio temporal del corredor y se retira después. La liberación contiene la firma APK, SHA256SUMS y salida de verificación certificado de firma. Una liberación existente nunca es sobrescrito. `v*` Las liberaciones permanecen separadas con sus tres activos del instalador.

La prueba Android APK contiene una fijación de portapapeles aislada para el emulador. No se envía en la versión APK y no añade punto final de depuración de la producción. La automatización Debug WebView está deshabilitada en construcciones de liberación.

## Validación

See `docs/evidence/android-report.json` para los resultados observados. Android cámara, teclado/IME diferencias, restricciones de la batería del proveedor, real Wi-Fi/Mobilización de la entrega y el comportamiento de notificación de los pasillos profundos todavía requieren validación de dispositivos físicos. Las pruebas de detección de los emuladores se reportan por separado. Claude Code/Codex construir exhibió un apego meramente porque los bytes de clipboard y Ctrl+V entrega aprobada.

## Actualizaciones de aplicaciones

La liberación APK comprueba el canal de liberación publicado automáticamente cuando se abre (a la mayoría de una vez por seis horas); una conexión de fondo habilitada también comprueba y puede notificarle acerca de una actualización. Ajustes → Compruebe para las actualizaciones un cheque. jaunt descargas las APK sólo después de elegir Descargar e instalar, verifica SHA-256 contra el archivo de checksum de liberación, verifica el ID de aplicación y certificado de firma contra la aplicación instalada, y rechaza las rebajas de la versión. Android's propio instalador pide confirmación. En la primera actualización, Android puede requerir “Permitir de esta fuente” para jaunt. Una aplicación de carga lateral normal no puede evitar silenciosamente esta confirmación del sistema operativo.

Actualizaciones conservan datos de aplicaciones y teclas de emparejamiento. Desinstalar la aplicación los elimina. La actualización APK se comparte con el instalador de Android a través de una subvención de FileProvider privada, no un directorio legible públicamente. Debug construye no instala automáticamente actualizaciones de liberación.
