# jaunt Android 0.1.0-beta.8

This update adds touch scrolling with momentum, preserves the reading position across keyboard resizing, uses bundled Lucide interface icons, and uses the original transparent logo as its launcher icon. It uses the original jaunt icon, provides the shared session manager and themes, and receives automatic terminal bell/program/session-exit notifications when enabled. Desktop split layouts remain ordinary session tabs at mobile widths.

This release regulates rapid terminal input to avoid overflowing the host’s bounded input queue. Pending input is discarded if the encrypted channel changes; commands are never replayed after reconnection.

Install the signed `.apk` asset below on Android 8 or newer. Allow installation from your browser when Android asks, open jaunt, then scan the QR produced by `jaunt pair` on your host. No Android, GitHub or Cloudflare account is required to connect.

This is an installable Android APK with a bundled WebView interface and native integrations, not a PWA and not an entirely rewritten Android UI:

- Native camera QR scanning and gallery/file selection.
- Android image/text clipboard access. A pasted image is uploaded and, when the host has a supported OS clipboard, copied there before sending Ctrl+V to the selected shell, without Enter. Headless hosts retain an explicit upload/path fallback.
- System Save dialog for downloads; verified transfer progress remains available from Files.
- Optional native foreground connection for notifications, including while the app is backgrounded. Enable it in Settings. The persistent Android notification includes Stop. Notifications display the title/body emitted by programs; tapping one opens the matching session. Android lock-screen privacy settings still apply.
- Saved pairing survives app updates and network changes. Keys are excluded from backup; background-service identities are encrypted with Android Keystore.

The host must remain running; the public one-command installer configures its user service. Android force-stop, battery restrictions, host/network outages and OS scheduling can delay or prevent notifications. This does not promise guaranteed delivery during deep idle. The protocol has not undergone an independent security audit.

The validation report distinguishes emulator testing from physical-phone testing and exact clipboard/Ctrl+V delivery from recognition as an attachment inside a particular Claude Code/Codex version. See `docs/ANDROID.md` and `docs/VALIDATION.md` in the tagged source.

The APK checks for updates automatically. Settings also offers an immediate check. Downloads are verified against release checksums and the installed signing identity before Android asks for installation confirmation. Updates preserve app data and pairings; uninstalling removes them.

Session controls now keep Open, Rename, Close view and Terminate inside each responsive session card. New shell creates an automatically named terminal immediately. New shell in folder offers directory browsing and an optional name. The host can inherit the active shell’s current directory. Desktop has separate side-by-side and above/below split controls, an inline choice of new or existing sessions, and a button to move each pane into its own tab. Mobile retains ordinary session tabs. Closing a view keeps its shell alive; termination still requires explicit confirmation.

Connection interruptions now share one persistent status banner. Late asynchronous handshake results cannot overwrite a replacement connection. Dialog errors stay inline; action errors persist without toast cascades. Transfers expose waiting/cancellation/completion, completed activity collapses into accessible history, and update availability keeps its action visible.

This release adds six system-detected UI languages with a saved override, stable draggable tabs with double-click renaming, corrected operation feedback, and locally bundled Claude/OpenAI foreground icons. The native app opens the workspace directly; the presentation homepage is reserved for the website.
