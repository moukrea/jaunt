# jaunt Android 0.1.0-beta.10

This update adds the **AI sessions** settings group for the selected host: one switch for the Claude Code ↔ Codex bridge (shown only when both runtimes are installed on that host), the list of bridged sessions, and activity rows for cross-runtime messages with their real delivery state. It keeps the beta.9 update experience (pushed host update progress, *Updating host · shells are kept*).

Install the signed `.apk` asset below on Android 8 or newer. Allow installation from your browser when Android asks, open jaunt, then scan the QR produced by `jaunt pair` on your host. No Android, GitHub or Cloudflare account is required to connect. Saved pairing survives app updates.

This is an installable Android APK with a bundled WebView interface and native integrations, not a PWA and not an entirely rewritten Android UI:

- Native camera QR scanning and gallery/file selection.
- Android image/text clipboard access. A pasted image is uploaded and, when the host has a supported OS clipboard, copied there before sending Ctrl+V to the selected shell, without Enter. Headless hosts retain an explicit upload/path fallback.
- System Save dialog for downloads; verified transfer progress remains available from Files.
- Optional native foreground connection for notifications, including while the app is backgrounded. Android lock-screen privacy settings still apply.
- Touch scrolling with momentum and a reading position preserved across keyboard resizing.

The protocol has not received an independent security audit. Physical-device validation of this build is not claimed.
