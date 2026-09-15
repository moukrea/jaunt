[English](../../../WORKSPACE.md) · [fr](../../fr/docs/WORKSPACE.md) · [es](WORKSPACE.md) · [it](../../it/docs/WORKSPACE.md) · [pt](../../pt/docs/WORKSPACE.md) · [de](../../de/docs/WORKSPACE.md)

# Espacio de trabajo compartido terminal

Cada uno shell pertenece al daemon host, no a la ventana que lo creó. La aplicación de escritorio, Android aplicación, y los navegadores autorizados pueden adjuntar a la misma corriente PTY al mismo tiempo. tmux es opcional. terminales existentes creados fuera jaunt no se adoptan retroactivamente; crear un jaunt shell o adjuntar explícitamente una tmux período de sesiones.

## Períodos de sesiones y opiniones

#New shell** inmediatamente crea un terminal con un nombre automático, como `bash 1`. Su directorio sigue el anterior activo shell, incluido `cd` cambios en los hosts soportados. El icono de carpeta abre **Nuevo shell en la carpeta**, con la navegación del directorio y un nombre opcional. Si el sistema operativo no puede leer un shell’s directorio actual, el host utiliza que shell’s directorio inicial.

Use **Sesiones** junto a las pestañas para ver cada sesión retenida en el host seleccionado, incluyendo sesiones sin vista abierta. La lista muestra si cada shell está funcionando y qué dispositivos lo tienen abierto.

- **Renombre** cambia el nombre de sesión compartido. Haga doble clic en un nombre de pestaña o haga doble clic en un título de panel para cambiar su nombre también.
- **Open** adjunta este dispositivo al shell existente y su historia retenida.
- La vista de la pestaña **×** o **Cerrar** se desmonta sólo esta vista. El shell y otros clientes permanecen conectados.
- **Terminate** pide confirmación, luego termina el shell y sus trabajos para todos los espectadores. Para tmux mata explícitamente que tmux sesión, incluyendo archivos adjuntos fuera de jaunt.

La terminación ordinaria cubre los procesos en el shellEs POSIX terminal sesión, incluidos los grupos de control de empleo de fondo. Un proceso deliberadamente embalado en una sesión separada del sistema operativo está fuera de ese límite. La terminación de sesión no es un proceso general / caja de arena de contenedores.

shells exited mantiene su estado de espera hasta que se retire la sesión, reservando al líder PID para que los trabajos de fondo sobrevivientes puedan terminarse con seguridad.

Cerrar la aplicación, perder una conexión de red o bloquear su bóveda no termina shells. Actualizaciones de host compatibles conservan ordinario shell procesos y su historia a través de un reemplazo en tiempo de ejecución en el lugar. Una parada / reinicio daemon explícito todavía los termina. Legacy hosts sin actualizaciones de aplazamiento de mano mientras ordinario shells están activos a menos que se autorice expresamente el reinicio. tmux permanece disponible cuando se necesita la persistencia independiente.

Las pestañas conservan su pedido cuando se selecciona. Arrastrelas para reordenar; en un uso de teclado Alt+Shift+Left/Right. Renombramientos de doble clic; tener una pestaña no abre el nombre. Grupos de separación de escritorio y el pedido de la pestaña móvil se mantienen en las reconexiones. La barra lateral de escritorio puede colapsar, y su preferencia se guarda.

## Dimensiones compartidas y desplazamiento

Cada sesión tiene un tamaño PTY. Hacer clic/tocar o escribir en una vista hace que el dispositivo controle su tamaño. Reactivar una ventana pasiva no roba el control. Las vistas pasivas conservan la geometría compartida y pueden desplazarse horizontal o verticalmente cuando el terminal del otro dispositivo es más grande. Haga clic en el interior para adaptarse a su pantalla.

El terminal's elemento interno medido no tiene relleno; los márgenes UI circundantes están excluidos de su renglón/culumn recuento. Android barras y teclado reservan su propio espacio. El botón **↓ Última** vuelve a la salida reciente; desplazarse hacia arriba sigue siendo posible mientras la salida continúa. **Seleccion** abre un control de texto nativo para los mangos de selección móvil y copiar retenidos terminal texto. Selección de ratón de escritorio y Ctrl/Command+Shift+C permanecen disponibles.

xterm 6 admite salida sincronizada (modo 2026). El comportamiento de pantalla alternativa específico de la aplicación sigue siendo aplicable: la pantalla alternativa no es un buffer de desplazamiento ilimitado. Un programa terminal puede limpiar intencionalmente su propia pantalla o elegir deshabilitar su propia historia. jaunt no reescribir las secuencias de escape del programa en la salida fabricada.

## Tapas de azulejos

En el escritorio, los dos iconos de división eligen lado a lado o por encima de la colocación. Su selector de línea ofrece un nuevo shell o cualquier sesión fuera del grupo de división actual. Arrastre el separador, o concéntrelo y utilice las teclas de flecha. Cada pestaña puede contener un árbol dividido; seleccionando otra pestaña conserva grupos anteriores. El panel **Move a su propio icono de pestaña** en cada encabezado de panel se separa sin terminar ninguna sesión.

Los diseños, ratios, vistas abiertas, orden de host, nombres amistosos y el host predeterminado se almacenan en la bóveda de este dispositivo. Sobreviven la reconexión y la reapertura de aplicaciones. En el móvil, cada sesión en un grupo dividido aparece como una pestaña ordinaria; volver a la anchura de escritorio restaura el arreglo de división. Las preferencias de diseño son por cliente, por lo que un dispositivo no reorganiza el espacio de otro dispositivo.

## Instalación de escritorio y controles de host

El instalador de host gráfico instala la aplicación de escritorio para el usuario actual cuando se anuncia una versión de escritorio. `jaunt gui` para instalar / abrirla, o `jaunt gui --install-only` para añadir el lanzador de aplicaciones sin abrir una ventana. Linux paquetes y macOS aplicaciones también se proporcionan en la versión de escritorio. La aplicación se llama **jaunt** y utiliza la obra de arte suministrada.

La interfaz de escritorio es la misma interfaz agrupada que el cliente web, con un grupo adicional **Esta computadora** configuración: instalar/actualizar el host, iniciarlo, instalar su servicio de inicio de sesión, emparejar otro dispositivo, y autorizar explícitamente una actualización/restaurante. También puede emparejar a otros hosts como un cliente normal. Local shells son accesibles a través de un conector Unix de la misma cuenta privada sin requerir una conexión de relé.

Linux Los archivos del espacio-usuario dependen del sistema que permite la caja de arena de Chromium. Ubuntu restricción de ese mecanismo, `jaunt gui` y el instalador gráfico selecciona automáticamente el `.deb` el paquete y la autorización del sistema de solicitud si es necesario. El paquete configura su perfil de AppArmor. Los lanzadores de producción nunca añadir `--no-sandbox`. macOS Los artefactos de escritorio no se firman; los avisos de confianza del sistema operativo pueden aplicarse. Cerrar la ventana de escritorio deja el daemon y shells las notificaciones de escritorio requieren que la aplicación de escritorio siga funcionando.

## Preferencias y notificaciones

Ajustes utiliza un icono de engranaje. La oscuridad es el predeterminado. La luz, el sistema y el circadiano también están disponibles; Circadian utiliza la luz de 07:00 a 19:00 en la zona horaria local del dispositivo.

Cada host expone interruptores de evento para terminal campanas, notificaciones de programas (OSC 9 y OSC 777), y salida de sesión. Estos interruptores afectan a la generación de eventos de host. Permite la entrega por separado en cada cliente: nativo Android notificaciones de antecedentes, navegador Web Push, o notificaciones del sistema operativo de escritorio. `jaunt notify` y `jaunt run -- command` Quedan disponibles para las notificaciones explícitas y la terminación individual del comando. shell no puede inferir confiablemente la noción de cada aplicación de “pensamiento terminado”.

Las notificaciones omiten la salida terminal por defecto. Los permisos del navegador/OS, parada de fuerza, políticas de batería, disponibilidad de red, y el host en línea afectan la entrega de fondos. No se reclama la entrega garantizada o la auditoría de seguridad independiente.

Las notificaciones del programa preservan el texto del mensaje OSC 9 y el título/cuerpo OSC 777. Al hacer clic en una notificación nativa se selecciona su host y sesión, incluso después de reconectarse o desbloquear. Android sigue la configuración de privacidad de la pantalla del sistema operativo.

Los pictogramas de interfaz utilizan iconos de Lucide enganchados localmente (licencia de CS). La obra de arte jaunt suministrada sigue siendo el logotipo de aplicación; los paquetes Linux incluyen tamaños de iconos estándar y Android utiliza un envoltorio de lanzamiento adaptativo alrededor de esa obra de arte.

## Actualizaciones y progresos visibles

Host/CLI y las versiones de escritorio son separadas. El host comprueba automáticamente y espera a ordinario shells y transferencias para terminar antes de reiniciar. El escritorio comprueba la puesta en marcha y cada 15 minutos, verifica las descargas, e instala cuando se cierra la ventana. Ajustes ofrece cheques manuales y Instala y vuelve a abrir. Instalación de escritorio preserva las máquinas guardadas de la aplicación y no detiene el host shells; los paquetes del sistema pueden requerir un aviso de autorización del sistema operativo. Android verifica su APK y firma de identidad antes de entregar la instalación Android.

La franja de actividad sigue siendo visible a través de la preparación, subida, verificación e inserción de imágenes. La compleción distingue un camino insertado sin Enter de un PNG colocado en el portapapeles de host con Ctrl+V enviado. Nunca promete que un CLI específico reconoció un accesorio. Los cheques de actualización reportan corriente, instalada, esperando el shells activo, o fallado; los resultados completo/error permanecen hasta que se des.

### Iconos de programa de primer plano

Tabs and pane captions use the locally packd Meteor Icons Claude and OpenAI marks while the owned PTY El programa del primer plano es `claude` o `codex`. Detección refresca una vez por segundo y envía sólo la categoría del programa, nunca ordena argumentos. shell restaura los terminal icono. Los nombres de las sesiones amigables no afectan la detección. tmux sesiones y envolturas no reconocidas conservan terminal ícono. Meteor Icons 4.4.0 está licenciado en MIT; su licencia está incluida en el paquete web.
