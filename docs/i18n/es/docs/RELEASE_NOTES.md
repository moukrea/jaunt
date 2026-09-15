[English](../../../RELEASE_NOTES.md) · [fr](../../fr/docs/RELEASE_NOTES.md) · [es](RELEASE_NOTES.md) · [it](../../it/docs/RELEASE_NOTES.md) · [pt](../../pt/docs/RELEASE_NOTES.md) · [de](../../de/docs/RELEASE_NOTES.md)

# jaunt 0.1.0-beta.11

Actualizaciones de host compatibles ahora reemplazan el tiempo de ejecución mientras preservan los procesos ordinarios shell, sus directorios de trabajo, el entorno y la historia de terminal. Los clientes vuelven a conectarse automáticamente. Los huéspedes mayores necesitan una migración protegida: su shells activo no se puede conservar retroactivamente, y el instalador todavía requiere autorización explícita antes de terminarlos.

El espacio de trabajo compartido fija etiquetas de configuración exprimidos, posiciones de pestañas inestables, saltos de historia móvil y mensajes de error sobredimensionados. Las pestañas soportan la orden de arrastrar y soltar y renombrar doble clic; la barra lateral de escritorio puede colapsar. Claude y Codex Los programas de primer plano utilizan los iconos de marca Meteor agrupados localmente en fichas y tapas de pane. Otros programas conservan los terminal icono.

Web, escritorio, Android y CLI sistema de soporte de detección de idiomas y preferencias explícitas en inglés, francés, español, italiano, portugués y alemán. El inglés sigue siendo la documentación de repositorio canónico, con copias traducidas enlazadas. La página web introduce el proyecto y proporciona comandos de instalación copiables; las aplicaciones nativas abren el espacio de trabajo directamente.

El instalador ofrece `--client-only` para un cliente de escritorio sin instalar un host local o exponer los controles de host locales. Las operaciones de actualización y transferencia conservan el progreso visible y los resultados finales. Las ventanas de escritorio se titulan `jaunt`; la aplicación web instalada se llama `jaunt (PWA)`. Los iconos lanzador y web utilizan la obra de arte transparente suministrada.

El protocolo no ha sido sometido a una auditoría de seguridad independiente. No se reclama validación de teléfono físico. Véase [Informe de validación](SEAMLESS_WORKSPACE_VALIDATION.md) para las pruebas observadas y los límites de plataforma restantes.
