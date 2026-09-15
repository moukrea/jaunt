[English](../../../DELIVERY_REGRESSIONS.md) · [fr](../../fr/docs/DELIVERY_REGRESSIONS.md) · [es](DELIVERY_REGRESSIONS.md) · [it](../../it/docs/DELIVERY_REGRESSIONS.md) · [pt](../../pt/docs/DELIVERY_REGRESSIONS.md) · [de](../../de/docs/DELIVERY_REGRESSIONS.md)

# Resoluciones de regresión de entrega — 15 de septiembre de 2026

Este informe sigue fallos reportados por el usuario después de la versión anterior. Las pruebas pasadas anteriores no establecieron el inicio correcto del usuario shell, desplazamiento táctil utilizable, o la ruta de lanzamiento predeterminada del archivo Ubuntu.

## Causas y cambios reproducidos

- Los perfiles de inicio de sesión de Bash pueden omitir `.bashrc`. El shell de servicio, por lo tanto, se perdió PATH adiciones interactivas y colores rápidos. Nuevas sesiones de entorno de inicio de sesión de carga y luego la configuración de bajo interactivo; desaparecido SHELL utiliza la cuenta shell.
- Actualizaciones de host no programadas skip GUI instalación y sistema-autorización. Instalación gráfica interactiva y `jaunt gui` explícita aún instalan la aplicación de escritorio.
- El archivo de escritorio publicado aborta bajo Ubuntu 24.04 espacios de nombres de usuario restringidos con un error de ayuda de caja de arena. El instalador ahora selecciona el paquete del sistema verificado allí, permitiendo que su soporte de AppArmor sea instalado sin desactivar la caja de arena de cromo.
- El logotipo nativo extraResource excluyó su fuente de los activos web empaquetados, rompiendo el logotipo de la aplicación. El recurso nativo ahora utiliza un icono de escritorio generado, conservando el original en activos web.
- El envase de icono Linux utilizó un directorio temático sin indexar 547×547. Ahora incluye ocho tamaños estándar derivados de la obra original. Construir ganchos y permisos de icono explícitos eliminar archivos de lanzador no legibles dependientes de umask.
- Los pictogramas UI provienen ahora de Lucide 1.46.0, empaquetado localmente con su licencia ISC. Android utiliza un envoltorio de lanzador adaptativo alrededor de la obra de arte suministrada.
- UI de nueva sesión ya no ofrece tmux. Las sesiones existentes de tmux y compatibilidad de host permanecen intactas.
- Android touch swipes no desplazaba el puerto virtual de xterm. Un manipulador táctil proporciona desplazamiento e impulso; el redimensionamiento del teclado conserva el ancla de lectura en lugar de saltar a la primera o última fila.
- Se descartó el texto de notificación del programa. Los mensajes OSC 9 y el título/cuerpo OSC 777 ahora llegan a las notificaciones nativas. Los objetivos de notificación siguen pendientes hasta que estén disponibles. terminal La salida se raspa.
- La vista dividida está en la barra de escritorio, con creación directa al lado/bajo, divisiones de sesión existentes, diseño persistente y retroceso de la pestaña móvil.

## Validación local observada

- `npm install` / `npm audit`: dependencias fijas y archivo de bloqueo real; vulnerabilidades cero conocidas en el momento de esta carrera. Node 25.5.0, npm 11.8.0, Electron 44.3.0, electron-builder 26.15.3.
- `.venv/bin/python -m pytest -q`: 63 aprobado en Python 3.14.2, incluyendo las pruebas reales de compromiso PTY-PATH/color-prompt regression y las pruebas de contenido de notificación chunked.
- `node --test tests/js.test.mjs tests/relay.test.mjs`: 21 pasó.
- `npm run test:relay`: pasaron 2 pruebas reales Miniflare/workerd routing.
- `npm run prepare-web` y `.venv/bin/python scripts/check_project.py`: pasados; jsQR local, xterm, Lucide y licencias.
- `.venv/bin/python scripts/build_release.py`: construyó una rueda 0.1.0b9 no editable.
- `.venv/bin/python tests/browser_e2e.py`, también con `jaunt_E2E_RELAY=workerd`: 23 escenarios pasaron por backend.
- `.venv/bin/python tests/terminal_render_e2e.py`: pergamino, ancla de lectura de teclado, selección y temas aprobados, además de la puesta en marcha aislada Claude Code y Codex. No se reclama ejecución de modelo autenticada.
- `DISPLAY=:179 .venv/bin/python tests/shared_workspace_e2e.py`: compartido local/remote PTY, propiedad de geometría, desapego/terminación y caída de panel móvil aprobado.
- Se ha firmado Android lanzamiento/debug crea, forro y tareas unitarias pasadas. `tests/android_workspace_e2e.py` en Android 14/API 34 emulador pasó el giro táctil real, el anclaje real, los inicios del sistema, la rotación, el título/cuerpo del OSC de pantalla y el tapping de la notificación en la sesión correcta.

Solicitando candidatos `.deb` más no editable 0,1.0b9 rueda pasada en Ubuntu 24.04: real PTY ejecución, Seccomp=2/NoNewPrivs=1 renderer, decodificados logotipos en la aplicación, disponibles localmente Lucide y legibles iconos de lanzador estándar. El escritorio candidato también autenticó a través del relé público y demostró un mando a distancia. `scripts/check_desktop_package.mjs` ahora comprueba estos caminos de recursos empaquetados y Linux metadatos en el CI.

Una exportación de fuentes rastreadas limpias pasó gitleaks. Escaneando el ASAR binario produjo dos falsos positivos revisados en identificadores JavaScript vendidos (`FourKeyMap` y `SequencerByKey`); ninguna credencial estaba presente.

## Entrega publicada

PR [20](https://github.com/moukrea/jaunt/pull/20) se fusionó como `cb0cb99910978e0874cf00235a046f47ff297d72` después de pasar todos los cheques. Backup `backup/pre-delivery-fixes-20260915` preserva el estado anterior. No se utilizó ninguna eliminación de fuerza o historia.

- Página pública: https://moukrea.github.io/jaunt/
- Host: [v0.1.0-beta.9](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.9), exactamente tres activos. Todas las sumas de comprobación, las rutas de archivo y los archivos fuente de 16 Python/installer fueron verificados contra la fuente entregada.
- Escritorio: [desktop-v0.1.0-beta.7](https://github.com/moukrea/jaunt/releases/tag/desktop-v0.1.0-beta.7), ten Linux/macOS más SHA256SUMS. Todas las diez descargas coincidieron con las sumas de comprobación. Instalado público Ubuntu paquete: ejecución shell real local y remota, navegador compartido / sesión de escritorio, rescisión de cada lado, ícono ícono ícono
- Android[android-v0.1.0-beta.5](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.5), versiónCode 5. El público APK's 27 recursos de la web empaquetados coinciden con la fuente; el instalador de host es intencionalmente excluido por el Android Se verificó su suma de comprobación y el certificado de firma existente. APK mantenimiento pareado y reconectado. Automatización UI nativa en la liberación APK entonces creó un shell, probó un resultado de comando en el anfitrión, y terminó la sesión. No se utilizó ninguna construcción de liberación depurable.

El comando exacto extraído de la página pública pasó en un contenedor Fedora 43 fresco y una cuenta nueva en el Ubuntu 24.04 VM:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

La instalación gráfica interactiva Ubuntu seleccionó automáticamente el paquete de escritorio del sistema público. El servicio de host fue habilitado, funcionado y conectado; se generó un QR SVG válido sin imprimir ni publicar su secreto. Actualizaciones de host no programadas saltar configuración GUI para que no puedan activar los avisos de autorización de escritorio.

La página pública → Cloudflare → aceptación de la rueda pública pasó 12 cheques: emparejamiento, exacta entrada de 512 caracteres, múltiples shells, comparación de byte de archivos, imagen/path/no-Enter descomposición, recarga, real VM IPv4/IPv6 interrupción de red con la misma sesión/PID, negativa a destruir activo shells, reinicie explícitamente autorizado con identidades retenidas y revocación. Véase [los resultados observados](../../../evidence/public-report-beta9.json).

Este PC de mantenimiento también se actualizó a través del instalador público para albergar 0.1.0b9 con sus teclas de host/dispositivo existentes preservados. Un servicio temporal creado shell encontró y corrió `codex-cli 0.154.0` a través de PATH y produjo un aviso de color; sólo que la sesión temporal fue terminada. El beta de escritorio público fue instalado y se mantuvo en Ubuntu.

Pruebas de la CI: [Comprobaciones de RPR](https://github.com/moukrea/jaunt/actions/runs/34960446113), [paquetes de escritorio](https://github.com/moukrea/jaunt/actions/runs/34960446067), [Android](https://github.com/moukrea/jaunt/actions/runs/34960446100). Publicación: [host](https://github.com/moukrea/jaunt/actions/runs/34960988005), [desktop](https://github.com/moukrea/jaunt/actions/runs/34961170116), [Android](https://github.com/moukrea/jaunt/actions/runs/34961169894), [Pagos](https://github.com/moukrea/jaunt/actions/runs/34961981670). Los 28 recursos comprobados de la página pública coinciden con los archivos entregados bajo `/jaunt/`. La salud del relé existente y autenticado real WebSockets aprobado; no se inventó ninguna URL de relé o relé de terceros.

![Paquete de escritorio público con el logotipo suministrado y los iconos de interfaz Lucide](../../../evidence/desktop-release-beta7.png)

## Límites restantes

Física Android hardware, teclados específicos para proveedores / políticas de batería, real Wi-FiInterruptor móvil, macOS tiempo de ejecución y tiempo de ejecución ARM no son validados por estas pruebas. Android Las pruebas de emulador se identifican como tales. Claude Code/Codex Las conversaciones no están cubiertas por pruebas de inicio aisladas. **El protocolo permanece independientemente sin ser estudiado.**
