[English](../../../SECURITY.md) · [fr](../fr/SECURITY.md) · [es](SECURITY.md) · [it](../it/SECURITY.md) · [pt](../pt/SECURITY.md) · [de](../de/SECURITY.md)

# Modelo de seguridad: beta no auditada

jaunt proporciona un shell completo bajo la cuenta de host. No hay una caja de arena del sistema de archivos o un solo papel de lectura: un dispositivo autorizado puede actuar como ese usuario. No ejecutar el host con privilegios que los dispositivos remotos no necesitan.

## Lo que está protegido

Los comandos, salida, archivos y datos de portapapeles están cifrados entre el navegador y el host. El relé ve direcciones de red, habitaciones, presencia, tamaños de paquete y tiempo, y claves públicas efímeras. No mantiene secretos de par o dispositivo. El canal es autenticado por un secreto aleatorio de 256 bits, con ECDH efímero y AES-GCM.](docs/PROTOCOL.md).

Los primitivos provienen de criptografía y Web Crypto. **Su composición en este protocolo es nueva y no ha recibido una auditoría externa.** Pruebas de tamper/replay e interoperabilidad no reemplazan una auditoría. No describa jaunt como certificado, invulnerable o listo por defecto para entornos de producción sensibles.

## Lo que no está protegido

- Un navegador comprometido, máquina o cuenta del sistema sigue siendo comprometido.
- GitHub Pages sirve código que puede acceder a secretos después de desbloquear: un atacante que controla el repositorio o página puede reemplazar el JavaScript. Encriptación de extremo a extremo no protege contra una actualización de cliente maliciosa.
- Sin una contraseña, las claves se almacenan sin cifrar en IndexedDB, como una sesión recordada. Una contraseña/PIN las encripta en reposo; un corto PIN sigue siendo vulnerable a la conjetura offline.
- El bloqueo detiene las conexiones y aclara las vistas activas. No garantiza la borración criptográfica de la memoria RAM del navegador.
- Un código QR completo otorga acceso shell durante diez minutos. Nunca lo ponga en un problema, captura de pantalla pública, registro de CI o análisis.
- Las notificaciones del navegador se envían a través del servicio de empuje del navegador. Los títulos y los cuerpos de notificación proporcionados por programas se muestran y envían a través de ese servicio; no incluyen secretos en notificaciones. Android sigue los ajustes de privacidad de pantalla de bloqueo del sistema.
- Un dispositivo revocado ya no puede autenticar hasta el canal, pero conoce la capacidad de enrutamiento compartida anterior. Todavía puede interrumpir la disponibilidad de relés hasta que la identidad de host sea rotada. Los secretos de enrutamiento no son un sistema completo de cuota o anti-DDoS.

## Origen de las páginas de GitHub compartido

Sitios en `moukrea.github.io/another-project/` y `moukrea.github.io/jaunt/` compartir un origen del navegador. Otro proyecto vulnerable en ese origen podría apuntar jaunt's de almacenamiento. Los caminos no son un límite de seguridad. jaunt en un origen dedicado (su propio dominio/subdominio) y par de nuevo allí. Un PIN protege las llaves en reposo pero no reemplaza el aislamiento de origen o la confianza en el JavaScript ser servido.

## Almacenamiento y permisos

`~/.local/share/jaunt/host.json` y la toma de control son privados a la cuenta actual. El directorio utiliza el modo 0700, el estado utiliza 0600 y escribe son atómicos. `attachments/` contiene archivos cargados; bloquear la aplicación no los elimina. Eliminar archivos adjuntos sin necesidad a través del navegador de archivos.

Las teclas persistentes nunca aparecen en las URL de solicitud: emparejar utiliza el fragmento, que se elimina inmediatamente de la historia. Las capacidades de relé se envían en el primer marco WebSocket sobre TLS. El Trabajador no registra las cargas de pago.

## Despliegue

Uso HTTPS/WSS fuera de loopback, restringir APP_ORIGIN al origen exacto de las Páginas, permitir MFA y las protecciones de rama, minimizar Cloudflare/GitHub permisos, y monitorear cuotas y costos. No añadir scripts de análisis de terceros o extensiones a la página. El CSP estático bloquea scripts inline y evaluación dinámica; las dependencias son locales. GitHub Las páginas no pueden establecer cada encabezado de seguridad del servidor; use un dominio/proxy controlado para mayor endurecimiento.

## Reporting a vulnerability

Utilice el canal de reporte de vulnerabilidad privada del repositorio cuando esté disponible. Nunca publique una clave, código QR, registro confidencial terminal, archivo host.json o exportación de bóveda. Antes de la divulgación pública, el encargado debe establecer un canal de reporte privado y una política de rotación.

## Límite de escritorio

El renderizador de escritorio es sandboxed, con Node integración discapacitada y aislamiento de contexto habilitado. Recibe una interfaz IPC de precarga estrecha, validada contra el marco principal de la aplicación. `jaunt://app/` esquema; navegación externa abre el navegador del sistema y nunca recibe el puente host. El relé también admite el origen exacto del renderizador nativo `jaunt://app` para conexiones remotas de escritorio; los orígenes arbitrarios del navegador siguen siendo rechazados. Los controles de origen no son autenticación: los clientes nativos todavía necesitan las capacidades de enrutamiento y el apretón de manos encriptado host-authenticated. El acceso local utiliza la toma de control Unix privada existente y otorga los mismos privilegios de cuenta que el CLI. No es un segundo oyente de red y no evita la autenticación remota.

La versión de escritorio y el instalador de host son parte de la superficie de actualización confiable. Checksums detectan artefactos corruptos/memorados; no protegen contra un editor de repositorios/release comprometidos. Los paquetes de escritorio contienen sólo archivos de aplicaciones permitidos y dependencias de tiempo de ejecución, no estados anfitriones o perfiles de usuario.
