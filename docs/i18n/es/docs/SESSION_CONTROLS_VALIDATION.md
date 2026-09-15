[English](../../../SESSION_CONTROLS_VALIDATION.md) · [fr](../../fr/docs/SESSION_CONTROLS_VALIDATION.md) · [es](SESSION_CONTROLS_VALIDATION.md) · [it](../../it/docs/SESSION_CONTROLS_VALIDATION.md) · [pt](../../pt/docs/SESSION_CONTROLS_VALIDATION.md) · [de](../../de/docs/SESSION_CONTROLS_VALIDATION.md)

# Validación de los controles de sesión

El gestor de sesión anidadó previamente botones de file-menu de ancho completo dentro de una fila horizontal sin rotura. Acciones desbordaron el diálogo; el renombre estaba ausente de la lista. Ahora utiliza tarjetas de sesión sensibles y acciones explícitas Open, Rename, Close view y Terminate.

Ordinario shell creación ya no abre un diálogo de nombramiento. La acción de la carpeta proporciona la navegación del directorio con un nombre opcional. shell's directorio actual; hosts mayores utilizan el último directorio inicial conocido. Controles de división de escritorio selecciona la orientación directamente y muestra un nuevo/existing-session selectr inline. Cada panel de azulejos puede moverse en una pestaña independiente sin crear o terminar un PTY.

Observado localmente el 2026-09-15:

- Python 3.14.2: `python -m pytest -q` — 67 pasados, incluyendo marcos de flujo tardío inofensivo después de la terminación, la herencia real del directorio PTY después de `cd`, anulación explícita del directorio y nombres automáticos no alineados.
- Node 25.5.0: `npm test` — 27 pasados; `npm run test:relay` — 2 pruebas reales Miniflare/workerd pasadas.
- `python tests/shared_workspace_e2e.py` en Electron con un host de fijación aislado — aprobado. Ejercicios locales/remote compartido PTYs, ambas orientaciones divididas, selección de la sesión existente, moviendo un panel a una pestaña, recargar persistencia, aplanamiento móvil, límites de sesión-acción en 390 y 1300 píxeles, renombre local/close/reopen/terminate directorio real de herencia ejecutada, directorio automático de creación de archivo
- `python tests/browser_e2e.py` — 23 escenarios pasados.
- `python tests/terminal_render_e2e.py` — geometría de desplazamiento/keyboard y Claude Code/Codex actual aislado.
- El paquete de escritorio Linux construyó aprobó el mismo control de sesión ampliado E2E. `node scripts/check_desktop_package.mjs` verificados importaciones, obras de arte y permisos de lanzamiento.
- `python scripts/check_project.py` y `python scripts/build_release.py` pasaron durante el desarrollo.

El Electron El arnés de prueba desactiva su caja de arena en aislamiento; esto no es una configuración de lanzamiento de la producción. Ubuntu 24.04 con el renderizador Seccomp=2 y NoNewPrivs=1; un nuevo local shell escribió un nuevo archivo de prueba. APK aprobado Android prueba de emulador para el tamaño real de IME, el desplazamiento táctil, el contenido de rotación y notificación / selección de objetivos. El primer intento de emulador encontró una salida externa del proceso UIAutomator 137; rerunning the unchanged APK el instalador aprobó los 9 cheques, incluyendo el rechazo de la suma de comprobación, la importación de la rueda, activo-shell protección y reinicio explícitamente autorizado con identidad preservada. Las observaciones de la entrega pública se registran a continuación. No se hace ninguna reclamación de teléfono físico.

Una prueba de instalación expuso un defecto adicional: el antiguo instalador llamado `service stop` incluso con `jaunt_NO_SERVICE=1`, parando el servicio local real del encargado. El servicio fue reiniciado; PTYs ordinario no puede ser recuperado después de una parada de daemon. El instalador ahora respeta el modo de no servicio durante el cierre también.

CI también reprodujo una carrera de distribución-salvar en la recarga inmediata después de dividirse. La selección de sesión ahora persiste el diseño antes de renderizar o esperar el accesorio terminal. La aserción de carga inmediata permanece en la prueba de espacio de trabajo compartido.

## Operaciones visibles y actualizaciones de escritorio

La franja de actividad conserva el progreso de la carga y el resultado final real: la inserción verificada del archivo/pata sin Enter, o la finalización del portapapeles anfitrión más Ctrl+V no reclama el reconocimiento como Claude Code/Codex adjunto. También sigue los estados de actualización de host mediante la comprobación, descarga, verificación, instalación, fallo explícito y aplazamiento para activos shells. IDs de operación evitan que un viejo resultado se muestre como una actualización recién solicitada.

El actualizador de escritorio comprueba el canal publicado en startup y cada 15 minutos, descarga sólo el activo de lanzamiento de propiedad del proyecto coincidente, y verifica SHA-256 tanto después de la descarga como antes de la instalación. La instalación automática funciona cuando la aplicación de escritorio cierra. Ajustes proporciona una actualización automática, control manual, progreso visible y Instala y reabrir. Linux paquetes de sistemas y protegidos macOS ubicaciones de aplicaciones pueden requerir autorización del sistema operativo. El instalador separado no llama al host CLI o un administrador de servicios; terminal las sesiones pertenecen al proceso de host separado.

Node Las pruebas cubren la selección de versiones/gastos, las fases de progreso, los resultados de la conversión actual, el rechazo de la suma de comprobación, la revalidación antes de la instalación, y el reemplazo real de extracción/aplicación de archivos en un hogar aislado, mientras que un proceso no relacionado y datos de identidad guardados permanecen intactos. Electron test también sube una imagen a través del puente local y verifica el indicador de terminación persistente. Android ahora muestra un diálogo de verificación explícito y determina el progreso de descarga cuando se dispone de una longitud de contenido.

CI encontró además un ID de dispositivo base64url generado que comienza con un hifeno. La prueba de revocación del navegador ahora pasa `--` antes del ID de posición, como ya lo hizo el examen de escritorio; las afirmaciones de revocación y reserva de sesión permanecen sin cambios.

## Entrega publicada — 2026-09-15

Los resultados de la publicación y la instalación pública a continuación se registraron después de la publicación. Complementan las observaciones locales y del CI anteriores.

- PR: https://github.com/moukrea/jaunt/pull/22
- Página: https://moukrea.github.io/jaunt/
- Host: v0.1.0-beta.10 (CLI 0.1.0b10)
- Escritorio: escritorio-v0.1.0-beta.8
- Android: android-v0.1.0-beta.6 (versionCode 6)

Un candidato de actualización empaquetado privado descargado y verificado el beta de escritorio público existente.7, instaló su paquete Debian y reabrió el mismo perfil en un Ubuntu 24.04 VM. Host y PTY PIDs permanecieron sin cambios, y los comandos ejecutados antes y después de la actualización.

El README completo está en inglés y ahora describe la instalación, el host/desktop/Android/web mecanismos de actualización, creación de sesión y herencia de directorios, ambas orientaciones divididas, resultados de entrega de imágenes, comportamiento de notificación y límites de validación. Todos los enlaces de documentación locales fueron revisados. auditoría npm reportó vulnerabilidades de ceros; pip-audit no informó vulnerabilidades de dependencia conocidas, con el catálogo de auditoría externa.

La implementación fusionada es comprometer `937fb52ea56297326ce3fd090cb66802a76a063d`. La validación requerida CI, Android y ambas construcciones de distribución Linux/macOS pasaron antes de la fusión. La versión final del registro Node sólo encontró un nuevo Miniflare alpha; el Miniflare 4.20260730.0 probado fue retenido.

Los tres activos de hospedaje público pasaron manifiesto/SHA-256 validation and a gitleaks scan of the extracted wheel. A real public beta.9→beta.10 installation in the Ubuntu VM retenía la identidad de host y dispositivo. Antes de Pages promocionar esta prueba seleccionó explícitamente la etiqueta host ya publicada. APK beta.5→beta.6 actualización retenía el emparejamiento existente y reconectó sobre el trabajador real del propietario. Automatización UI nativa en la liberación APK creado a shell, ejecutó un comando probado por un archivo, y terminó la sesión de fijación. APK no era debuggable, y su suma de comprobación pública y certificado de firma grabado coinciden.

Todos los diez activos públicos de escritorio coincidieron con su catálogo SHA-256 publicado. Ambos archivos Linux y macOS, para x64 y ARM64, contenían el actualizador esperado, la actividad visible UI, los recursos locales jsQR y Lucide, el logotipo original sin cambios, y los enlaces de lanzamiento actuales host/Android/desktop ausentes.

El comando de instalación exacto de la página pública pasó posteriormente en un nuevo Ubuntu cuenta de usuario (servicio de usuario activo habilitado y QR producción) y un nuevo Fedora 43 contenedores. La página desplegada sirvió a los 29 recursos comprobados bajo `/jaunt/` con igualdad de byte. La receta pública real demostró emparejamiento, un cheque de actualización de host completado, arbitrario shell ejecución, pestañas de conmutación, subida/descarga de multichunk igualdad de byte, inserción de imagen/pataje sin Enter, recargar y una interrupción real de la red de invitados que regresa a la misma shell PID, la negativa de actualización protegida, la fijación autorizada explícitamente reinicia con identidad preservada, y la revocación.

El público Android beta.5 aplicación también realizó su propia actualización beta.6 a través del descubrimiento del canal, HTTPS descarga, checksum/signature verificación, la Android la pantalla de permiso y el instalador de paquetes OS. El emparejamiento existente sobrevivió. Su posterior cheque explícito muestra un resultado actualizado. Android's etiquetas de botón superior, vista de permiso verificable, y el botón Abrir del instalador; estas fueron correcciones de navegación de prueba, no el resultado de la aplicación anula.

## Seguimiento: retroalimentación asincrónica constante

El seguimiento elimina cascadas de tostadas de conexión-error, mantiene errores de diálogo/pair al lado de su acción, y limita tostadas de confirmación corta. Los controles de actividad mantienen los nodos DOM estables mientras los cambios de progreso; los resultados completados colapsan en la historia accesible y el progreso tardío no puede sobreescribir la terminación. Descargas, configuración de servicios, esperas de red, cancelación y acciones disponibles utilizan el mismo área de actividad.

La última generación asincrónica de claves y respuestas de bienvenida descifradas son rechazadas cuando se ha iniciado una conexión de reemplazo. Interrupciones de transporte de reingreso; verificación de host fallado todavía detiene la conexión. El puente de escritorio nativo ignora los inicios cancelados y retrata los fallos de conexión locales. Android coalesces cheques/descargas simultáneos y reemplaza su diálogo de resultado en lugar de apilamiento.

Se observa localmente: 29 Node las pruebas pasadas, incluyendo dos regresiones de la conexión estacional. La retroalimentación dedicada E2E pasó con tres interrupciones reales del apretón de manos, cinco RPCs interrumpidos, sin cascada de errores, reconexión a la misma PTY, errores contextuales, controles estables de progreso clicable, historia compacta retenida y móvil terminal El navegador E2E pasó los 23 escenarios; compartidos Electron y efectivos aislados Claude Code/Codex terminal-render tests pasados. La fijación host/browser ahora utiliza sus propios directorios de datos INIC y XDG, por lo que la navegación inicial de archivos no puede enumerar directorios personales. No se reclama ningún teléfono físico o una auditoría de protocolo independiente.


La regresión Configuración seleccionada también está cubierta: cambiar la barra lateral mientras que Configuración está abierta ahora reconstruye los controles de host de inmediato, refresca el estado de actualización del host seleccionado, e ignora las respuestas de la selección anterior. Los controles de servicio local de escritorio sólo aparecen para el host local; actualizaciones de aplicaciones de escritorio y notificaciones permanecen en la configuración del dispositivo.

Validación observada: `python tests/feedback_e2e.py` emparejaron dos hosts reales aislados, cambiaron entre ellos sin salir de Ajustes, renombrado Y, olvidado X y verificado Y's shell PID fue invariable. `DISPLAY=:179 python tests/desktop_remote_e2e.py` usados Electron's real local connection and the owner's public WSS relé, controles verificados de servicio local desaparecen en la selección remota y regresan a la selección local, luego se ejecutan y terminan un dispositivo shell. `python scripts/check_project.py` los fallos iniciales de la nueva prueba fueron un selector de configuración solo móvil oculto y una persistencia de la bóveda asincrónica de las carreras de aserción; las pruebas ahora utilizan el botón Configuración de escritorio visible y esperan el nombre guardado antes de cambiar. No se eliminaron las afirmaciones de la aplicación.
