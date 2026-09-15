[English](../../../UPDATES.md) · [fr](../../fr/docs/UPDATES.md) · [es](UPDATES.md) · [it](../../it/docs/UPDATES.md) · [pt](../../pt/docs/UPDATES.md) · [de](../../de/docs/UPDATES.md)

# Actualizaciones sin perder sesiones o identidades

## Host

El instalador público configura actualizaciones automáticas por defecto. El host comprueba el lanzamiento seleccionado por la página publicada después de la puesta en marcha y cada 15 minutos. Esto lo mantiene en el canal de implementación validado del propietario. Una salida de fuente no tiene autoridad de instalación automática; primero debe ser instalado a través del instalador público.

Una nueva rueda es descargada HTTPS y verificado en contra de su manifiesto de liberación. El instalador se lee desde esa rueda verificada. Python tiempo de ejecución en el lugar con `exec`: el daemon PID, niño shell procesos y abiertos PTY los descriptores siguen vivos. terminal geometría pasa a través de un descriptor de archivos privado sin conexión. variables de entorno, directorios de trabajo y comandos de funcionamiento permanecen en sus procesos originales. Los clientes vuelven a conectarse usando sus claves existentes. tmux.

El instalador valida el nuevo tiempo de ejecución antes de solicitar la entrega y deja de aceptar nuevas sesiones durante el interruptor. Si la preparación falla, el antiguo host vuelve a servir su shells existente. El modo automático nunca hereda `jaunt_ALLOW_RESTART` o descarga del desarrollador se anula.

**Migración de los anfitriones mayores:** liberaciones sin pasar tiempo libre no pueden preservar su PTYs a través de un reemplazo de tiempo de ejecución. El instalador detecta esa capacidad y aplaza mientras que ordinario shells están activos. Para terminar con ellos todavía requiere aprobación explícita a través de **Actualizar y reiniciar** o `jaunt update --allow-restart`. Un ordinario `jaunt update` Después de esta migración de una sola vez, las actualizaciones compatibles posteriores usan el desvío automáticamente.

Ajustes sigue la actualización a través de su progreso y la reconexión automáticamente. Actualizaciones de aplicaciones preservar shells; detener/reiniciar explícitamente el daemon o reiniciar el equipo todavía termina shells ordinario. Este mecanismo no es recuperación después de un accidente de daemon o pérdida de energía.

El actualizador separado utiliza una cerradura privada para evitar las actualizaciones superpuestas y retener el tiempo de funcionamiento antiguo hasta que el reemplazo verificado esté listo. Se conservan registros de identidad y dispositivo host. Privado `installation.json`, `update-status.json`, `update.log` y ruedas escenificadas nunca liberan activos.

## Android

El APK cheques públicos Android libera automáticamente, con un cheque manual en Ajustes. Verifica bytes descargados, identidad de paquete, una versión estrictamente nueva y el mismo certificado de firma antes de abrir Android's installer. Los datos de la aplicación y el emparejamiento se conservan durante una actualización. Android requiere confirmación del usuario para APK instalación y puede pedir una vez permiso para instalar actualizaciones desde jaunt. Este es un límite del sistema operativo, no un servicio de nube perdido o cuenta de usuario final.

Ver [Android detalles y validación](ANDROID.md). Los cheques de actualización, los cheques de firma y las pruebas funcionales no constituyen una auditoría de seguridad independiente.

## Aplicación de escritorio

El interfaz de escritorio tiene su propia versión de lanzamiento y actualización, separado del host/CLI. Comprueba el canal publicado poco después de la puesta en marcha y cada 15 minutos, selecciona el paquete Linux/macOS para el CPU actual, y verifica SHA-256 después de la descarga y otra vez antes de la instalación.

Una fila de actividad visible sigue comprobando, descargando, verificación, preparación y errores. **Install and reopen** aplica un paquete verificado y vuelve a abrir el mismo perfil de aplicación. Con actualizaciones automáticas activadas, cerrando la aplicación también aplica una actualización lista.El instalador GUI desprendido nunca detiene el servicio de host o termina su shellsUn sistema `.deb`/`.rpm` instalación o protección macOS ubicación de la aplicación puede requerir autorización del sistema operativo. macOS las construcciones siguen sin ser firmadas y sin ser asignadas.

El resultado de la instalación se mantiene en el perfil privado de escritorio. El fallo se muestra en el próximo lanzamiento; no está inmediatamente oculto por el cheque de inicio. El escritorio más antiguo construye una instalación de un lanzamiento que incluye este actualizador, utilizando el paquete público o `jaunt gui --install-only`.

## Progresos visibles

Las transferencias de imagen web y escritorio conservan su resultado real: carga verificada e inserción de ruta citada sin Enter, o la finalización del portapapeles anfitrión más Ctrl+V no reclaman que CLI reconocimiento de un apego. Los cheques anfitriones muestran la terminación, el fracaso o el aplazamiento explícito para el trabajo activo. Android utiliza diálogos de progreso nativo para cheques y APK descargas, seguido por la confirmación del instalador del sistema operativo.
