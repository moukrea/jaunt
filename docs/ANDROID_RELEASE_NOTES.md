# jaunt Android 0.1.0-beta.4

This update fixes system-bar and keyboard insets by resizing the WebView's outer container. It uses the original jaunt icon, provides the shared session manager and themes, and receives automatic terminal bell/program/session-exit notifications when enabled. Desktop split layouts remain ordinary session tabs at mobile widths.

This release regulates rapid terminal input to avoid overflowing the host’s bounded input queue. Pending input is discarded if the encrypted channel changes; commands are never replayed after reconnection.

Install the signed `.apk` asset below on Android 8 or newer. Allow installation from your browser when Android asks, open jaunt, then scan the QR produced by `jaunt pair` on your host. No Android, GitHub or Cloudflare account is required to connect.

This is an installable Android APK with a bundled WebView interface and native integrations, not a PWA and not an entirely rewritten Android UI:

- Native camera QR scanning and gallery/file selection.
- Android image/text clipboard access. A pasted image is uploaded and, when the host has a supported OS clipboard, copied there before sending Ctrl+V to the selected shell, without Enter. Headless hosts retain an explicit upload/path fallback.
- System Save dialog for downloads; verified transfer progress remains available from Files.
- Optional native foreground connection for notifications, including while the app is backgrounded. Enable it in Settings. The persistent Android notification includes Stop. Notification bodies omit terminal output.
- Saved pairing survives app updates and network changes. Keys are excluded from backup; background-service identities are encrypted with Android Keystore.

The host must remain running; the public one-command installer configures its user service. Android force-stop, battery restrictions, host/network outages and OS scheduling can delay or prevent notifications. This does not promise guaranteed delivery during deep idle. The protocol has not undergone an independent security audit.

The validation report distinguishes emulator testing from physical-phone testing and exact clipboard/Ctrl+V delivery from recognition as an attachment inside a particular Claude Code/Codex version. See `docs/ANDROID.md` and `docs/VALIDATION.md` in the tagged source.

The APK checks for updates automatically. Settings also offers an immediate check. Downloads are verified against release checksums and the installed signing identity before Android asks for installation confirmation. Updates preserve app data and pairings; uninstalling removes them.
