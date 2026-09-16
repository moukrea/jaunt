# jaunt Android 0.1.0-beta.16 (versionCode 16)

- Bundles the beta.24 interface (split picker under its button, Enter/Escape in rename).

# jaunt Android 0.1.0-beta.15 (versionCode 15)

- Bundles the beta.23 interface (top bar no longer turns orange at normal latency).

# jaunt Android 0.1.0-beta.14 (versionCode 14)

- Bundles the beta.22 interface (latency tiers). No Android-specific change.

# jaunt Android 0.1.0-beta.13 (versionCode 13)

- Bundles the beta.21 interface: *System* language entry, refreshed public page copy. No Android-specific change.

# jaunt Android 0.1.0-beta.12

This update fixes the first-use issues of the workspace features (touch swipe over a tab scrolls the strip, split with an existing session under shared open sessions, Enter after an inserted text) and keeps the workspace refinements of host beta.19: shared open sessions per host with the *Only displayed sessions exist* sub-option, a Close view / Terminate session choice on the × of tabs, a held press before dragging a tab when the tab strip scrolls (a swipe scrolls it), switch-style settings toggles, and the *New shell in folder* button next to *New shell*. It keeps the **AI sessions** settings group for the selected host: one switch for the Claude Code ↔ Codex bridge (shown only when both runtimes are installed on that host), the list of bridged sessions, and activity rows for cross-runtime messages with their real delivery state. It keeps the beta.9 update experience (pushed host update progress, *Updating host · shells are kept*).

Install the signed `.apk` asset below on Android 8 or newer. Allow installation from your browser when Android asks, open jaunt, then scan the QR produced by `jaunt pair` on your host. No Android, GitHub or Cloudflare account is required to connect. Saved pairing survives app updates.

This is an installable Android APK with a bundled WebView interface and native integrations, not a PWA and not an entirely rewritten Android UI:

- Native camera QR scanning and gallery/file selection.
- Android image/text clipboard access. A pasted image is uploaded and, when the host has a supported OS clipboard, copied there before sending Ctrl+V to the selected shell, without Enter. Headless hosts retain an explicit upload/path fallback.
- System Save dialog for downloads; verified transfer progress remains available from Files.
- Optional native foreground connection for notifications, including while the app is backgrounded. Android lock-screen privacy settings still apply.
- Touch scrolling with momentum and a reading position preserved across keyboard resizing.

The protocol has not received an independent security audit. Physical-device validation of this build is not claimed.
