[English](../../../PROTOCOL.md) · [fr](../../fr/docs/PROTOCOL.md) · [es](PROTOCOL.md) · [it](../../it/docs/PROTOCOL.md) · [pt](../../pt/docs/PROTOCOL.md) · [de](../../de/docs/PROTOCOL.md)

# Protocolo jaunt v1

Este documento describe la implementación, no una garantía estándar o de seguridad.

## Transporte e identidades

Punto final: `wss://RELAY/v1/room/ROOM`. ROOM es 18 bytes aleatorios, codificados como base no remunerada64url (24 caracteres). Las capacidades de enrutamiento son 32 bytes (43 caracteres). El host se registra con `hostToken` y `clientToken`. El Objeto Durable almacena su SHA-256 se apresura en una transacción atómica inicial; otro host no puede reemplazarlos.

Los relés almacenan los hahes y el estado de apego necesarios para la hibernación, nunca terminal historia. Las claves de cifrado permanecen en los puntos finales. Ambas conexiones están fuera de conexión; el host no necesita ningún puerto entrante. WebSockets debe utilizar el configurado `APP_ORIGIN`; el escritorio empaquetado utiliza el permitido por separado `jaunt://app` origen. Huésped nativo sin origen/Android Todos los clientes siguen autenticando las capacidades de enrutamiento y el canal final a extremo.

## Pareja

`jaunt1.` seguido por base64url JSON que contiene `v` (versión), `r` (relay), `h` (oficina), `t` (clientToken), `p` ( ID de pago), `s` (pair secreto) y `n` (nombre anfitrión). El host almacena y hace cumplir la expiación; el navegador no trata su propio valor de vencimiento como autoritativo. A QR El código apunta a la página con este código en el fragmento. Tiempo de vida: 600 segundos, uso único.

El navegador crea su ID de dispositivo y su secreto de 32 bytes y los guarda BEFORE consumiendo el código QR, luego los transmite sólo después de la autenticación y encriptación. Si el mensaje de bienvenida final se pierde, primero intenta la identidad de dispositivo persistido, luego emparejando si todavía es válido. La revocación elimina la autorización del lado anfitrión y cierra los canales de ese dispositivo.

## Handshake

Cliente y servidor cada uno crea una tecla P-256 efímero. Las claves públicas usan codificación y base64url SEC1 sin comprimir. La transcripción es una matriz ASCII JSON compacta en este orden exacto:

```
["jaunt-v1", room, auth, id, pair-or-"", clientNonce, clientPublic, serverNonce, serverPublic]
```

Las pruebas son HMAC-SHA256(secreto, `server:` tención transcripción) y HMAC-SHA256(secreto, `client:` ← WordPress transcripción), revisado antes de abrir el canal. `auth` distingue el emparejamiento de un dispositivo recordado. Cada conexión utiliza nociones aleatorias.

Compartido = P-256 ECDH. AAD = SHA256(transcript). HKDF-SHA256, longitud 32, sal SHA256(secret), info AAD Silencioso `jaunt-c2h` o AAD Silencioso `jaunt-h2c`. Dos teclas independientes AES-256-GCM, una por dirección. Los contadores más estrictos comienzan a 1; el contrar de 12 bits seguidos es cuatro de cero.

Marco de aplicación: `{type:"box", n:counter, ct:base64url(ciphertext+tag)}`. Los mensajes cifrados son JSON; los trozos binarios usan base64url. Presupuesto de transporte: 132.000 caracteres. Entrada, salida y archivos son removidos antes de la encriptación.

## RPC y corrientes

Solicitudes: `{type:"rpc", id, method, params}`. Respuestas: `{type:"reply", id, ok:true, result}`, o el formulario de error definido en daemon.py. `Peer.dispatch` y `Host.rpc` son la fuente de la verdad para métodos y eventos; no inventar un segundo esquema, divergentes.

Las sesiones utilizan idempotent IDs y salida con offsets de byte absolutos. Después de la reconexión, `session.attach(after)` replays sólo la salida retenida que no se ha recibido. Si el buffer fue truncado, se envía un evento de reset explícito. Dimensiones son compartidas: el último cliente activo redimensiona el PTY común.

Las descargas utilizan IDs per-transfer, la propiedad de dispositivos, un offset esperado y una respuesta offset para los trozos duplicados. SHA-256 se calcula durante la recepción; commit es atómico y no sobreescribirá un destino concurrente. Los archivos temporales están en el mismo directorio con el modo 0600. Las transferencias expiran después de una hora de inactividad. No hay reanudación en disco después de un reinicio host. Descargas leer archivos regulares, tamaño de cheque y mtime, y utilizar 48 KiB pedazos.

## Evolución

Un cliente nativo de Android debe implementar este protocolo y la misma semántica de almacenamiento de identidad; no debe copiar la sesión WebSocket del navegador. Versión todos los cambios incompatibles. Python/Web Las pruebas de interoperabilidad y repetición de Crypto deben seguir siendo necesarios en CI.

## Vistas compartidas y transporte local de escritorio

Una bienvenida opcionalmente incluye `peer`, el identificador de la vista actual. Información de la sesión incluye `viewers` y `activeView`. `terminal.geometry` porta el PTY's columnas, filas, vista de control, y lista de espectadores. Una entrada activa explícita o redimensionar la geometría de reclamaciones; simplemente adjuntar no. La salida retenida registra sus dimensiones, y la repetición emite cambios de geometría en orden. terminal la cola de escritura asincrónica de parser.

`session.detach` elimina una vista sin cerrar el PTY. `session.terminate` termina explícitamente la sesión subyacente, incluyendo una sesión llamada tmux cuando sea aplicable. El comportamiento legado `session.close` sigue siendo compatible con clientes mayores.

El puente de escritorio envía los mismos mensajes RPC/stream a través de la toma de control 0600 Unix después de `ui.connect`. El directorio matriz 0700 de socket confines acceso a la cuenta de host. No se genera ningún secreto de emparejamiento para este canal de la misma cuenta; conexiones remotas conservan el apretón de manos criptográfico existente.

Nuevo texto de emparejamiento utiliza el prefijo `jaunt1.` inferior. Los clientes actualizados también aceptan el prefijo original en mayúsculas; sin cambios los fragmentos de URL de emparejamiento y las etiquetas de transcripción criptográfica. Los cambios variables de entorno existentes se aceptan como alias de compatibilidad mientras que la nueva documentación utiliza prefijos de productos de minúscula.

Hosts publicidad `sessionDirectory: true` aceptar `session.directory(id)` y la opción `sourceSession` on `session.create`. Un incumplimiento explícito `cwd` tiene precedencia. El anfitrión lee el shell el directorio actual del proceso en Linux/macOS y vuelve a su directorio inicial si el proceso ha salido o el sistema operativo no puede suministrarlo. Esto no introduce ningún nuevo límite de transporte o autorización.

Las nuevas solicitudes de actualización de host devuelven un ID de operación, llevado a través de registros de estado de actualización. Los clientes pueden distinguir el resultado de la comprobación solicitada de un cheque completado anterior. Los estados incluyen la comprobación, descarga, verificación, instalación, instalación, corriente, diferido y error. Un error de instalador no se reporta como espera a menos que shells/transfers activo bloqueó realmente un reinicio no autorizado.
