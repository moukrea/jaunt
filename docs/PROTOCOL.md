# jaunt protocol v1

This document describes the implementation, not a standard or security guarantee.

## Transport and identities

Endpoint: `wss://RELAY/v1/room/ROOM`. ROOM is 18 random bytes, encoded as unpadded base64url (24 characters). Routing capabilities are 32 bytes (43 characters). The host registers with `hostToken` and `clientToken`. The Durable Object stores their SHA-256 hashes in an initial atomic transaction; another host cannot replace them. The browser holds only clientToken. Client messages are routed using a peer ID assigned by the relay, not chosen by the client.

The relay stores routing hashes and attachment state needed for hibernation, never terminal history. Encryption keys remain at the endpoints. Both connections are outbound; the host needs no incoming port. Browser WebSockets must use the configured `APP_ORIGIN`; the packaged desktop uses the separately allowed `jaunt://app` origin. Origin-less native host/Android connections remain supported. All clients still authenticate routing capabilities and the end-to-end channel.

## Pairing

`jaunt1.` followed by base64url JSON containing `v` (version), `r` (relay), `h` (room), `t` (clientToken), `p` (pair ID), `s` (pair secret), and `n` (host name). The host stores and enforces the expiry; the browser does not treat its own expiry value as authoritative. A QR code points to the page with this code in the fragment. Lifetime: 600 seconds, single use.

The browser creates its device ID and 32-byte secret and saves them BEFORE consuming the QR code, then transmits them only after authentication and encryption. If the final welcome message is lost, it first tries the persisted device identity, then pairing if still valid. Revocation removes host-side authorization and closes that device's channels.

## Handshake

Client and server each create an ephemeral P-256 key. Public keys use uncompressed SEC1 encoding and base64url. The transcript is a compact ASCII JSON array in this exact order:

```
["jaunt-v1", room, auth, id, pair-or-"", clientNonce, clientPublic, serverNonce, serverPublic]
```

Proofs are HMAC-SHA256(secret, `server:` || transcript) and HMAC-SHA256(secret, `client:` || transcript), checked before opening the channel. `auth` distinguishes pairing from a remembered device. Each connection uses random nonces.

Shared = P-256 ECDH. AAD = SHA256(transcript). HKDF-SHA256, length 32, salt SHA256(secret), info AAD || `jaunt-c2h` or AAD || `jaunt-h2c`. Two independent AES-256-GCM keys, one per direction. Strict counters start at 1; the 12-byte nonce is four zero bytes followed by the big-endian uint64 counter. Close and reconnect before the nonce counter reaches 2^53. Any gap, duplicate, or GCM failure closes the channel. Ephemeral keys are never reused after reconnecting.

Application frame: `{type:"box", n:counter, ct:base64url(ciphertext+tag)}`. Decrypted messages are JSON; binary chunks use base64url. Transport budget: 132,000 characters. Input, output, and files are chunked before encryption.

## RPC and streams

Requests: `{type:"rpc", id, method, params}`. Responses: `{type:"reply", id, ok:true, result}`, or the error form defined in daemon.py. `Peer.dispatch` and `Host.rpc` are the source of truth for methods and events; do not invent a second, diverging schema.

Sessions use idempotent IDs and output with absolute byte offsets. After reconnection, `session.attach(after)` replays only retained output that has not been received. If the buffer was truncated, an explicit reset event is sent. Dimensions are shared: the last active client resizes the common PTY.

Uploads use per-transfer IDs, device ownership, an expected offset, and an offset response for duplicate chunks. SHA-256 is calculated during receipt; commit is atomic and does not overwrite a concurrently created destination. Temporary files are in the same directory with mode 0600. Transfers expire after one hour of inactivity. There is no on-disk resumption after a host restart. Downloads read regular files, check size and mtime, and use 48 KiB chunks.

## Evolution

A native Android client must implement this protocol and the same identity storage semantics; it must not copy the browser's WebSocket session. Version every incompatible change. Python/Web Crypto interoperability and replay tests must remain required in CI.

## Shared views and local desktop transport

A welcome optionally includes `peer`, the current view identifier. Session information includes `viewers` and `activeView`. `terminal.geometry` carries the PTY's columns, rows, controlling view, and viewer list. An explicit active input or resize claims geometry; merely attaching does not. Retained output records its dimensions, and replay emits geometry changes in order. Clients serialize these with the terminal parser's asynchronous write queue.

`session.detach` removes one view without closing the PTY. `session.terminate` explicitly terminates the underlying session, including a named tmux session when applicable. The legacy `session.close` behavior remains compatible with older clients.

The desktop bridge sends the same RPC/stream messages through the 0600 Unix control socket after `ui.connect`. The socket's 0700 parent directory confines access to the host account. No pairing secret is generated for this same-account channel; remote connections retain the existing cryptographic handshake. Input is never replayed when either channel reconnects.

New pairing text uses the lowercase `jaunt1.` prefix. Updated clients also accept the original uppercase prefix; pairing URL fragments and cryptographic transcript labels are unchanged. Existing environment variable overrides are accepted as compatibility aliases while new documentation uses lowercase product prefixes.

Hosts advertising `sessionDirectory: true` accept `session.directory(id)` and the optional `sourceSession` on `session.create`. An explicit nonempty `cwd` takes precedence. The host reads the shell process's current directory on Linux/macOS and falls back to its initial directory if the process has exited or the OS cannot supply it. This introduces no new transport or authorization boundary.
