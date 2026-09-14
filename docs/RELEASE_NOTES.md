# Jaunt 0.1.0-beta.4

Keep terminal output alive after interrupted WebSocket sends, and avoid signalling an exited shell process group when the asynchronous reaper has not yet caught up. Live-child permission failures remain errors. Upgrades preserve identities and still require explicit restart authorization before destroying ordinary shells.

The companion web client makes single-image Paste automatic through a supported host clipboard and Ctrl+V, without Enter. Empty browser clipboard results open a rich paste fallback; headless hosts retain the explicit upload/path choice. Transfer activity is contextual in Files.

This beta has no independent security/protocol audit. Android handset behavior and actual Claude/Codex attachment rendering are not claimed as agent-validated. See docs/VALIDATION.md for observed browser, real X11/PTY, public installation, network recovery and upgrade tests.

The host now checks the published release channel automatically, verifies and stages new wheels, and waits until ordinary shells finish before applying them. Settings exposes update status and an explicit restart confirmation. `jaunt update` preserves active shells; `jaunt update --allow-restart` explicitly permits closing them. Host identity and pairing records remain unchanged.
