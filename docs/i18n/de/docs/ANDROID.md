[English](../../../ANDROID.md) · [fr](../../fr/docs/ANDROID.md) · [es](../../es/docs/ANDROID.md) · [it](../../it/docs/ANDROID.md) · [pt](../../pt/docs/ANDROID.md) · [de](ANDROID.md)

# jaunt Android

Der Android Client packt die vorhandene funktionale Schnittstelle in ein APK. Native Java Code implementiert Clipboard-Zugriff, Kamera QR Scannen, Dateiauswahl/Speichern und eine Opt-in Vordergrundbenachrichtigungsverbindung. Die Benutzeroberfläche bleibt HTML/JS im Android System WebView. Keine Laufzeit JavaScript kommt von einem CDN oder der öffentlichen Seite: die Assets werden im APK gebündelt.

## Verwendung

Installieren Sie das signierte APK aus der Android-Version, öffnen Sie dann jaunt und scannen Sie das `jaunt pair` QR des Hosts. Android fordert Sie möglicherweise auf, die Installation über den Browser, mit dem es heruntergeladen wurde, zuzulassen.

Öffnen Sie eine shell und verwenden Sie Paste nach dem Kopieren eines Screenshots. Mit einer unterstützten Host-Zwischenablage wird das Bild hochgeladen, in diese Zwischenablage kopiert und Ctrl+V wird an die ausgewählte PTY ohne Enter gesendet. Andernfalls bleiben die vorhandenen expliziten Pfad-/Anhangsoptionen erhalten. Attach öffnet die Datei-/Galerieauswahl von Android. Geteilte Bilder aus einer anderen App erfordern eine Bestätigung, die das Ziel shell nennt. Downloads öffnen den Speicherdialog von Android.

Android-Hintergrundbenachrichtigungen unter Einstellungen für jeden Host aktivieren. Android fordert Benachrichtigungsberechtigung an; eine dauerhafte Benachrichtigung zeigt die Anzahl der Verbindungen an und bietet Stopp an. Benachrichtigungen zeigen den Titel und die Nachricht des Programms an und öffnen den Host / die Sitzung, wenn er angetippt wird. Android steuert die Sichtbarkeit auf dem Sperrbildschirm. jaunt schabt die terminal-Ausgabe nicht, um Benachrichtigungstext zu erstellen. `jaunt notify "Need your attention"` und `jaunt run -- command` können sie auslösen. Der Benutzerdienst des Hosts muss aktiv sein.

Android kann den Netzwerkzugriff im tiefen Leerlauf oder unter den Batterierichtlinien des Herstellers einschränken. Force-Stop verhindert den automatischen Betrieb, bis die App wieder geöffnet wird. Benachrichtigungszustellung ist nicht garantiert. Ein Vordergrunddienst ist kein VPN und erfordert keine Firebase/FCM-Anmeldeinformationen.

## Sicherheitsgrenzen

- `WebViewAssetLoader` bedient nur gebündelte Assets bei `https://moukrea.github.io/jaunt/`. Fehlende Assets scheitern geschlossen. Externe Links öffnen sich außerhalb des privilegierten WebView.
- Die native Nachrichtenbrücke akzeptiert nur den genauen HTTPS-Ursprung und den Hauptrahmen. Es ist kein Datei-/Inhalts-URL-Laden, Klartext-Verkehr, Release-WebView-Debugging oder Backup aktiviert.
- Android-Benachrichtigungsidentitäten verwenden den bereits gepaarten Geräteschlüssel und den jaunt v1 PSK-authentifizierten ephemeren P-256/HKDF/AES-GCM-Kanal. Strenge authentifizierte Zähler lehnen die Wiederholung ab. Die Interoperabilität des nativen Protokolls wird gegen den vom Release installierten Python-Host getestet.
- Nur die explizite Hintergrundbenachrichtigungsoption kopiert die erforderlichen Identitätsfelder in Android Keystore-verschlüsselten Speicher. Vergessen/Widerruf entfernt sie. Die Vault-Verriegelung verbirgt terminal-Daten, deaktiviert jedoch keine separat aktivierte Hintergrundverbindung.
- Pairing-Codes, Clipboard-Inhalte, Signierschlüssel, terminal-Logs und lokale Identitäten sind keine Release-Assets.
- Das Protokoll und diese neue native Implementierung hatten **kein unabhängiges Sicherheitsaudit **.

## Build und Release

Verwenden Sie JDK 17, Android SDK-Plattform 37.0, Build-Tools 36.0.0 und den eingecheckten Gradle-Wrapper. Das Zielverhalten ist Android 16/API 36; die minimale Installations-API ist 26. Gradle-Abhängigkeiten und Artefakt-Prüfsummen werden aus realer Auflösung generiert und eingecheckt.

```sh
npm ci
npm run prepare-web
android/gradlew -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

`android-v*`-Tags führen `.github/workflows/android.yml` aus. Das Tag muss mit `versionName` übereinstimmen. Das Signieren verwendet die Repository-Geheimnisse `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD` und `ANDROID_KEY_ALIAS`; der Schlüssel wird nur im temporären Verzeichnis des Läufers materialisiert und danach entfernt. Das Release enthält den signierten APK, SHA256SUMS und die Signatur-Zertifikat-Verifizierungsausgabe. Ein vorhandenes Release wird nie überschrieben. Host `v*`-Releases bleiben mit ihren drei Installer-Assets getrennt.

Die Android Test APK enthält eine isolierte Clipboard-Befestigung für den Emulator. es wird nicht in der Freigabe ausgeliefert APK und fügt keinen Produktions-Debug-Endpunkt hinzu. WebView Die Automatisierung wird in Release Builds deaktiviert.

## Validierung

Siehe `docs/evidence/android-report.json` für beobachtete Ergebnisse. Physikalisch Android Kamera, Tastatur/IME-Unterschiede, Batteriebeschränkungen des Herstellers, real Wi-FiEs besteht kein Anspruch darauf, dass das Verhalten der physischen Geräte validiert werden muss. Emulator-Screen-Off-Tests werden separat gemeldet. Claude Code/Codex build zeigt ein Attachment an, nur weil Clipboard Bytes und Ctrl+V Lieferung bestanden.

## Anwendungs-Updates

Das Release APK überprüft den veröffentlichten Release-Kanal automatisch beim Öffnen (höchstens einmal pro sechs Stunden); eine aktivierte Hintergrundverbindung prüft und kann Sie auch über ein Update informieren. Einstellungen → Überprüfen auf Updates erzwingen eine Überprüfung. jaunt lädt das APK erst herunter, nachdem Sie Download und Installation ausgewählt haben, überprüft SHA-256 mit der Release-Prüfsummendatei, überprüft die Anwendungs-ID und das Signaturzertifikat mit der installierten App und lehnt Versions-Downgrades ab. Android's eigenes Installationsprogramm fragt dann nach Bestätigung. Beim ersten Update verlangt Android möglicherweise "Allow from this source" für jaunt. Eine normale Sideloaded-App kann diese OS-Bestätigung nicht stillschweigend umgehen.

Updates behalten App-Daten und Pairing-Schlüssel. Deinstallieren der App entfernt sie. Das Update APK wird mit dem Installationsprogramm von Android durch ein privates FileProvider-Stipendium geteilt, kein öffentlich lesbares Verzeichnis. Debug-Builds installieren keine Release-Updates automatisch.
