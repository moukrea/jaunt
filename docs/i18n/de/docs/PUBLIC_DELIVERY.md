[English](../../../PUBLIC_DELIVERY.md) · [fr](../../fr/docs/PUBLIC_DELIVERY.md) · [es](../../es/docs/PUBLIC_DELIVERY.md) · [it](../../it/docs/PUBLIC_DELIVERY.md) · [pt](../../pt/docs/PUBLIC_DELIVERY.md) · [de](PUBLIC_DELIVERY.md)

# Öffentliche Lieferung — 15. September 2026

Für den nachfolgenden Host beta.9 / Desktop beta.7 / Android beta.5 Korrekturen und öffentliche Verifizierung, siehe [Lieferungsregressionsergebnisse](DELIVERY_REGRESSIONS.md). Die Beobachtungen unten beschreiben die frühere Veröffentlichung.]

Die veröffentlichte Anwendung ist ** https://moukrea.github.io/jaunt/**. Endbenutzer benötigen kein GitHub- oder Cloudflare-Konto, VPN oder eine Inbound-Server-Konfiguration.

- Host: [v0.1.0-beta.8](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.8), Python Version `0.1.0b8`].
- Desktop: [0.1.0-beta.6](https://github.com/moukrea/jaunt/releases/tag/desktop-v0.1.0-beta.6), Linux x64/ARM64 tar/deb/rpm und macOS x64/ARM64 zip/dmg packages].
- Android: [signiert beta.4 APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.4/jaunt-android-v0.1.0-beta.4.apk), [freigeben und checksums](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.4)].
- Projektrelay: `wss://jaunt-relay.moukrea.workers.dev`, mit `APP_ORIGIN=https://moukrea.github.io`.

## Validierte Anlage

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Der genaue Befehl, der von der öffentlichen Seite extrahiert wurde, installierte `0.1.0b8` in einem neuen Fedora 43-Container. Ein nachfolgender `jaunt gui --install-only` hat das Desktop-Archiv heruntergeladen und verifiziert und seinen Anwendungsmenüeintrag erstellt. Der normale Installer führt diese Desktop-Einrichtung automatisch durch, wenn er einen grafischen Host erkennt. `jaunt gui` öffnet die installierte Desktop-App; Linux-Verteilungspakete sind auch über die Desktop-Version verfügbar.

Eine separate Ubuntu 24.04.5 VM aktualisierte das nicht editierbare öffentliche Beta.5-Rad auf öffentliche Beta.8, wobei Host- und Geräteidentitäten und der aktivierte, aktive Benutzerdienst beibehalten wurden. Das erste Upgrade wählte explizit die neue öffentliche Version aus, bevor der Standardseitenkanal wechselte.

Automatische Host-Updates behalten gewöhnliche shells und Übertragungen bei. Explizite Neustart-Autorisierung ist erforderlich, um aktive shells zu zerstören, einschließlich Hintergrundjobs, die ein verlassenes shell überleben. Der endgültige Code entfernt auch sowohl aktuelle als auch ältere Umgebungen von automatischen Installationen. Android prüft auf Updates und verwendet das Android-Systeminstallateur; seine Bestätigung bleibt erforderlich.

## Beobachtete Kontrollen

[PR #18](https://github.com/moukrea/jaunt/pull/18) fusionierte, nachdem seine Prüfungen bestanden hatten.] Die [finale CI](https://github.com/moukrea/jaunt/actions/runs/34950530292), [host release](https://github.com/moukrea/jaunt/actions/runs/34950562658), [desktop release](https://github.com/moukrea/jaunt/actions/runs/34948505167), und [Android release](https://github.com/moukrea/jaunt/actions/runs/34948504993) bestanden.] Releases gingen voraus [Pages deployment](https://github.com/moukrea/jaunt/actions/runs/34951111652)].

| Befehl oder tatsächliche Umgebung | Ergebnis |
|---|---|
| `pytest -q` | 61 bestanden; Linux/macOS, Python 3.11 und 3.13 |
| `npm test` | 21 übergeben |
| `npm run test:relay` | Zwei echte Miniflare/Workerd-Tests: Web- und native Desktop-Ursprünge, authentifiziertes Routing und Hibernation-Ping; ausländische Ursprünge abgelehnt |
| `npm run prepare-web`; `python scripts/check_project.py` | Lokale jsQR/xterm Assets und Lizenzen generiert; Ressourcen-/Import-/Syntax-Checks bestanden |
| `python scripts/build_release.py` | Wheel, manifest und SHA256SUMS gebaut |
| `python tests/browser_e2e.py`, mit Entwicklungsrelay und `jaunt_E2E_RELAY=workerd` | 23 Szenarien pro Backend, mit echtem PTYs und Transfers |
| `python tests/shared_workspace_e2e.py` unter Xvfb | Gleiches PTY in Electron/Browser; letzte aktive Ansichtsgrößen; Schließen/Wieder Öffnen und Beenden; persistente Split-Tabs und mobiles Abflachen |
| `python tests/terminal_render_e2e.py` | Scrollen Sie zu den neuesten, endgültigen Zeilen- / Spaltengrenzen, Textauswahl, Theme-Persistenz, synchronisierte Ausgabe; tatsächlich isoliertes Claude Code / Codex-Startup lokal |
| `python tests/installer_e2e.py` | 8 bestanden, einschließlich Prüfsummenmanipulation, nicht editierbarer Import, beibehaltene Identitäten und Ablehnung des impliziten Neustarts |
| Fedora 43/44 CI; `installer_namespace_e2e.py`; `installer_storage_e2e.py` | Öffentliche Installation, isolierte Curl, vollständige temporäre Speicherung und Curl-Write-Error-Wiederherstellung bestanden |
| Android Gradle unit/lint/debug/release builds und `apksigner verify` | Passed; public APK behält das etablierte Signaturzertifikat |
| `python tests/android_workspace_e2e.py` | Android 14 Emulator: echtes öffentliches Relais und shell, tatsächliche Tastaturöffnung / Größe, Systemleistenbegrenzungen, Rotation und terminal-BEL-Benachrichtigung mit ausgeschaltetem Bildschirm |
| Public APK beta.3 → beta.4, installiert mit `adb install -r` | Das gleiche autorisierte Gerät verbindet sich wieder ohne Paarung; diese Überprüfung beansprucht keinen In-App-System-Installer-Flow |
| Public Linux `.deb` installiert in Ubuntu VM | Real shell Befehl ausgeführt; Renderer Seccomp=2 und NoNewPrivs=1, ohne Sandbox-Override |
| `python tests/desktop_remote_e2e.py`; installierter Public Desktop in VM | Native Desktop authentifiziert sich als Remote-Client über Public WSS, führt einen bewährten Befehl aus und beendet die Sitzung |
| Öffentlicher Desktop + öffentliche Seite + öffentliches Rad | Zwei bewährte Befehle in einem gemeinsamen PTY; Close/Reopen behält es bei; Remote-Terminierung entfernt beide Ansichten |
| Öffentlich installierter Host, shell beendet mit hartnäckigem Hintergrundjob | Nicht genehmigter Neustart abgelehnt; Desktop Terminate tötet den verbleibenden Job und entfernt die Sitzung |
Drei Host-Assets, drei Android-Assets und alle zehn Desktop-Pakete, die mit Prüfsummen verifiziert sind; Archivpfade, APK-Signer und Original-Icon-Ressourcen überprüft |
| Public Page | Korrigieren Sie drei Release-Tags; 25 Ressourcen, die unter `/jaunt/` mit gebauten Bytes überprüft wurden, einschließlich lokaler JS und Lizenzen |
| Öffentliches Relais | Gesundheit HTTP 200, echtes WebSocket HTTP 101 und Ping/Pong; ausländischer Browser-Ursprung mit 403 abgelehnt |
| `gitleaks dir` auf exportierter Git-Quelle, öffentlichem Rad und extrahierter Desktop-Anwendung | Keine Lecks erkannt |
| `npm audit`; `pip-audit --local --skip-editable` | Keine bekannten Sicherheitslücken in den überprüften Abhängigkeitsumgebungen gemeldet |

Der Treiber für öffentliche Akzeptanz lief **12 Schecks** gegen die Release-installierte VM: Pairing, nachweislich willkürlich-shell Ausgabe, 512-stelliger Eingabeburst, zweiter Tab und Return, Upload/Download-Byte-Vergleich, Bild-Upload plus zitierter Pfad ohne Enter auf einem Headless Host, Reload ohne QR, echte IPv4/IPv6-Unterbrechung mit der gleichen shell PID Danach Verweigerung des impliziten Upgrades, autorisierter Neustart, Beibehaltung von Identitäten, Widerruf und keine unerkannten Browserfehler.](../../../evidence/public-report.json)Jeder Durchlauf verwendete ein neues Fixture-Verzeichnis; es wurden keine persönlichen Ordner gescannt oder gelöscht.

Die letzte Relay-Revision ist `698962dd-b16a-49f8-b658-a3c5953b3da9` (Wrangler 4.131.2). Sie fügt den genauen nativen Renderer-Ursprung `jaunt://app` neben dem konfigurierten Web-Ursprung hinzu. Beide öffentlichen Ursprünge wurden mit echten WebSocket-Upgrades/Ping-Pong überprüft und Remote-Client-Paarung/Befehle wurden aus dem unverändert installierten Desktop-Paket verifiziert. Routing und End-to-End-Authentifizierung bleiben erforderlich.

Werkzeugversionen und Entwicklungsergebnisse sind in [WORKSPACE_VALIDATION.md](WORKSPACE_VALIDATION.md). Die gelieferte Benutzeroberfläche und die Paketdateien verwenden das Original-Artwork. Der Beta.6-Hostkandidat wurde ersetzt, bevor er zum Standardkanal wurde; der Beta.7-Publishing-Workflow wurde abgebrochen, bevor eine Veröffentlichung erstellt wurde. Tags und Geschichte wurden beibehalten.

## Validierungsgrenzen

Das benutzerdefinierte Sicherheitsprotokoll bleibt **unabhängig ungeprüft **. Automatisierte Tests und Abhängigkeitsscanner stellen keine Sicherheitszertifizierung her.

Keine physische Android Handapparat war verfügbar. Kamera QR Aufnahme, Galerie-/OEM-Variationen, physische Gestennavigation, Wi-Fi/mobile Übergabe, tiefer Leerlauf- und Sperrbildschirmdruck auf ein echtes Telefon bleiben ungültig. Emulatorergebnisse werden als Emulatorergebnisse gemeldet.

macOS Desktop-Ausführung und Vertrauensaufforderungen, ARM-Hardware, Desktop-Benachrichtigungspräsentation in allen Umgebungen und Bereitstellung von Browser-Push-Providern bleiben plattformspezifische Validierungsgrenzen. macOS Desktop-Builds sind nicht signiert. Linux pro Benutzer-Archiv erfordern eine funktionierende Chromium-Sandbox; verwenden Sie das Verteilungspaket, in dem Benutzer-Namespaces eingeschränkt sind. Produktionsstarter deaktivieren die Sandbox nicht.

Die tatsächlichen isolierten Claude Code/Codex-Startbildschirme wurden ohne Authentifizierungs- oder Modellanforderungen getestet. Vollständige Agentenkonversationen und jede agentenspezifische Image-Attachment-Implementierung werden nicht als getestet beansprucht. Image-Upload plus Pfadeinfügung unterscheidet sich von der bedingten nativen OS-Zwischenablage plus Ctrl+V; weder sendet Enter automatisch. Ein Headless-Host erwirbt keine OS-Zwischenablage durch Anschließen eines Clients.

Das Schließen einer Ansicht behält ihre shell. Explizite Beendigung beendet ihre POSIX-Sitzungsjobs; absichtlich daemonisierte Prozesse, die eine separate OS-Sitzung erstellen, liegen außerhalb dieser Grenze. Gewöhnliche shells können einen Host-Neustart oder Daemon-Neustart nicht überleben; tmux bleibt für diese separate Persistenzanforderung optional.
