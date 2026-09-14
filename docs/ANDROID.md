# Jaunt Android

The Android client packages the existing functional interface into an APK. Native Java code implements clipboard access, camera QR scanning, file selection/save and an opt-in foreground notification connection. The UI remains HTML/JS in Android System WebView. No runtime JavaScript comes from a CDN or the public Page: the assets are bundled in the APK.

## Use

Install the signed APK from the Android release, then open Jaunt and scan the host's `jaunt pair` QR. Android may ask you to allow installation from the browser used to download it. This permission is only for installation; no new cloud account is needed.

Open a shell and use Paste after copying a screenshot. With a supported host clipboard the image is uploaded, copied into that clipboard and Ctrl+V is sent to the selected PTY without Enter. Otherwise the existing explicit path/attachment choices remain. Attach opens Android's file/gallery picker. Shared images from another app require a confirmation naming the destination shell. Downloads open Android's Save dialog.

Enable Android background notifications under Settings for each host. Android requests notification permission; a persistent notification shows the connection count and offers Stop. Notifications show a generic host attention message, with no terminal output on the lock screen. `jaunt notify "Need your attention"` and `jaunt run -- command` can trigger them. The host's user service must be active.

Android may restrict network access in deep idle or under vendor battery policies. Force-stop prevents automatic operation until the app is opened again. Notification delivery is not guaranteed. A foreground service is not a VPN and does not require Firebase/FCM credentials.

## Security boundaries

- `WebViewAssetLoader` serves only bundled assets at `https://moukrea.github.io/jaunt/`. Missing assets fail closed. External links open outside the privileged WebView.
- The native message bridge accepts only the exact HTTPS origin and the main frame. No file/content URL loading, cleartext traffic, release WebView debugging or backup is enabled.
- Android notification identities use the already paired device key and Jaunt v1 PSK-authenticated ephemeral P-256/HKDF/AES-GCM channel. Strict authenticated counters reject replay. Native protocol interoperability is tested against the release-installed Python host.
- Only the explicit background-notification option copies the required identity fields into Android Keystore-encrypted storage. Forget/revocation removes them. Vault locking hides terminal data but does not disable a separately enabled background connection.
- Pairing codes, clipboard contents, signing keys, terminal logs and local identities are not release assets.
- The protocol and this new native implementation have **not had an independent security audit**.

## Build and release

Use JDK 17, Android SDK platform 37.0, build-tools 36.0.0 and the checked-in Gradle wrapper. The target behavior is Android 16/API 36; minimum installation API is 26. Gradle dependencies and artifact checksums are generated from real resolution and checked in.

```sh
npm ci
npm run prepare-web
android/gradlew -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

`android-v*` tags run `.github/workflows/android.yml`. The tag must match `versionName`. Signing uses repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD` and `ANDROID_KEY_ALIAS`; the key is materialized only in the runner's temporary directory and removed afterward. The release contains the signed APK, SHA256SUMS and signing-certificate verification output. An existing release is never overwritten. Host `v*` releases remain separate with their three installer assets.

The Android test APK contains an isolated clipboard fixture for the emulator. It is not shipped in the release APK and adds no production debug endpoint. Debug WebView automation is disabled in release builds.

## Validation

See `docs/evidence/android-report.json` for observed results. Physical Android camera, keyboard/IME differences, vendor battery restrictions, real Wi-Fi/mobile handoff and deep-idle notification behavior still require physical-device validation. Emulator screen-off testing is reported separately. No claim is made that an actual Claude Code/Codex build displayed an attachment merely because clipboard bytes and Ctrl+V delivery passed.
