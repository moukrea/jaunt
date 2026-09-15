[English](../../../WORKSPACE_VALIDATION.md) · [fr](../../fr/docs/WORKSPACE_VALIDATION.md) · [es](../../es/docs/WORKSPACE_VALIDATION.md) · [it](../../it/docs/WORKSPACE_VALIDATION.md) · [pt](../../pt/docs/WORKSPACE_VALIDATION.md) · [de](WORKSPACE_VALIDATION.md)

# Validierung der Arbeitsbereiche — 2026-09-15

Dieser Bericht zeichnet Beobachtungen auf, keine Zertifizierung. Das benutzerdefinierte Protokoll bleibt unabhängig voneinander ungeprüft. Öffentliche Bereitstellungs- und Installations-Release-Prüfungen werden in [PUBLIC_DELIVERY.md](PUBLIC_DELIVERY.md)] aufgezeichnet; in der folgenden Tabelle sind die Entwicklungs- und Plattformprüfungen aufgeführt.

## Lokale Beobachtungen

| Befehl / Umgebung | Beobachtetes Ergebnis |
|---|---|
| `.venv/bin/python -m pytest -q` | 61 bestanden, einschließlich eines echten shell/Hintergrund-Jobs, der die anmutige Kündigung ignoriert, Jobs nach dem Ausstieg von shell überlebt, Geometrie-Besitz geteilt, OSC-Parsing, Verschlüsselung/Wiedergabe und sichere Updates |
| `npm test` | 21 bestanden, einschließlich Split-Tree-Retention, Themes, Kryptographie, Eingabe-Pacing / Order und Disconnect-ohne-Input-Replay |
| `npm run test:relay` | Real workerd/Miniflare WebSocket upgrade, Durable Object Registration, Routing und Hibernation Ping übergeben |
| `npm run prepare-web` | Bundles pinned xterm/fit und jsQR lokal, bewahrt ihre Lizenzen, kopiert Installateur, regeneriert Service-Worker-Inventar |
| `python scripts/check_project.py` | Lokale Importe, Ressourcenpfade und Syntax übergeben |
| `python scripts/build_release.py` | Ein echtes, nicht editierbares Hostrad, Manifest und SHA256SUMS erfolgreich gebaut |
| `python tests/browser_e2e.py` | 23 Szenarien bestanden: echte PTY-Befehle und 512-Zeichen-Bursts, unabhängige Clients, Netzwerkwiederherstellung, exakte Byte-Übertragungen, Bild / Pfad / Kopfloses Verhalten, Tresorsperrung und Widerruf |
| `DISPLAY=:179 python tests/shared_workspace_e2e.py` | Aktueller Electron-Prozess und unabhängiger Browser teilen sich einen PTY; passive Größenänderung stiehlt die Größe nicht; Close/Reopen behält shell; Beenden schließt alle Ansichten; Split-Tabs überleben Neuladen und Abflachen auf Mobilgeräten |
| `python tests/terminal_render_e2e.py` | Long-Output-Rad-Scroll und Rückkehr zu den neuesten, endgültigen Zeilen- / Spaltengrenzen, native Textauswahlsteuerung, persistenten Themes, Synchronized-Output-Befestigung; installierte Claude Code / Codex Startbildschirme in isolierten, nicht authentifizierten Profilen |
| Android Gradle debug build/unit tests | Build und native unit tests bestanden |
| `python tests/android_workspace_e2e.py` | Android 14 Emulator: installiert APK → projekteigenes öffentliches Relais → isolierter echter Host → bewährter Befehl; tatsächlicher Bildschirmtap öffnet IME und schrumpft Viewport; Statusleistenbegrenzungen, Rotation und Screen-Off-OS-Benachrichtigung von einem terminal BEL übergeben |
| Installiert `.deb` in Ubuntu 24.04.5 VM | Native App geöffnet, nicht editierbares Kandidatenrad führte einen bewährten lokalen PTY-Befehl aus, Renderer hatte Seccomp=2 und NoNewPrivs=1, und es war kein Sandbox-Override vorhanden |
| `npm audit` | Null gemeldete Schwachstellen im aufgelösten Abhängigkeitsbaum |

Die lokale Toolchain umfasste Python 3.14.2, Node 25.5.0, npm 11.8.0, Java 17, Gradle 9.5.0, Electron 44.3.0, xterm 6.0.0, FitAddon 0.11.0 und jsQR 1.4.0. CI verwendet Node 22 und seine konfigurierte Python/Linux/macOS-Matrix. Die tatsächlich installierten CLI-Startüberprüfungen verwendeten Claude Code 2.1.272 und Codex-cli 0.154.0; sie haben keine Modellanforderungen eingereicht oder Benutzergespräche / -nachweise überprüft.

Versionsreferenzen wurden mit [Electrons offiziellem Release Record](https://releases.electronjs.org/release/v44.3.0)] und [xterms Release Notes](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0). xterm 6 enthält synchronisierte Ausgabeunterstützung. npms Audit ersetzt keine Chromium / Electron Sicherheitsüberprüfung oder Audit des benutzerdefinierten Protokolls.]

## Berichtigte Feststellungen während der Validierung

- FitAddon hat einen gepolsterten Elternteil gemessen und Zeilen/Spalten außerhalb des eigentlichen Anzeigebereichs zugewiesen. Eine separate, nicht gepolsterte Halterung stellt nun den gemessenen Bereich bereit; Tests überprüfen beide sichtbaren Grenzen.
- Die Android-Implementierung polsterte WebView selbst anstelle seines äußeren Layouts. Der äußere Rahmen verbraucht nun System/Cutout/IME-Einsätze und die freigegebene Benutzeroberfläche erhält den Tastaturzustand.
- Das ursprüngliche Android-Symbol war eine nicht verwandte terminal-Zeichnung. Android liefert jetzt das genau gelieferte PNG; Die Browser / Favicon / Benachrichtigung / Desktop-Referenzen verwenden das gleiche Artwork.
- Dem gelieferten terminal-Bundle fehlte es an einer exakten Provenienz. Es wird nun aus gepinnten npm-Abhängigkeiten und beiden vorgelagerten Lizenzen umgebaut.
- Das Schließen nur einer Ansicht und das Töten des zugrunde liegenden shell wurden verschmelzt. Sie haben nun unterschiedliche UI-Aktionen und -Tests.
- Desktop-Paketberechtigungen haben einen privaten Build-Umask geerbt, wodurch das installierte Verzeichnis für gewöhnliche Benutzer unzugänglich wird. Der Packaging-Hook normalisiert jetzt Anwendungsverzeichnisse und ausführbare / Datenberechtigungen. Die verpackte Sandbox-Validierung wird separat von Source-Mode-Renderer-Tests verfolgt. Explizite ALSA / GBM / DRM-Abhängigkeiten wurden ebenfalls hinzugefügt, nachdem die Installation in der sauberen Ubuntu VM eine fehlende Bibliothek freilegte.

CI hat außerdem die macOS Bash 3.2-Kompatibilität im Umgebungs-Alias-Bootstrap und eine Fehlanpassung des Zustandsverzeichnisses für alte Räder/Neuinstallateure erfasst. Der Kompatibilitäts-Bootstrap läuft nun, bevor ein altes Rad importiert wird, einschließlich nachfolgender CLI-Aufrufe. Der echte Fedora Limited-Curl-Test wird mit dem öffentlichen Beta-Rad und Kandidaten-Installationsprogramm bestanden.

Die Host-Matrix wurde auf Linux und macOS mit Python 3.11 und 3.13 übergeben. Auf macOS verwendet der Host die System Waitid-Bindung, wenn Python sie auslässt, nach den öffentlichen [wait.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/wait.h) und [signal.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/signal.h)] Definitionen von Apple. Sowohl die Ausführung als auch die Beendigung des Exited-shell-Hintergrundjobs werden durch die gleichen Realprozesstests auf beiden Betriebssystemen ausgeübt.

Der Source-Mode-Headless-Electron-Test verwendet einen Test-Only-Sandbox-Override in einem isolierten X-Server. Der separate Installed-Package-Check wurde ohne Override auf der Ubuntu VM durchgeführt. Der Produktionshaupt- / Preload-Code deaktiviert die Sandbox niemals.

## Verbleibende Validierungsgrenzen

Keine physische Android Mobilteil war verfügbar. Echte Handy-Kamera QR Aufnahme, Galerievariationen, Gestennavigation OEM-Verhalten, physische Rotation, Wi-Fi/mobile Übergabe und Zustellung von Benachrichtigungen im Leerlauf bleiben unvalidiert. Emulator IME/Systemleiste/Screen-Off-Prüfungen ersetzen diese Tests nicht.

Der tatsächliche CLI-Start und eine synchronisierte Ausgabevorrichtung werden getestet; eine vollständige authentifizierte Modellkonversation, das Redraw-Verhalten jedes CLI-Releases und jede agentenspezifische Image-Attachment-Implementierung werden nicht als validiert beansprucht. Nativer Clipboard-Transport und die explizite Headless-Upload-/Pfad-Unterscheidung bleiben von der Attachment-Erkennung eines Agenten getrennt.

macOS Desktop-Ausführung, OS-Vertrauensaufforderungen, ARM-Hardware, Desktop-Benachrichtigungspräsentation in Desktop-Umgebungen und Browser-Push-Provider-Lieferung erfordern plattformspezifische Beweise. Build-Ergebnisse allein sind keine Laufzeitvalidierung. Das Browser-Fallback bleibt verfügbar und es wird keine bedingungslose Lieferung oder perfektes Verhalten auf jedem terminal / Telefon versprochen.
