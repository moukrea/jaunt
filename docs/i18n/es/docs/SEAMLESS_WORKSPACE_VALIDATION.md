[English](../../../SEAMLESS_WORKSPACE_VALIDATION.md) · [fr](../../fr/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [es](SEAMLESS_WORKSPACE_VALIDATION.md) · [it](../../it/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [pt](../../pt/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [de](../../de/docs/SEAMLESS_WORKSPACE_VALIDATION.md)

# Validación de actualización de espacio de trabajo y tiempo de ejecución — 2026-09-15

Versiones candidatas: host `0.1.0b11`, escritorio `0.1.0-beta.10`, Android `0.1.0-beta.8` / código de versión 8. La verificación de la publicación está pendiente mientras esta rama está bajo prueba. No se detuvo ningún host de producción o usuario ordinario shell para estas pruebas.

## Resultados observados

← Mando Silencioso Resultado observado
| --- | --- |
Silencio `.venv/bin/python -m pytest -q` ANTE 77 pruebas pasadas, incluyendo transiciones reales del programa PTY.
TENIDO `npm test` ANTE 30 pruebas pasadas.
TENIDO `npm run test:relay` ANTE Ambos escenarios reales Miniflare/workerd WebSocket pasados.
Silencio `.venv/bin/python scripts/check_project.py` ANTE Python/JavaScript sintaxis, importaciones locales, recursos de página y sintaxis del instalador pasado. ←
Silencio `.venv/bin/python tests/browser_e2e.py` Silencio 23 escenarios pasados con PTYs real, autenticación, reconexiones, comparaciones de byte, retroceso de portapapeles y revocación.
TENIDO `jaunt_E2E_RELAY=workerd .venv/bin/python tests/browser_e2e.py` ANTE Las mismas 23 hipótesis pasaron a través de la implementación efectiva del Trabajador.
Silencio `.venv/bin/python tests/terminal_render_e2e.py` ANTE Real aislado `claude` y `codex` startup, sus Meteor tab/pane iconos, terminal dimensiones, selección y desplazamiento-a-latest pasado. No autenticado modelo invocación.
Silencio `DISPLAY=:179 .venv/bin/python tests/shared_workspace_e2e.py` ANTE Electron y el navegador compartieron un PTY, propiedad de dimensiones, controles de sesión y grupos divididos persistentes pasaron.
Silencio `.venv/bin/python tests/feedback_e2e.py` TENIDO apretones de manos interrumpidos/RPCs, retroalimentación contextual ligada, controles de progreso y conmutación entre los verdaderos anfitriones pasados.
Silencio `.venv/bin/python tests/workspace_usability_e2e.py` ANTES Posiciones de pestañas estables, reordenador de punteros, renombre de doble clic, no renombre de alta presión, estado de barra lateral guardado, Ajustes receptivos y ancla de desplazamiento móvil retenido aprobado.
Silencio `.venv/bin/python tests/i18n_e2e.py` ANTE Seis locales del navegador, anulaciones explícitas guardadas y seis idiomas de ayuda CLI pasados; argumentos de comando y datos literales del usuario permanecieron inalterados.
Silencio `.venv/bin/python tests/handoff_e2e.py` ANTE Actual runtime `exec` retenido daemon/PTY PIDs, medio ambiente, cwd y la ejecución del comando del navegador. El shell heredado todavía podría ser terminado.
Silencio `.venv/bin/python scripts/build_release.py` luego `.venv/bin/python tests/installer_e2e.py` ANTE Una rueda instalada reemplazó su tiempo de ejecución mientras mantenía un shell real vivo. Los registros de identidad y dispositivo permanecieron intactos; ningún administrador de servicio de cuenta fue tocado.
Silencio `jaunt_LEGACY_RELEASE_DIR=<verified public beta.10 assets> .venv/bin/python tests/installer_e2e.py` ANTE El verdadero anfitrión del legado público rechazó la migración con un shell activo. El reinicio explícito de este dispositivo aislado lo cerró y preservaba la identidad/dispositivos.
TEN `DISPLAY=:179 .venv/bin/python tests/client_only_e2e.py` ANTE Actual Electron solo el modo cliente no hizo llamadas locales CLI; emparejado a través del relé del propietario desplegado y ejecutó un comando en un host remoto aislado. Anulación del idioma nativo y el título de ventana `jaunt` pasado. TEN
Silencio `npm audit --omit=optional` Silencio No hay vulnerabilidades reportadas.
TEN `.venv/bin/python -m pip_audit` ANTE No hay vulnerabilidades de dependencia conocidas. El proyecto instalado localmente en sí no es una distribución de PyPI-audiable.
TEN Android Gradle release/debug construye, pruebas unitarias y lint Silencio Pasado después de reemplazar un ayudante de flujo API-33-sólo con un bucle de lectura compatible con API mínima 26. Deprecation y otras advertencias no-fatal de lint permanecen.

El escenario solo cliente nativo utiliza el relé WSS real del propietario porque un relé inseguro no debe ser aceptado de un origen de aplicación empaquetado. Su estado anfitrión y shell son accesorios de prueba temporales. No se incluye material de emparejamiento en este informe.

## Límites de validación restantes

Public release instalación, actualizaciones de aplicaciones instaladas, la página publicada y la final firmada APK son revisados después de la publicación; sus observaciones serán anexadas aquí. Android cámara, galería, empuje de pantalla cerrada y Wi-Fi/mobile handover no se ha probado en un teléfono físico autorizado. Las observaciones del emulador se reportan por separado. Un lanzador o navegador puede controlar el icono máscara y aprobación de instalado PWA nombre/icon cambia.

Los huéspedes sin pasar el tiempo necesitan una migración protegida. El shells corriente existente en esas versiones no puede ser preservado retroactivamente por el nuevo código. Actualizaciones compatibles conservan procesos; una parada demonio explícita, fallo o reinicio de máquina no se hace sobrevivible por este mecanismo.

El protocolo de cifrado **no ha recibido una auditoría de seguridad independiente**. Las pruebas funcionales no cambian ese estado.
