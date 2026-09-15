[English](../../../TROUBLESHOOTING.md) · [fr](../../fr/docs/TROUBLESHOOTING.md) · [es](TROUBLESHOOTING.md) · [it](../../it/docs/TROUBLESHOOTING.md) · [pt](../../pt/docs/TROUBLESHOOTING.md) · [de](../../de/docs/TROUBLESHOOTING.md)

# Solución de problemas

Síntoma permanente Diagnóstico y acción
|---|---|
Silencio “Relay no ha sido implementado” Silencio La página todavía contiene `relay:null`. Completa el despliegue del propietario. No sustituya una URL ficticia.
Silencio `jaunt` no se encuentra después de la instalación ← Abrir un nuevo shell o utilizar `~/.local/bin/jaunt`. Añadir `~/.local/bin` a PATH si su configuración shell lo excluye. ←
| `curl (23)` al descargar la configuración tención curl no pudo escribir los datos recibidos. El instalador se encuentra en el sistema de archivos de tiempo de ejecución en lugar de `/tmp`, abre los archivos de descarga en Bash, y retries curl escribe fallas a través de Python. El agotamiento real o la negación de escritura en el sistema de archivos de instalación todavía causa un error de almacenamiento.](INSTALLER_FEDORA.md). |
← Consumido o vencido código QR ← En un dispositivo recordado, abra la tarjeta de host en lugar de reutilizar el antiguo código QR. Para un nuevo dispositivo, ejecute `jaunt pair`.
Silencio Host offline Silencio Check `jaunt status`, outbound WSS/443 connectivity, sleep/hibernation, and `jaunt doctor`. No se necesita nuevo código QR.
Silencio Servicio de usuario no disponible Ø `jaunt start` funciona en el fondo. Configurar un servicio de usuario real para la puesta en marcha después del reinicio. En Linux, correr mientras se ha iniciado sesión también depende de la ira sistematizada, que puede requerir un administrador.
tención Actualización rechazada Silencio Ordinario PTYs están activos. Terminarlos, o utilizar explícitamente `jaunt_ALLOW_RESTART=1` y aceptar su terminación. tmux es recomendado para tareas de larga duración. ←
Silencio Cámara denegada o desaparecida Silencio Permitir el acceso de la cámara en HTTPS, seleccionar un archivo de imagen QR, o pegar el código completo. La entrada manual no depende de la cámara.
TEN Imágenes no reconocidas como un agente adjunto TEN Upload-plus-path funciona sin un escritorio gráfico. La pasta nativa requiere un portapapeles de host y una herramienta CLI que la lee. Ver README; no hay controlador de fijación sin cabeza universal.
Silencio No hay notificación de empuje Silencio Check registration in Settings, browser permission, an installed PWA if required, outbound connectivity to the push service, and `jaunt notify`. Las notificaciones no se generan automáticamente para cada aplicación shell.
Silencio Archivo grande rechazado Silencio El límite de host es 512 MiB; las descargas en memoria se limitan a 128 MiB. Utilice la escritura de archivo directa si se ofrece por el navegador. Este límite ayuda a evitar la muerte de una pestaña móvil.
Silencio Perdido PIN Silencio No hay backdoor de recuperación. Restablecer la bóveda local, par de nuevo, y revocar la vieja identidad en el anfitrión. ←
El daemon/OS reiniciado; un PTY común era un niño de ese daemon. Use tmux para sobrevivir a los reinicios de los daemon.
← Copiado texto truncado ANTE Historia está ligado: 2 MiB en el host, 10.000 líneas en el cliente. Redirigir la salida larga a un archivo y descargarlo.
tención Relay 429 Respuesta Silencio El proyecto tiene su propio relé, pero esto no garantiza la inmunidad de las cuotas o el abuso. Chequee las métricas Cloudflare, los recuentos de conexión y los límites de la habitación.

Los registros anfitriones no deben contener secretos. Nunca adjuntar `host.json`, un código QR, una exportación IndexedDB o un archivo confidencial a un informe público. Para desinstalar, ejecutar `jaunt service uninstall`, entonces `jaunt stop`, entonces eliminar los binarios de tiempo de ejecución. Eliminar el directorio estatal sólo después de la copia de seguridad/revocación intencional: contiene identidades y archivos adjuntos.
