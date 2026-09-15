# Security model — unaudited beta

Jaunt provides a full shell under the host account. There is no filesystem sandbox or read-only role: an authorized device can act as that user. Do not run the host with privileges that remote devices do not need.

## What is protected

Commands, output, files, and clipboard data are encrypted between the browser and host. The relay sees network addresses, rooms, presence, packet sizes and timing, and ephemeral public keys. It does not hold pairing or device secrets. The channel is authenticated by a random 256-bit secret, with ephemeral ECDH and AES-GCM. See [the protocol specification](docs/PROTOCOL.md).

The primitives come from cryptography and Web Crypto. **Their composition into this protocol is new and has not received an external audit.** Tamper/replay and interoperability tests do not replace an audit. Do not describe Jaunt as certified, invulnerable, or ready by default for sensitive production environments.

## What is not protected

- A compromised browser, machine, or system account remains compromised.
- GitHub Pages serves code that can access secrets after unlocking: an attacker controlling the repository or page can replace the JavaScript. End-to-end encryption does not protect against a malicious client update.
- Without a password, keys are stored unencrypted in IndexedDB, like a remembered session. A password/PIN encrypts them at rest; a short PIN remains vulnerable to offline guessing. Prefer a long passphrase.
- Locking stops connections and clears active views. It does not guarantee cryptographic erasure of browser RAM.
- A complete QR code grants shell access for ten minutes. Never put it in an issue, public screenshot, CI log, or analytics.
- Browser notifications are delivered through the browser's push service. Jaunt hides command content by default, but machine names and timing remain sensitive.
- A revoked device can no longer authenticate to the channel, but knows the previous shared routing capability. It may still disrupt relay availability until the host identity is rotated. Routing secrets are not a complete quota or anti-DDoS system.

## Shared GitHub Pages origin

Sites at `moukrea.github.io/another-project/` and `moukrea.github.io/jaunt/` share a browser origin. Another vulnerable project on that origin could target Jaunt's storage. Paths are not a security boundary. For sensitive use, serve Jaunt on a dedicated origin (its own domain/subdomain) and pair again there. A PIN protects keys at rest but does not replace origin isolation or trust in the JavaScript being served.

## Storage and permissions

`~/.local/share/jaunt/host.json` and the control socket are private to the current account. The directory uses mode 0700, state uses 0600, and writes are atomic. `attachments/` contains uploaded files; locking the app does not delete them. Remove unneeded attachments through the file browser.

Persistent keys never appear in request URLs: pairing uses the fragment, which is immediately removed from history. Relay capabilities are sent in the first WebSocket frame over TLS. The Worker does not log payloads.

## Deployment

Use HTTPS/WSS outside loopback, restrict APP_ORIGIN to the exact Pages origin, enable MFA and branch protections, minimize Cloudflare/GitHub permissions, and monitor quotas and costs. Do not add third-party analytics scripts or extensions to the page. The static CSP blocks inline scripts and dynamic evaluation; dependencies are local. GitHub Pages cannot set every server security header; use a controlled domain/proxy for further hardening.

## Reporting a vulnerability

Use the repository's private vulnerability reporting channel when available. Never publish a key, QR code, confidential terminal log, host.json file, or vault export. Before public disclosure, the maintainer must establish a private reporting channel and rotation policy.
