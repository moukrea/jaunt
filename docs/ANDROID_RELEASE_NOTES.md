# jaunt Android 0.1.0-beta.9

This update follows a host update through its pushed progress instead of polling, shows the expected runtime restart as *Updating host · shells are kept* rather than a lost host, and shows updates started from another device as an ordinary activity row. Settings shows the live update step, a downloaded update waiting to install, or the last failed attempt, with a single "Try again" action.

French, Spanish, Italian, Portuguese and German interface text was rewritten as native UI copy.

Install the signed `.apk` asset below on Android 8 or newer. Allow installation from your browser when Android asks, open jaunt, then scan the QR produced by `jaunt pair` on your host. No Android, GitHub or Cloudflare account is required to connect. Saved pairing survives app updates.

This is an installable Android APK with a bundled WebView interface and native integrations, not a PWA and not an entirely rewritten Android UI:

- Native camera QR scanning and gallery/file selection.
- Android image/text clipboard access. A pasted image is uploaded and, when the host has a supported OS clipboard, copied there before sending Ctrl+V to the selected shell, without Enter. Headless hosts retain an explicit upload/path fallback.
- System Save dialog for downloads; verified transfer progress remains available from Files.
- Optional native foreground connection for notifications, including while the app is backgrounded. Enable it in Settings. Android lock-screen privacy settings still apply.
- Touch scrolling with momentum and a reading position preserved across keyboard resizing.

The protocol has not received an independent security audit. Physical-device validation of this build is not claimed; see `docs/HOST_UPDATE_VALIDATION.md` for what was observed.
