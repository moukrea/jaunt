[English](../../../INSTALLER_FEDORA.md) · [fr](../../fr/docs/INSTALLER_FEDORA.md) · [es](INSTALLER_FEDORA.md) · [it](../../it/docs/INSTALLER_FEDORA.md) · [pt](../../pt/docs/INSTALLER_FEDORA.md) · [de](../../de/docs/INSTALLER_FEDORA.md)

# Correcciones del instalador — 15 de septiembre de 2026

El informe inicial del usuario se refería a Fedora: el comando no produjo salida y el ejecutable permaneció en beta.2. No hubo acceso remoto a esa máquina. Las correcciones iniciales de arranque no establecieron la causa en la máquina del usuario. Un informe posterior proporcionó `curl (23) Failed writing body` durante la descarga `config.json`.

## Defectos y correcciones reproducidos

- El antiguo comando `curl -fsSL … | bash` devuelve 0 cuando el curl falla y Bash recibe entrada vacía. El comando oficial ahora utiliza Bash con `pipefail`, progreso visible, un tiempo de conexión de diez segundos, y un límite de 120 segundos para la descarga inicial del script.
- Una configuración de archivo de salida `.curlrc` puede absorber el script para que no se ejecute nada. Esto se reprodujo usando el curl real y un servidor HTTP local. El `-q` líder ignora esa configuración en el comando oficial; las descargas internas usan `--disable`.
- El script anuncia inmediatamente la puesta en marcha y cada descarga. Errores inesperados identifican el escenario, la línea y el código de salida sin imprimir secretos o comandos completos.
- Las descargas internas HTTPS están sujetas a 120 segundos por intento. Errores seleccionados de conexión/transferencia desencadenan una retry IPv4 visible; HTTP y fallos de certificado no se desprevendieron. Las redirecciones permanecen restringidas a HTTPS.
- Un proceso de curl con un espacio de nombres de sistema de archivos separado no puede abrir la ruta de directorio temporal creada por Bash. Un verdadero Fedora-container curl reproducido salida 23 en `Downloading config.json`, antes de cualquier mutación de instalación. Descargas ahora utilizar shell redireccion de salida: Bash abre el destino y curl escribe a través de stdout heredado.
- Los guardias Active-shell, la verificación de la rueda y la preservación de la identidad permanecen en su lugar.

La documentación del curl define [exit 23 como un fallo de escritura local](https://curl.se/libcurl/c/libcurl-errors.html). Ese código por sí solo no identifica la causa exacta en la máquina del usuario; el aislamiento del sistema de archivos es el caso reproducido aquí.

## Observaciones

- `pytest -q tests/test_installer_bootstrap.py`: cuatro fallos contra los archivos de bootstrap anteriores, luego cuatro pases después de la primera corrección. Estas fallas de red de portada, fallo HTTP, estado de salida del oleoducto, y la red de salida `.curlrc`.
- `pytest -q`: 49 pruebas pasaron localmente con Python 3.14.2 después de la primera corrección.
- `python scripts/build_release.py`, `npm run prepare-web`, `python scripts/check_project.py`: aprobado.
- `python tests/installer_e2e.py`: se aprobaron ocho cheques, incluyendo cheques manipulados, negándose a matar un shell activo real, y explícitamente autorizado reinicio.
- Fedora 44, contenedor oficial fresco, script público anterior a través de `curl … | bash`: la instalación beta.5 sucedió. Fedora por sí solo no reprodujo el problema del usuario.
- Fedora 44, contenedor oficial fresco, script corregido en Bash: instaló la verdadera rueda pública beta.5, con Python 3.12.14 privado instalado por uv; salida 0 y versión 0.1.0b5.
- Fedora 43, contenedor oficial fresco: instalación anterior y rueda pública beta.2, seguido por el instalador corregido y la rueda pública beta.5. Versiones comprobadas antes/después; tabla de identidad y dispositivo preservado.
- El primer comando corregido fue sacado de la página publicada y ejecutado en un nuevo contenedor Fedora 43 después de [Desplegación de paquetes](https://github.com/moukrea/jaunt/actions/runs/34931947575). Los bytes del instalador público coincidieron con la fuente revisada y la versión 0.1.0b5 fue verificada.
- `python tests/installer_namespace_e2e.py`: instalación de rueda pública real con curl en un contenedor Fedora 44 y Bash/Python fuera de él. Ningún directorio host se monta en el contenedor de curl. Antes de la fijación de salida-redirección, config descarga falló con la salida 23. Después de la fijación, la rueda instalada de la versión pública, importada desde el tiempo de ejecución privado, y comenzó el daemon con actualizaciones automáticas.
- El CI requerido incluye instalaciones reales Fedora 43/44. El trabajo Fedora 44 también ejecuta la regresión de instalación de rl de sistema de ficheros separados.

Fedora las pruebas utilizan contenedores aislados sin un gestor de servicio de usuario (`jaunt_NO_SERVICE=1`) y suprimir QR producto (producto)`jaunt_SKIP_PAIR=1`). validan la instalación y la startup de fondo, no sistematizado/SELinux en un físico Fedora estación de trabajo. El servicio de usuario fue validado previamente Ubuntu; no nuevo físico Fedora validación se reclama.

Estas correcciones se aplican al punto de entrada y fuente de instalación de Pages. Activos publicados beta.5 y APK beta.3 permanecen inmutables. El host no necesita un nuevo número de versión para utilizar el instalador de Páginas actualizado. El instalador incrustado en la rueda beta.5 conserva su código anterior hasta una futura versión de host.

El protocolo sigue sin una auditoría de seguridad independiente.

## Seguimiento: salida persistente 23 después de la redirección shell

El usuario informó posteriormente la misma falla de escritura en la línea 65. La regresión del espacio de nombres había pasado, pero no había resuelto el fallo del usuario remoto. No se afirma que se haya diagnosticado el sistema de archivos remoto o la configuración del curl.

Una prueba Fedora 44 independiente con Python 3.14.7 y un completo 4 KiB `/tmp` tmpfs reprodujo el error `curl: Failed writing body` exacto y el fallo line-65. Un directorio y un archivo vacío todavía se puede crear allí, pero la escritura de la respuesta falló. Esta prueba utiliza sólo un contenedor Docker desechable; no llena ningún host.

El instalador pasa ahora junto al tiempo de ejecución en el sistema de archivos de destino, comprueba que puede escribir 1 MiB allí, y suministra ese directorio temporal privado a pip/uv durante la instalación. No cambia el daemon host o TMPDIR de sesiones shell. El directorio de puesta en escena se elimina en la salida. Un sistema de archivos de destino completo todavía produce un error de almacenamiento claro; el instalador no elimina la habitación.

Cuando el curl regresa 23 y Python está disponible, una biblioteca estándar HTTPS descargador retries el archivo independientemente. Utiliza validación de certificado normal, rechaza no-HTTPS redirige, vincula toda la transferencia a 120 segundos y 128 MiB, detecta los cuerpos incompletos, y deslumbra/fsyncs el resultado. La verificación del checksum de la rueda todavía ocurre antes de la sustitución del tiempo de ejecución.HTTP fallas debilitando la validación.

Los comandos de validación para este seguimiento:

- `pytest -q`: 53 pruebas pasaron localmente. Cuatro nuevos cheques ejercitan el Python descomponente HTTPS y redireccionan límites.
- `python tests/installer_storage_e2e.py`: instalaciones Fedora reales con un `/tmp` completo, y con cada descarga de rizo interno forzado a escribir a `/dev/full`. El segundo escenario ejerce la salida de rizo real 23 seguido de descargas públicas HTTPS a través de Python. Ambos escenarios revisan el daemon de ejecución, limpieza de montaje, y ausencia de un entorno borrado
- `python tests/installer_e2e.py`: se aprobaron los ocho cheques existentes, incluyendo mantenimiento activo-shell, rechazo de la suma de comprobación y autorización de reinicio explícita.
- `python scripts/build_release.py`, `npm run prepare-web`, y `python scripts/check_project.py`: pasado.

El trabajo necesario Fedora CI ejecuta ambos nuevos escenarios de instalación además de la anterior prueba de espacio de nombres. Estas son las observaciones de ensayo-ambiente, no una reclamación de ejecución exitosa en la máquina Fedora inaccesible del usuario.
