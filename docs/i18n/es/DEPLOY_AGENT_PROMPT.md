[English](../../../DEPLOY_AGENT_PROMPT.md) · [fr](../fr/DEPLOY_AGENT_PROMPT.md) · [es](DEPLOY_AGENT_PROMPT.md) · [it](../it/DEPLOY_AGENT_PROMPT.md) · [pt](../pt/DEPLOY_AGENT_PROMPT.md) · [de](../de/DEPLOY_AGENT_PROMPT.md)

# Plazo de entrega: jaunt

Usted ha autorizado el acceso GitHub a `moukrea/jaunt`. Integrar e implementar el proyecto en este archivo. No leer la aplicación antigua para la inspiración: este proyecto es una reescritura. Preserve el estado anterior en una rama de respaldo, luego trabajar a través de una rama y PR. No fuerza-push o borrar la historia.

El requisito no negociable es el acceso real a shells arbitrario a través de una interfaz móvil/desktop UI, no sólo los agentes Claude/Codex. Instalación de un solo servidor, no VPN/Tailscale o configuración del servidor para usuarios finales. Pare una vez por código QR, teclas persistentes, cambios de red sin emparejar de nuevo, archivos, sesiones y múltiples.

## Ejecución

1. Lea README.md, SEGURIDAD.md, docs/VALIDATION.md, y docs/DEPLOYMENT.md; inspeccione el código entregado. No vuelva a escribir los componentes de trabajo simplemente para simplificarlos. No esconda las limitaciones documentadas.
2. Instalar dependencias de construcción/prueba y generar y comprometer un paquete-lock.json real. Verifique las versiones actuales y los avisos de seguridad. `npm run prepare-web` debe producir una copia jsQR local y su licencia. No corrertime JavaScript de un CDN. Verifique cada importación y recurso bajo la ruta `/jaunt/` publicada.
3. Ejecutar pytest, relay Node test, real Miniflare tests, check_project, build_release, y el navegador E2E pruebas. Lea fallos y corrija sus causas; nunca sólo eliminar las afirmaciones o características. Reporte comandos, versiones, y los resultados realmente observados.
4. Deplorar el Trabajador usando la cuenta Cloudflare autorizada. Los secretos necesarios son CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID. Si la autorización Cloudflare no está disponible, solicite SOLAMENTE que la autorización faltante a través del mecanismo seguro adecuado y explique que un token GitHub no lo otorga.
5. Configure APP_ORIGIN, verifique la salud Y WebSockets real, luego establezca jaunt_RELAY_URL en GitHub. Publish the host tag/release and its three assets before Pages. Set jaunt_RELEASE_TAG y active Pages a través de Acciones. Trigger the Pages workflow and verify its actual URL.
6. Realice una instalación real de la versión pública en una máquina limpia, no fuente editable. Verifique la suma de comprobación, servicio de usuario, startup y código QR. Verifique las actualizaciones de preservación de la identidad y la negativa a matar silenciosamente shells activo. Destruirlos debe continuar requiriendo autorización de reinicio explícita.
7. Ejecutar el flujo de aceptación final a extremo: página pública → emparejamiento → shell → comando con salida probada → nueva pestaña → volver a la primera shell → imagen / texto subida → descarga con comparación byte → relé / interrupción de red → misma sesión sin un nuevo QR → revocación. En un teléfono físico autorizado, cámara de prueba QR escaneado, teclado, galería, rotación, Wi-FiInterruptor móvil, PWA, y empujar con la pantalla bloqueada. Nunca pretende haber usado un teléfono si no hay ninguno disponible.
8. Preserve la distinción entre subida-plus-path sin Enter y pasta nativa condicional. No reclamar un apego Claude/Codex cuando sólo se insertó un camino. Haga el retroceso sin cabeza explícito. Nunca prometer un portapapeles OS que no existe.
9. Nunca publique host.json, .dev-state, secretos, códigos QR, exportaciones de bóveda o registros privados terminal. Inspeccione el contenido de ZIP/libere los flujos de trabajo antes de la publicación. No realice escaneos destructivos en los directorios personales del usuario para las pruebas.
10. Entregar la URL publicada, comando validado de instalación, etiqueta/release, informe de prueba y limitaciones no validadas restantes. No entregar 40 tareas manuales. El despliegue del propietario ocurre una vez; los usuarios finales no deben necesitar cuentas Cloudflare/GitHub para conectar.

## Bloqueadores de publicidad

Un relé inconfigurado, pasta de imagen falsamente reclamada, shell no funcional creado, pruebas de paso artificial, importación de la JS desaparecida, versión inventada/URL, o secretos de repositorio bloquean la publicación. La seguridad del protocolo no ha sido auditada: retener esa revelación incluso cuando todas las pruebas pasan.
