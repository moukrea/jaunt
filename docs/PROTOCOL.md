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

Host links: a host enrolls on another host exactly as a device does (`hello`/`challenge`/`proof`, then an encrypted `enroll` carrying `kind: "host"` and its room); the target records the device with `kind: "host"` and only accepts `agent.*` methods from it. Any authenticated device may ask a host for a one-use pairing code with `pair.issue` (same reply as `jaunt pair`); the client uses it to link the hosts it is paired with among themselves (`links.add {code, name?, icon?, selfName?}` on the requester host, `links.update {room, name?, icon?}` afterwards) so the target sees the requester under the device's friendly name and the requester lists the target under its label and icon; `info.agents.links` lists the rooms a host already links. Over that channel the linked host sends RPCs `agent.rights {runtime}`, `agent.peers {runtime}` and `agent.message {runtime, id, to, text, inReplyTo?, hops, from: {id, runtime, terminal, cwd, project, modeClass}}` (switch `messages`; the reply `{state, detail}`), `agent.sessions {runtime}`, `agent.type {runtime, session, input, enter?}`, `agent.output {runtime, session, limit?}` (right `type`, one grant per requester × session given by the first approval, dropped by `agents.cut {session}`; sessions carry `agents: [{id, name, since}]`), `agent.run {runtime, command, cwd?, timeoutSec?}` and `agent.read {runtime, run, offset?, limit?}`; the target applies its per-requester policy (`agents` in its state: requesters keyed `<deviceId>:<runtime>` with `exec`/`type` levels) and may first broadcast `agent.approval {id, requester, right, kind, detail, expires}` to its clients, answered by `agents.decide {id, decision: once|rule|1h|24h|always|deny}` (`rule` adds the exact command to the requester's allow-list; `agents.rule {requester, pattern, remove?}` manages it; a matching one-shot command in ask mode runs without an approval) (first answer wins, `agent.approval.closed` follows). Clients manage the feature with `agents.status`, `agents.configure`, `agents.trust`, `agents.revoke`, `links.add`, `links.remove`, `links.list`. Terminal history: the host keeps each session's output on disk (`<state>/scrollback/<id>/seg-<offset>.bin`, 8 MiB segments, 32 MiB per session, 0600) unless `scrollback.configure {disk:false}`; `session.history {id, before, limit}` returns `{offset, data, retained}` with at most 64 KiB ending at `before` (from disk, else from the 2 MiB ring); session information carries `retained`, the earliest offset still available. Clients cache rendered output locally by absolute offset and only fetch the ranges they miss. Terminal output is flow-controlled per viewer: the client sends `terminal.ack {id, offset}` (no reply) once xterm has rendered up to `offset`; the host keeps at most a per-viewer window of unacknowledged bytes in flight (slow-start from 128 KiB up to 512 KiB, collapsing to 32 KiB when the viewer falls behind, remembered per peer across sessions), stops streaming to a viewer beyond that window and, on its next acknowledgement, resumes with a `terminal.reset` followed by the freshest slice only. PTY reads are coalesced for up to 30 ms (64 KiB) into one frame per viewer. Hosts advertise `flowControl: true`; a client that does not acknowledge is fed at most one window and then the freshest slices. A client subscribes only to the terminals it displays (`session.attach` / `session.detach`); notifications are detected on every byte regardless of viewers. Sessions use idempotent IDs and output with absolute byte offsets. After reconnection, `session.attach(after)` replays only retained output that has not been received. If the buffer was truncated, an explicit reset event is sent. A trimmed catch-up advances its reset offset to the next escape or line boundary within 4 KiB, falling back to a UTF-8 character boundary; this bounded heuristic is not a full terminal parser. For a live session, the host requests a redraw by temporarily changing the PTY width by one column and restoring it after 150 ms, serialized with active resizes and coalesced to at most one request every two seconds. Shared dimensions and input are unchanged. Dimensions are shared: the last active client resizes the common PTY.

Uploads use per-transfer IDs, device ownership, an expected offset, and an offset response for duplicate chunks. SHA-256 is calculated during receipt; commit is atomic and does not overwrite a concurrently created destination. Temporary files are in the same directory with mode 0600. Transfers expire after one hour of inactivity. There is no on-disk resumption after a host restart. Downloads read regular files, check size and mtime, and use 48 KiB chunks.

## Evolution

A native Android client must implement this protocol and the same identity storage semantics; it must not copy the browser's WebSocket session. Version every incompatible change. Python/Web Crypto interoperability and replay tests must remain required in CI.

## Shared views and local desktop transport

A welcome optionally includes `peer`, the current view identifier. Session information includes `viewers` and `activeView`. `terminal.geometry` carries the PTY's columns, rows, controlling view, and viewer list. An explicit active input or resize claims geometry; merely attaching does not. Retained output records its dimensions, and replay emits geometry changes in order. Clients serialize these with the terminal parser's asynchronous write queue.

`session.detach` removes one view without closing the PTY. `session.terminate` explicitly terminates the underlying session, including a named tmux session when applicable. The legacy `session.close` behavior remains compatible with older clients.

The desktop bridge sends the same RPC/stream messages through the 0600 Unix control socket after `ui.connect`. The socket's 0700 parent directory confines access to the host account. No pairing secret is generated for this same-account channel; remote connections retain the existing cryptographic handshake. Input is never replayed when either channel reconnects.

New pairing text uses the lowercase `jaunt1.` prefix. Updated clients also accept the original uppercase prefix; pairing URL fragments and cryptographic transcript labels are unchanged. Existing environment variable overrides are accepted as compatibility aliases while new documentation uses lowercase product prefixes.

Hosts advertising `sessionDirectory: true` accept `session.directory(id)` and the optional `sourceSession` on `session.create`. An explicit nonempty `cwd` takes precedence. The host reads the shell process's current directory on Linux/macOS and falls back to its initial directory if the process has exited or the OS cannot supply it. This introduces no new transport or authorization boundary.

New host update requests return an operation ID, carried through update status records. Clients can distinguish the requested check's result from a previous completed check. Statuses include checking, downloading, verifying, installing, installed, current, deferred and error. An installer error is not reported as waiting unless active shells/transfers actually blocked a non-authorized restart.

### ResetDeck collector service identity

The local owner-only control socket accepts `runtime: "resetdeck", service:
"resetdeck"` for `agents.hosts`, `agents.run` and `agents.read` without binding the
service to an interactive AI terminal. It is registered as a separate requester
on the paired host and still requires enabled agent execution and its own trust
or command rule. Incoming ResetDeck runs accept only a canonical shell-quoted
four-argument collector exchange (absolute interpreter, absolute agent script,
`exchange`, bounded base64 payload); shell operators and substitutions are
rejected before authorization. Grant only the specific collector script command
pattern. No provider credential or prompt is part of the collector exchange.

The receiving host enforces the restriction itself, whatever the requester's
trust: with `runtime: "resetdeck"` a linked host gets only `agent.rights`,
`agent.run` and `agent.read`, and `agent.read` only returns runs that same
requester started since the host last restarted. "Always allow this command" on
a ResetDeck exchange adds the rule `<interpreter> <agent> exchange *` (paths
glob-escaped), which covers later payloads of that pair only; another
interpreter or agent asks again. When that prefix exceeds the 200-character rule
limit, the approved run proceeds once and no rule is added. `agents.status`
advertises `services: ["resetdeck"]`, a capability, not a grant.
