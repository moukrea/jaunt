Install the signed `.apk` asset below on Android 8 or newer. Allow installation from your browser when Android asks, open Jaunt, then scan the QR produced by `jaunt pair` on your host. No Android, GitHub or Cloudflare account is required to connect.

This is an installable Android APK with a bundled WebView interface and native integrations, not a PWA and not an entirely rewritten Android UI:

- Native camera QR scanning and gallery/file selection.
- Android image/text clipboard access. A pasted image is uploaded and, when the host has a supported OS clipboard, copied there before sending Ctrl+V to the selected shell, without Enter. Headless hosts retain an explicit upload/path fallback.
- System Save dialog for downloads; verified transfer progress remains available from Files.
- Optional native foreground connection for notifications, including while the app is backgrounded. Enable it in Settings. The persistent Android notification includes Stop. Notification bodies omit terminal output.
- Saved pairing survives app updates and network changes. Keys are excluded from backup; background-service identities are encrypted with Android Keystore.

The host must remain running; the public one-command installer configures its user service. Android force-stop, battery restrictions, host/network outages and OS scheduling can delay or prevent notifications. This does not promise guaranteed delivery during deep idle. The protocol has not undergone an independent security audit.

The validation report distinguishes emulator testing from physical-phone testing and exact clipboard/Ctrl+V delivery from recognition as an attachment inside a particular Claude Code/Codex version. See `docs/ANDROID.md` and `docs/VALIDATION.md` in the tagged source.
