[English](../../../VALIDATION.md) · [fr](../../fr/docs/VALIDATION.md) · [es](../../es/docs/VALIDATION.md) · [it](../../it/docs/VALIDATION.md) · [pt](../../pt/docs/VALIDATION.md) · [de](VALIDATION.md)

# jaunt — Lieferung validiert am 14. September 2026

Aktuelle Lieferung: [Session Controls, Client-Feedback, Public Release Tests und Einschränkungen](SESSION_CONTROLS_VALIDATION.md). Früherer Host Beta.5 / Android Beta.3 Lieferung: [historischer konsolidierter Bericht](PUBLIC_DELIVERY.md). Die folgenden Abschnitte behalten historische Beobachtungen bei; spätere Berichte ersetzen ihre Testzahlen und den versionspezifischen Status.]

**Seite: https://moukrea.github.io/jaunt/**

**Relay: wss://jaunt-relay.moukrea.workers.dev**

**Freigabe: [v0.1.0-beta.2](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.2)**]

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Die bisherige Form dieses Befehls (`curl -fsSL … | bash`) wurde in einer sauberen Ubuntu VM ohne editierbare Quelle ausgeführt. Siehe [Bootstrap-Korrekturen und Fedora-Tests](INSTALLER_FEDORA.md) für den aktuellen Befehl. Endbenutzer erstellen kein GitHub/Cloudflare-Konto und konfigurieren weder einen öffentlichen Server noch ein VPN. **Das Protokoll und Produkt bleiben ohne ein unabhängiges Sicherheits-Audit. ** SECURITY.md-Einschränkungen, einschließlich des freigegebenen Seiten-Ursprungs, gelten weiterhin.

## Geschichte und Veröffentlichung

Das Archiv wurde integriert, ohne die alte Implementierung zur Inspiration gelesen zu haben. Original Commit `eb71cfe9b80749d3c53f11e428f027b0d64fb372` wird auf `backup/pre-rewrite-20260914` gespeichert. PRs [8](https://github.com/moukrea/jaunt/pull/8) und [9](https://github.com/moukrea/jaunt/pull/9) wurden nach erforderlichen Überprüfungen zusammengeführt, ohne Schutzmaßnahmen zu umgehen, Force-Pushing oder Löschen der Geschichte. Beta.1 bleibt unveränderlich; Host-Korrekturen wurden in Beta.2 veröffentlicht.

Der Besitzer gewährte Wrangler OAuth über den Browser. jaunt Worker Version `00dd364c-c69c-4e89-8878-00ebd38ca414` verwendet `ROOMS` / `Room`, SQLite Migration `v1` und APP_ORIGIN `https://moukrea.github.io`. Es wurde kein anderes Projektrelay verwendet. HTTP Gesundheit, WebSocket Authentifizierung, bidirektionales Routing, Ping / Pong und Ablehnung eines nicht autorisierten Ursprungs wurden verifiziert. Echte verschlüsselte Paarung und shell Operation wurden dann öffentlich getestet.

[Beta.2 release](https://github.com/moukrea/jaunt/actions/runs/34855623613): drei öffentliche Assets (wheel, host-manifest.json, SHA256SUMS), die vor [Pages](https://github.com/moukrea/jaunt/actions/runs/34855764137). GitHub-Variablen jaunt_RELAY_URL, jaunt_RELEASE_TAG und jaunt_PAGE_URL] heruntergeladen und verifiziert wurden. Die 25 Ressourcenanforderungen der Seite, einschließlich JS-Module, Bilder, jsQR/xterm-Lizenzen, Installer und Service Worker, wurden mit gelieferten Bytes unter `/jaunt/` verglichen. Keine Laufzeit JS kam von einem CDN.

OAuth-Anmeldeinformationen werden verschlüsselt mit einem Schlüssel im lokalen System-Keyring gespeichert. CLOUDFLARE_ACCOUNT_ID wird in GitHub gesetzt; eine zukünftige Aktionen-Relay-Bereitstellung benötigt weiterhin ein eigenes CLOUDFLARE_API_TOKEN. Die beobachtete Bereitstellung verwendete ein lokales OAuth, kein GitHub-Token oder ein OAuth-Token, das als permanentes API-Geheimnis kopiert wurde.

## Befehle und beobachtete Ergebnisse

Entwicklungsaufbau: `python3 -m venv .venv`, dann `pip install -e . -r requirements-dev.txt pip-audit` und `npm ci`. Editable Entwicklungsinstallation ist getrennt von Radprüfung.

| Befehl | Ergebnis |
|---|---|
| `npm install`, dann `npm ci` | Real package-lock.json aufgelöst und verpflichtet; reproduzierbare Installation |
| `npm run prepare-web` | 20 Ressourcen; jsQR 1.4.0 und Apache-Lizenz lokal kopiert |
| `pytest -q` | **36 bestanden **; echtes PTY, Web Crypto Interoperabilität, atomares Upgrade, unterbrochenes Senden |
| `npm test` | **17 bestanden **
| `npm run test:relay` | **1 real workerd/Miniflare integration pass**, SQLite und WebSockets |
| `python scripts/check_project.py` | Passiert ohne die `--source` Ausnahme |
| `python scripts/build_release.py` | Beta.2 Rad, Manifest und gebaute Prüfsummen |
| `python -m playwright install chromium` | Chrom tatsächlich installiert |
| `python tests/browser_e2e.py` | **20 Szenarien bestanden** in CI mit dem Python Relais |
| `jaunt_E2E_RELAY=workerd python tests/browser_e2e.py` | **20 Szenarien bestanden**, lokal und in CI |
| `python tests/installer_e2e.py` | **8 Checks bestanden** am Beta.2, lokal und in CI |
| `jaunt_INSTALLER_ONLINE=1 python tests/installer_e2e.py` | **8 Checks bestanden** auf Beta.1, mit einem Loopback-Spiegel und PyPI-Abhängigkeiten in frischen Umgebungen |
| `npm audit` | **0 bekannte Schwachstellen** im aufgelösten Graphen |
| `pip-audit` | **0 bekannte Sicherheitslücken**; das lokale jaunt-Paket fehlt in PyPI und ist daher nicht abgedeckt |

[Beta.2 CI](https://github.com/moukrea/jaunt/actions/runs/34855112550): sieben erfolgreiche Jobs, darunter 36 Host-Tests über Linux/macOS × Python 3.11/3.13 und beide Sätze von 20 Browser-Szenarien. Branch-Schutzanforderungen `lint` und `test` führen echte Prüfungen aus; letzteres hängt von allen vollständigen Suiten ab, die erfolgreich sind.]

Lokale Versionen: Python 3.14.2, Node 25.5.0, npm 11.8.0, pytest 9.1.1, Playwright 1.62.0, Chrom 151.0.7922.34 CI: Node 22, Python 3.11/3.13 Host: Websockets 16.0, Kryptographie 50.0.1, qrcode 8.2, pywebpush 2.5.0 Build: setuptools 84.0.0, pip 26.2.1, Wrangler 4.131.2, direct Miniflare 4.20260730.0; Wrangler verwendet auch Miniflare 5.20260911.1-alpha. Miniflare overrides: sharp 0.35.4 und undici 7.29.0.

Erste Kryptographie/Pip und Miniflare/sharp/undici-Beratungen wurden mit angehefteten Updates und Overrides adressiert, dann erneut getestet. Quellen: [cryptography](https://github.com/pyca/cryptography/security/advisories), [sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [undici](https://github.com/advisories/GHSA-4cwx-7wf7-3272).] Die genaue Herkunft/Version des gelieferten xterm-Bundles bleibt begrenzt, wie in THIRD_PARTY_NOTICES.md beschrieben; das npm-Audit deckt dieses Bundle nicht ab.

## Öffentlicher Akzeptanztest an einer sauberen Maschine

QEMU/KVM Ubuntu 24.04 VM, Python 3.12.3, offizielles Bild, das mit SHA-256 `612b2c0cc1bc413a6cb8c38fd611794caf0f2b436c50013d8b3794db12ad7354` verifiziert wurde. Dort wurde kein Quellcode oder editierbare Laufzeit installiert. Die öffentliche Beta.1-Installation erzeugte einen QR-Code und aktivierte den Systemd User Service; ein echter Neustart bestätigte den automatischen Start, die Relay-Konnektivität und die beibehaltene Identität. Die öffentliche Beta.1 → Beta.2 upgraden erhaltene Geräte.

Ein privates Akzeptanzskript trieb SSH und Chrom gegen die öffentliche Seite. Es lief den dann aktuellen Installationsbefehl, `jaunt status`, `jaunt pair --json`, `systemctl --user` und UI-Interaktionen. QR-Codes und private Ausgabe bleiben außerhalb des Repository. Ergebnisse:

- Öffentliches Pairing und ein authentifizierter verschlüsselter Kanal über Cloudflare.
- Willkürliche shell, `printf`/`cat` und `PUBLIC_jaunt_PROVED`, die sowohl im terminal als auch in einer Datei verifiziert wurden; zweite Registerkarte und Rückkehr zur ersten.
- Multi-Chunk Unicode / Binary Uploads und Downloads verglichen Byte für Byte.
- Übertragenes Bild und zitierter Pfad ohne Enter eingefügt; eine Sentinel-Datei bestätigte, dass nichts automatisch ausgeführt wurde. Native Paste wurde auf dieser Headless-VM deaktiviert.
- Seiten-Reload mit erinnerter Identität und keinem neuen QR-Code.
- Echte ausgehende VM-Netzwerkunterbrechung durch eine temporäre Regel, die auf diese VM beschränkt ist und in einem `finally`-Block entfernt wurde: gleiches shell PID und Sitzung, mit einem bewährten `RESUMED`-Befehl nach Wiederverbindung ohne Kopplung.
- Öffentliches Upgrade abgelehnt mit zwei gewöhnlichen shells aktiv; daemon beibehalten.
- Upgrade mit `jaunt_ALLOW_RESTART=1`: expliziter Neustart, shells beendet, Dienst aktiv, Host/Gerät-Identitäten erhalten, Browser wieder verbunden.
- Der Widerruf trennte den Browser und deaktivierte die Erstellung von shell.
- Keine Browser-Ausnahme.

Die elf Überprüfungen wurden in `docs/evidence/public-report.json` aufgezeichnet, zusammen mit dem Bearbeiter- und Beta.2-Installationsnachweis. Zu diesem Zeitpunkt behielt `browser-report.json` den früheren lokalen 18-Szenario-Lauf als historischen Nachweis bei; die referenzierte CI bewies die 20-Szenario-Suite. Die Beweisdateien wurden seitdem für die spätere Lieferung aktualisiert, die in PUBLIC_DELIVERY.md beschrieben wurde.

## Fehler behoben, ohne Merkmale oder Behauptungen zu entfernen

- Eine späte Antwort auf die Verzeichnisliste hat den getippten Pfad überschrieben: Pro-Host-Entwürfe und Anforderungsrevisionen haben ihn behoben; der Test verzögert echte verschlüsselte Antworten.
- Assertions lesen den terminal vor der asynchronen Lieferung: Bounded Waits prüft nun die tatsächliche Ausgabe, das Einfügen oder den abgeschlossenen Anhang.
- Ein vom Shutdown getrennter Bash-Check, der mit der Erstellung von shell durchgeführt wurde: Atomic Daemon Upgrade Shutdown schließt die Zulassung.
- Relais-Pongs maskierten Host-Verlust: Authentifizierte Host-Nachrichten werden separat überwacht und lösen die Wiederverbindung aus. Der Test suspendiert den realen Host, während das Relais läuft.
- Eine WebSocket-Ausnahme während des Sendens beendete die PTY-Ausgabeaufgabe: Unterbrochene Sendungen werden zu ConnectionError und schließen den Kanal. Zwei Real-PTY-Regressionen scheitern mit dem alten Transport und gehen nach dem Fix durch, einschließlich Wiederholung und neuer Ausgabe auf demselben PID.
- Headless-Tests haben die Desktop-Umgebung und persönliche Profile geerbt: Grafikvariablen werden entfernt und shells wird ohne Profile in temporären Verzeichnissen getestet.
- Tötet nur das Miniflare-Elternteil, das arbeitslos geblieben ist: Der Kabelbaum unterbricht nun seine eigene isolierte Prozessgruppe.

## Einschränkungen und Berichte, die sichtbar bleiben müssen

Diese Beobachtungen beschreiben die erste Beta.2-Lieferung; die spätere Validierung unten und in PUBLIC_DELIVERY.md zeichnet den nachfolgenden Fortschritt auf.

- Der Agent benutzte kein physisches Telefon. Der Benutzer meldete eine erfolgreiche mobile Kopplung, nachdem er einen erinnerten Eintrag vergessen hatte; das validiert keine Kamera, Tastatur/IME, Galerie, Rotation, Wi-Fi/Mobile Handoff, suspendierte PWA oder Sperrbildschirm-Push. Der Benutzer meldete auch eine fehlgeschlagene Android Screenshot-Paste in Claude Code; dieser spezifische Fluss wurde zu diesem Zeitpunkt noch untersucht.
- Tatsächliche Web-Push-Lieferung und native Paste innerhalb von Claude/Codex wurden nicht validiert. Ein eingefügter Pfad ist kein nativer Anhang; auf einem Headless-Host wird keine OS-Zwischenablage versprochen.
- gestartet, macOS/WSL-Installation, Bootstrap ohne Python, Safari/Firefox, echtes tmux, nachhaltige Last, Relaiskontingente/-kosten und SLA wurden in diesem ersten Durchlauf nicht validiert.
- Protokoll, Host, Frontend und Relais haben kein unabhängiges Audit.

## Artefakte und Privatsphäre

Die drei Assets jedes Releases wurden heruntergeladen, Checksummen verifiziert und Radinhalte überprüft. Gitleaks 8.30.1 fand keine Lecks in den Rädern. Der erste Snapshot erzeugte einen falsch positiven Test: xterms JavaScript FourKeyMap/TwoKeyMap Initialisierung. Checks decken das Projekt und seine Vorrichtungen ab, niemals destruktive Scans von persönlichen Verzeichnissen. Kein Host.json, Entwicklungszustand, QR-Code, Vault, Secret oder privater terminal-Inhalt wird veröffentlicht. Workflows wurden überprüft und verwenden npm ci; Pages überprüft alle drei Assets vor dem Einsatz. Der ZIP wird aus einer Erlaubnisliste mit CRC-Checks, Byte-Vergleichen und per-Datei-Checksummen. Die jsQR-Lizenz ist intakt erhalten, einschließlich der endgültigen Newline.

## Usability behebt folgendes Benutzerfeedback

Paste könnte leeren Text als erfolgreiches Paste behandeln. Es öffnet jetzt einen Rich Paste-Bereich, wenn die API keinen nützlichen Inhalt liefert, FileList/DataTransfer-Bilder und eingebettete PNG-Daten aus HTML akzeptiert und weder HTML einfügt noch externe URLs herunterlädt. Ein einzelnes Bild wird automatisch an die Host-Zwischenablage gesendet und dann Ctrl+V in der aufgenommenen Sitzung, wenn ein natives Backend verfügbar ist. Headless-Hosts behalten die Option expliziter Pfade bei. Hostfehler werden nicht mehr als Berechtigungsfehler für mobile Zwischenablagen getarnt.

Der lokal bearbeitete Fluss erreichte **22 Szenarien**, einschließlich des Lesens eines realen Bildes durch Chromiums Zwischenablage-API und der Simulation eines Leertext-Ergebnisses gefolgt von Rich Paste an einen realen Host. Letzterer simuliert nur Clipboard-Eingaben; er beansprucht keine Android-Interaktion.

Ein separater Xvfb/X11 VM erhielt auch das Bild vom Browser über den öffentlichen Worker und installierte das Beta.2-Rad. Der xclip PNG stimmte genau mit der hochgeladenen Datei überein, und der PTY erhielt nur Byte `16` (Ctrl+V), ohne Enter. Dieser Vorveröffentlichungstest injizierte die Branch-UI-Dateien in Chromium am Ursprung der Seite; siehe `native-clipboard-report.json`. Es beweist nicht, dass die Anhängeanzeige innerhalb des tatsächlichen Claude Code/Codex angezeigt wird. Der Benutzer berichtete, dass beide Attach-Modi auf ihrem Gerät funktionierten; die Paste-spezifische Korrektur wartete noch auf die Bestätigung auf ihrem Telefon.

Tracking, Stornierung und Pfade bleiben unter Dateien verfügbar → Transfer-Aktivität nach einer Übertragung; der Browser speichert Downloads.

macOS CI enthüllte einen weiteren Schließungsfall: Das lebende Flag des Schnitters könnte auch nach dem eigentlichen Verlassen des Prozesses wahr bleiben. Das Schließen überprüft nun Popen.poll, bevor die Prozessgruppe signalisiert wird. EPERM wird nur toleriert, wenn der Prozess seitdem beendet wurde; ein Ausfall eines lebenden Kindes bleibt ein Fehler. Eine Regression bestätigt, dass ein bereits verlassenes PID niemals signalisiert wird. Dies brachte die lokale Suite zu 37 Tests und bereitete Beta.3 vor.

## Android Client und Beta.3 Follow-up - 2026-09-14

PR # 10 bestanden jeden CI-Job, einschließlich 37 Python Tests auf Linux / macOS und beide Browser-Relay-Backends, dann als `f85b9cb` zusammengeführt. Der öffentliche Host `v0.1.0-beta.3` wurde von laufen `34859426583` veröffentlicht; alle drei öffentlichen Assets, Radinhalte und Prüfsummen wurden verifiziert und der Rad-Scan fand keine Lecks. Seiten laufen `34859891960` erfolgreich; seine Beta.3 Konfiguration und geänderte Schnittstellenressourcen wurden mit der zusammengeführten Quelle verglichen. Die isolierte Ubuntu VM wurde vom öffentlichen Installateur mit seiner Identität aktualisiert und sein Benutzerdienst aktiv.

Android lokale Build Beobachtungen:

- JDK 17; Gradle 9.5.0 mit offizieller Verteilung SHA-256; AGP 9.3.2; Compil SDK 37.0 / Target 36 / Minimum 26.
- `android/gradlew -p android :app:assembleRelease :app:lintRelease :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug --write-locks --write-verification-metadata sha256 --no-daemon`: erfolgreich. Zwei native Protokoll-Unit-Tests bestanden (bidirektionale Verschlüsselung, Replay/Tamper-Ablehnung und Proof-Bindung) Der native Kanal authentifizierte sich auch gegenüber dem tatsächlichen öffentlichen Python-Host, unabhängig von diesen Unit-Fixes.
- Android Verbleibende Warnungen betreffen die absichtlich beibehaltene Ziel-API 36, die kompatible Gradle-Version, JavaScript für die gebündelte Schnittstelle und Feature-Guard-Analyse aktiviert werden, wobei es sich um überprüfte Grenzen und nicht um unterdrückte Behauptungen handelt; anschließend wurde nach der WebKit-Felsenwarnung ein Renderer-Loss-Wiederherstellungs-Callback hinzugefügt.
- OSV abgefragt alle 21 gelöst Android Release Runtime Maven Artefakte: keine gemeldeten Hinweise auf 2026-09-14. Dies ist Datenbankabdeckung, keine Sicherheitsüberprüfung. WebKit wurde auf 1.17.0 aktualisiert und die JVM JSON Testbibliothek bis 20260814 nach Überprüfung der verfügbaren Versionen.
- `apksigner verify --verbose --print-certs`: signiertes Release APK verifiziert mit APK Signature Scheme v2, RSA 4096, Zertifikat SHA-256 `0c94f35fe68a30eb155c4aa5b9003f633b5b4884f191c54f84bdeeec956348fe`. Lokal signierte APK Installation und Start erfolgreich im Emulator. Release Debugging ist deaktiviert; die unten stehende End-to-End-Automatisierung verwendete das Debugging des Debug Builds WebView, nicht einen Produktions-Debug-Endpunkt.
- Android 14/API 34 x86_64 Emulator: installiert APK → öffentlich Cloudflare relay → Public Release-installierter Beta.3-Host → real shell Befehls- und Ausgabedatei; native Android Text-Clipboard-Roundtrip; nativer Java-verschlüsselter Benachrichtigungskanal; aktuell Android Benachrichtigung mit der App im Hintergrund und Emulator-Bildschirm ausgeschaltet; native Android Bild-Clipboard → Upload → isoliertes Host-X11-Clipboard PTY Byte `16` (Ctrl+V), nein Enter, PNG-Bytes gleich; Rotation und Netzwerk-Toggle behalten dasselbe shell ID/PID; Android Speicherdialog schreibt genaue binäre Fixture-Bytes.
- Android Zwischenablage ist eine separate Instrumentierung APK. Es ist nicht in der signierten Anwendung. Alle Host / Zwischenablage / Bildtests verwendeten synthetische Daten in der isolierten VM / Emulator, niemals die Desktop-Zwischenablage des Benutzers oder persönliche Ordner.
- Nach der Integration der gemeinsamen Schnittstelle: `npm test` und das tatsächliche `npm run test:relay` bestanden; `python tests/browser_e2e.py` bestanden alle 22 Browser-Szenarien; `python scripts/check_project.py` bestanden. GitHub CI wiederholt beide Browser-Relay-Backends vor dem Zusammenführen.

Nachweis: `docs/evidence/android-report.json` und `android-dependency-audit.json`. Physisches Android-Kamera-Scannen, echtes Tastatur-/IME-Verhalten, Galerie-Varianten, tatsächliches Wi-Fi/Mobile-Handoff, tiefes Leerlauf-/OEM-Batterieverhalten und Anhängeerkennung innerhalb einer tatsächlichen Claude Code/Codex-Version werden nicht beansprucht.

Eine Release-spezifische Leerstart-Beobachtung blockierte die Veröffentlichung während der Validierung. Der native Container behält nun einen expliziten Öffnungs-/Wiederholbildschirm, bis die gebündelte Anwendung die Bereitschaft bestätigt und eine Neuzeichnung anfordert. Drei aufeinanderfolgende Kaltstarts der nicht debuggbaren signierten Version zeigten dann den Arbeitsbereich an. Die anfängliche Clean-Run-CI lehnte auch zwei fehlende Gradle-Metadaten-Prüfsummen ab; eine neue Dependency-Cache-Auflösung erzeugte die fehlenden POM/Modul-Prüfsummen, ohne die Überprüfung zu deaktivieren.

## Automatische Aktualisierungen — Validierung der Umsetzung

Der angeforderte Host-Updater fügt sechs Fehler- / Sicherheitstests hinzu: Ein heruntergeladenes Update verzögert sich mit einem echten Status für die aktive Sitzung, auch wenn die Neustartautorisierung vererbt wird; manipulierte Radbytes können die Host-Abschaltung nicht erreichen; automatischer Installationsstreifenneustart und Entwicklerüberschreibungen; expliziter Neustart wird separat behandelt; ältere / ungültige Release-Tags werden abgelehnt; das Deaktivieren automatischer Updates verhindert den Netzwerkzugriff. `pytest -q`: **43 bestanden **. Die echte Installationssuite besteht immer noch alle **8-Prüfungen **, einschließlich der aktiven PTY-Verweigerung und des expliziten Neustarts. Öffentliche automatische Version-zu-Version-Installation und das echte Update-Installationsprogramm von Android werden separat von diesen Tests verfolgt und müssen nach der Veröffentlichung aufgezeichnet werden.

Der signierte (nicht debuggbare) APK, der erfolgreich über den Android-Dokumenten-/Galerie-Picker mit einem QR-Bild gegen den öffentlichen Beta.3-Host und das Cloudflare-Relay gepaart wurde. Androids echter Kameraberechtigungsdialog und der native ZXing-Scanner-Start wurden ebenfalls ausgeübt; eine tatsächliche physische Kamera, die einen QR dekodiert, wird immer noch nicht beansprucht. Der APK umgeht absichtlich den BarcodeDetektor des alten WebView für die Galerie QR-Dekodierung: diese API stürzte im Emulator ab, als Google Play Services abwesend waren; gebündelte jsQR dekodierte die gleiche Paarung erfolgreich.

Der automatische Update-Shutdown-Schutz verzögert sich nun auch bei Dateiübertragungen. Ein tatsächlicher temporärer Upload bleibt nach einem abgelehnten Neustart beschreibbar und wird mit identischen Bytes abgeschlossen, bevor das Herunterfahren erlaubt wird. Die vollständige Python-Suite meldet jetzt **45 bestanden **. Die Android-Release-Entdeckung verwendet den verifizierten öffentlichen Seitenkanal, anstatt dass jedes Gerät GitHub-API-Kontingent verbrauchen muss. Native JVM-Tests: **3 bestanden ** Der signierte APK hat auch einen Befehl über seinen Android Compose / Keyboard-Eingang ausgeführt; die resultierende Host-Datei enthielt die genauen erwarteten Bytes.

## Shared Workspace Release

Siehe [Arbeitsbereichvalidierung](WORKSPACE_VALIDATION.md) für die aktuelle Desktop-/Shared-Session, terminal-Geometrie, Android-Einsätze und Benachrichtigungsänderungen] Frühere Beta-Beobachtungen bleiben historisch und bedeuten nicht, dass jede neue Plattformkombination getestet wurde.

## Nachträgliche Lieferrückgänge

Siehe [delivery regression fixes](DELIVERY_REGRESSIONS.md) für die vom Benutzer gemeldete shell-Umgebung, Ubuntu-Start, Launcher/icon, Android-Scrolling und Benachrichtigungsfehler, die nach der früheren Lieferung entdeckt wurden.
