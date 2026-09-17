[English](../../../README.md) · [fr](../fr/README.md) · [es](../es/README.md) · [it](../it/README.md) · [pt](../pt/README.md) · [de](README.md)

# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

**Ihre Rechner, Ihre Shells, Ihre Dateien. Auf jedem Bildschirm.**

jaunt verbindet die Geräte, die Sie bei sich tragen, mit den Rechnern, auf denen Sie arbeiten. Installieren Sie einen kleinen Host auf jedem Linux- oder macOS-Rechner, koppeln Sie Ihr Smartphone, Ihren Laptop oder Ihren Desktop einmalig, und alle zeigen denselben Arbeitsbereich: echte Shells in echten PTYs, die Dateien daneben und die Sitzungen, die Sie laufen gelassen haben. Öffnen, umbenennen, teilen, umsortieren, schließen oder beenden Sie Shells auf jedem Host von jedem Gerät aus; bei aktivierten *gemeinsam geöffneten Sitzungen* folgen Ihnen dieselben Tabs, Bereiche und die aktive Shell von Bildschirm zu Bildschirm. Claude Code und Codex laufen dort wie jedes andere Programm, und wenn beide auf einem Host installiert sind, sorgt ein einziger Schalter dafür, dass ihre Sitzungen im selben Projekt voneinander wissen und Nachrichten austauschen können. Clients: ein Browser (auch als PWA installierbar), eine native Android-App und eine native Desktop-App; alle drei liefern dieselbe Oberfläche. Verbindungen gehen vom Host nach außen über ein Relay, Ende-zu-Ende-verschlüsselt, ohne offenen Port, ohne VPN und ohne Konto.

**Host: 0.1.0-beta.29 · Desktop: 0.1.0-beta.23 · Android: 0.1.0-beta.21.** [jaunt öffnen](https://moukrea.github.io/jaunt/). Veröffentlichung und Validierung der Releases werden im Validierungsbericht nachverfolgt. Das Protokoll hat **kein unabhängiges Sicherheitsaudit erhalten**. Beobachtete Testergebnisse und nicht validierte Einschränkungen finden Sie im [aktuellen Validierungsbericht](docs/SEAMLESS_WORKSPACE_VALIDATION.md).

## Host installieren

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Unterstützt Linux, macOS und WSL. Erfordert `curl`. Der Installer verwendet eine kompatible Python-Laufzeit 3.11–3.14 oder installiert über uv eine private Python-Laufzeit. Der Host wird ohne Administratorrechte installiert. Unter Ubuntu mit eingeschränkten User Namespaces verwendet die optionale Desktop-App den Paketinstaller des Systems und fragt unter Umständen nach einem Administratorpasswort, um ihre Sandbox einzurichten. Der Installer prüft die SHA-256-Summe des Releases, legt eine private Umgebung an und startet, sofern verfügbar, einen Benutzerdienst. Automatische Updates sind aktiviert. Kompatible Hosts behalten ihre Shell-Prozesse beim Austausch der Laufzeit bei und warten, bis laufende Übertragungen abgeschlossen sind.

Unter Android [installieren Sie die signierte APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.21/jaunt-android-v0.1.0-beta.21.apk) und scannen anschließend den vom Host angezeigten QR-Code. Auf einem Desktop oder im Browser öffnen Sie **https://moukrea.github.io/jaunt/**. Sie können auch die Kopplungszeichenfolge `jaunt1.…` einfügen. Der QR-Code läuft nach zehn Minuten ab und kann nur einmal verwendet werden. Jedes gemerkte Gerät verwendet danach seinen eigenen Schlüssel, sodass ein Wechsel zwischen WLAN und Mobilfunk keine erneute Kopplung erfordert. Lassen Sie den Tab für die automatische Wiederverbindung geöffnet; öffnen Sie die App erneut, wenn das mobile Betriebssystem sie anhält oder beendet.

```sh
jaunt gui                        # Open/install the native desktop workspace
jaunt pair                       # Pair another device
jaunt service install            # Install and enable the user service
jaunt status                     # Host and shell status
jaunt update                     # Check for an update without closing shells
jaunt doctor                     # Diagnostics without exposing secrets
jaunt devices                    # List authorized devices
jaunt revoke -- DEVICE_ID           # Revoke a lost device
jaunt notify "Build finished"     # Notify connected devices
jaunt run -- make test            # Notify when a command finishes
jaunt clipboard < notes.txt      # Make text available to the client
jaunt stop                       # Stop the host AND its non-tmux shells
```

Die Kopplung gewährt Zugriff als das **Systemkonto, unter dem der Host läuft**, mit allen Berechtigungen dieses Kontos. Führen Sie den Host im Normalbetrieb nicht als root aus. Ein QR-Code gewährt Shell-Zugriff: Veröffentlichen Sie ihn niemals.

## Funktionen

| Bereich | Verhalten |
|---|---|
| Hosts | Koppeln Sie beliebig viele Linux-/macOS-Rechner; jeder behält seine eigenen Sitzungen, Dateien, Einstellungen und seinen Anzeigenamen; Wechsel über eine gemeinsame Seitenleiste; Standard-Host und Reihenfolge |
| Terminals | Echte PTYs mit Ihrer eigenen Shell, interaktive Tastatur, Tabs, Erstellen/Umbenennen/Öffnen/Abtrennen/Beenden, Umsortieren per Drag-and-drop, geteilte Bereiche (nebeneinander oder übereinander), gemeinsame Größe, mobile Tasten Strg/Alt/Esc/Tab/Pfeile, Eingabefeld für lange Eingaben |
| Gemeinsam geöffnete Sitzungen | Pro Host: alle Clients und der Host selbst zeigen dieselben Tabs, Bereiche, Reihenfolge und aktive Shell; optionaler Modus „nur angezeigte Sitzungen existieren“ |
| Wiederverbindung | Begrenzter Verlauf, automatische Wiederverbindung, gemerkter Zustand; ein Verbindungsabbruch im Browser schließt die Shell nicht; Shells überleben In-Place-Updates des Hosts |
| Bestehende tmux-Sitzungen | Bestehende tmux-Sitzungen werden weiterhin unterstützt; neue Sitzungen in der Oberfläche sind gewöhnliche gemeinsame Shells |
| Dateien | Durchsuchen, versteckte Dateien, Seitenweise Anzeige, Verzeichnisse anlegen, Umbenennen, nicht rekursives Löschen, Upload/Download, Text-/Bildvorschau |
| Übertragungen | Sichtbarer Fortschritt und aufbewahrte Erfolgs-/Fehlerergebnisse; detaillierte Nachverfolgung unter Dateien → Übertragungsaktivität; 48-KiB-Blöcke, Wiederaufnahme-Offsets nach Netzwerkunterbrechung, SHA-256 beim Upload, atomarer Abschluss, Abbruch |
| Bilder | Galerie, Dateiauswahl, Einfügen und Drag-and-drop; PNG-Konvertierung für vom Browser dekodierbare Formate; Einfügen des Pfads oder bedingtes natives Einfügen |
| Zwischenablage | Auswahl, Kopieren aus dem aufbewahrten Scrollback, Lesen/Schreiben der Host-Zwischenablage, wenn verfügbar, Textpuffer für Headless-Hosts, OSC 52 nur zum Kopieren |
| Claude Code ↔ Codex | Ein Schalter pro Host: Sitzungen im selben Projekt erfahren über ihre Hooks voneinander und können der offenen Unterhaltung der jeweils anderen Seite Nachrichten senden; ausgeschaltet wird alles entfernt, was jaunt hinzugefügt hat |
| Schutz | Einmal-QR-Codes, Schlüssel pro Gerät, Widerruf, optional per PIN/Passwort geschützter Browser-Tresor und automatische Sperre |
| Benachrichtigungen | Optionaler nativer Android-Dienst oder Web Push im Browser; Terminal-Glocken, Programmereignisse, Sitzungsende, Test in den Einstellungen und CLI `notify`/`run` |
| Oberfläche | Native Desktop- und Android-Apps mit gemeinsamer gebündelter Oberfläche; Browser-Client und PWA; sechs Sprachen; dunkles, helles, System- und zirkadianes Design |
| Updates | Der Host ersetzt sich selbst an Ort und Stelle, ohne Shells zu beenden; Desktop-App und APK prüfen, verifizieren und installieren ihre eigenen Updates |

## Nur Desktop-Client

Um sich mit anderen Hosts zu verbinden, ohne einen lokalen Host-Dienst oder die jaunt-CLI zu installieren:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash -s -- --client-only'
```

Dies installiert dieselbe Desktop-Anwendung samt Launcher, mit Kopplung entfernter Hosts, Sitzungen, Dateien, Benachrichtigungen und automatischen App-Updates. Es wird kein Daemon gestartet und es werden keine Steuerelemente für einen lokalen Host angezeigt. Ein zuvor installierter Host wird nicht deinstalliert. Führen Sie später den normalen Host-Installationsbefehl aus, um die lokale Host-Integration zu aktivieren.

Die installierte Browser-Anwendung heißt **jaunt (PWA)**, damit sie sich von der nativen **jaunt**-App unterscheiden lässt. Beide verwenden das ursprüngliche transparente Logo. Die native Android-App verwendet dieselbe Grafik ohne gebündelten dunklen Hintergrund; einzelne Launcher können ihre eigene Icon-Darstellung anwenden.

## Gemeinsamer Desktop-Arbeitsbereich

Öffnen Sie **jaunt** über das Anwendungsmenü des Hosts oder führen Sie `jaunt gui` aus. Host und entfernte Clients teilen sich dieselben gewöhnlichen Shells ohne tmux. **Neue Shell** öffnet sofort eine automatisch benannte Shell, die das aktuelle Verzeichnis der zuvor aktiven Shell übernimmt. Über die Ordner-Schaltfläche durchsuchen Sie die Verzeichnisse des Hosts und geben der neuen Shell optional einen Namen. **Sitzungen** listet laufende und beendete Sitzungen auf: öffnen, umbenennen, nur die eigene Ansicht schließen oder eine Shell ausdrücklich für alle beenden. Sie können einen Tab auch per Doppelklick auf seinen Titel umbenennen, ebenso einen Bereich per Doppelklick auf dessen Titel. Ziehen Sie Tabs, um sie umzusortieren; das Auswählen eines Tabs ändert nie seine Position. Das Gerät, mit dem Sie gerade arbeiten, bestimmt die gemeinsame Terminalgröße.

Die beiden **Teilen-Symbole** ordnen Bereiche auf dem Desktop nebeneinander oder übereinander an, mit einer neuen oder einer bestehenden Sitzung. Jeder Bereich lässt sich in einen eigenen Tab verschieben. Layouts bleiben beim erneuten Öffnen erhalten; auf Mobilgeräten erscheinen die Sitzungen als normale Tabs. Die Desktop-Seitenleiste lässt sich einklappen, die Einstellung wird gemerkt. Die Einstellungen umfassen Anzeigenamen für Hosts, Reihenfolge und Standard-Host, das dunkle, helle, System- und zirkadiane Design sowie die Benachrichtigungsoptionen. Host-Einstellungen folgen sofort dem ausgewählten Rechner, einschließlich seiner Identität und Update-Steuerung. Die native Desktop-App verwaltet außerdem den lokalen Host-Dienst und koppelt sich mit anderen Hosts; die Steuerung des lokalen Dienstes erscheint nur für den lokalen Host, während Updates der Desktop-Anwendung davon getrennt bleiben. Siehe den [Arbeitsbereich-Leitfaden](docs/WORKSPACE.md) und den [Validierungsbericht](docs/WORKSPACE_VALIDATION.md).

**Brücke Claude Code ↔ Codex.** Wenn sowohl `claude` als auch `codex` auf einem Host installiert sind, zeigen die Einstellungen einen Schalter an. Ist er eingeschaltet, wissen echte Claude-Code- und Codex-Sitzungen, die in jaunt-Shells im selben Projekt geöffnet werden, automatisch voneinander (als gewöhnlicher Hook-Kontext) und können der offenen Unterhaltung der jeweils anderen Seite Nachrichten senden, auf Ihre Anweisung oder aus eigener Initiative. Standardmäßig ausgeschaltet; beim Ausschalten wird alles entfernt, was jaunt zu beiden Laufzeiten hinzugefügt hat. Siehe den [Brücken-Leitfaden](../../../docs/BRIDGE.md).

## Bildverarbeitung

Der Fortschritt bleibt während des Uploads und der Zustellung per Zwischenablage oder Pfad sichtbar. Abgeschlossene Vorgänge werden zu einem kompakten Ergebnis zusammengefasst; **Verlauf anzeigen** bewahrt die Details. Der Abbruch einer Übertragung wird als Abbruch angezeigt, und Fehler bleiben ihrem Vorgang zugeordnet. Das Endergebnis gibt genau an, was passiert ist; Fehler bleiben mit einer Wiederholen-Aktion sichtbar. Ein erfolgreich eingefügter Pfad oder eine erfolgreiche Zustellung per Strg+V beweist nicht, dass Claude Code oder Codex einen Anhang erkannt haben.

**Einfügen:** Ist ein natives Backend verfügbar, wird ein Bild in die Zwischenablage des Hosts hochgeladen und mit Strg+V in die ausgewählte Sitzung eingefügt. Liefert der Browser eine leere Zwischenablage, bietet die Oberfläche einen Einfügebereich und eine Bildauswahl an. „Anhängen“ behält beide expliziten Modi bei. Es wird keine Eingabetaste gesendet.

**Fallback bei aktiver Verbindung:** Wählen Sie ein Bild aus oder fügen Sie es ein, laden Sie es auf den Host hoch und fügen Sie seinen korrekt maskierten Pfad in das Terminal ein. Nichts sendet den Befehl automatisch ab. Claude, Codex oder ein anderes Werkzeug kann die Datei lesen, sofern der eigene Modus dies unterstützt.

**Bedingtes natives Einfügen:** Verfügt der Host über eine zugängliche grafische Zwischenablage (macOS, Wayland mit `wl-clipboard` oder X11 mit `xclip`), legt jaunt das PNG dort ab und sendet Strg+V an das Terminal. Dies hängt zusätzlich vom Tastenkürzel und Verhalten des CLI-Werkzeugs ab. **Auf einem Headless-Host kann jaunt keinen nativen Claude-/Codex-Anhang erzeugen: Es weicht auf eine Datei und deren Pfad aus.** HEIC und andere Formate, die der Browser nicht dekodieren kann, lassen sich weiterhin als Dateien übertragen, werden aber nicht in PNG konvertiert.

## Automatische Updates

| Komponente | Update-Verhalten |
|---|---|
| Host / CLI | Gleiche Installation. Prüft alle 15 Minuten den veröffentlichten Kanal, verifiziert Downloads und ersetzt kompatible Laufzeiten, ohne Shell-Prozesse zu beenden. Übertragungen werden zuerst abgeschlossen. Über die Einstellungen oder `jaunt update` wird sofort geprüft. Ältere Hosts ohne Laufzeitübergabe warten, solange gewöhnliche Shells aktiv sind; das Beenden dieser Shells erfordert weiterhin eine ausdrückliche Bestätigung. |
| Desktop-App | Eigene Version, unabhängig vom Host. Prüft, lädt und verifiziert ein Update automatisch; installiert es beim Schließen der App. Die Einstellungen bieten eine manuelle Prüfung, einen Schalter für automatische Updates und **Installieren und neu öffnen**. Ein Update der GUI stoppt weder den Host noch seine Shells. Systempakete können eine Autorisierung durch das Betriebssystem verlangen. |
| Android-APK | Prüft automatisch auf eine neue APK. Ein sichtbarer Prüf-/Download-Dialog führt zur Installationsbestätigung von Android. Prüfsumme und Signaturzertifikat der APK werden verifiziert; Android erlaubt keine stille Selbstinstallation. |
| Web-Client | Verwendet die auf Pages veröffentlichte Version. Erneut öffnen oder neu laden, um ein heruntergeladenes Service-Worker-Update zu aktivieren. |

Bestehende Installationen benötigen erst das Release, das ihren Updater enthält, bevor dieser Updater laufen kann. Ein erneuter Aufruf des offiziellen Host-Befehls aktualisiert den Host und installiert die angebotene Desktop-App; er weigert sich, aktive gewöhnliche Shells stillschweigend zu schließen. Kopplungsschlüssel bleiben erhalten. Siehe [Updates und Neustartschutz](docs/UPDATES.md).

## Rückmeldung zu Verbindung und Vorgängen

Bei einer Netzwerkunterbrechung erscheint ein einzelnes, dauerhaftes Verbindungsbanner mit einer Wiederholen-Aktion. jaunt verbindet sich mit dem gespeicherten Geräteschlüssel neu; nicht gesendete Terminaleingaben werden nicht nachgeholt. Ein Widerruf oder eine fehlgeschlagene Host-Verifizierung beenden die Verbindung und erklären den nächsten Schritt. Fehler in einem Dialog bleiben in diesem Dialog; andere Aktionsfehler bleiben sichtbar, bis sie geschlossen werden. Kurze Bestätigungs-Toasts werden dedupliziert und auf zwei begrenzt.

Uploads, Downloads, Dienstinstallation und Update-Prüfungen zeigen unter Aktivität den Fortschritt und ein Endergebnis. Netzwerkpausen werden ausdrücklich angezeigt, Übertragungen lassen sich abbrechen, und der abgeschlossene Verlauf kann aufgeklappt werden. Verfügbare Updates bieten eine direkte Aktion statt eines ablaufenden Toasts.

## Benachrichtigungen

Aktivieren Sie Benachrichtigungen in den **Einstellungen** und nutzen Sie die dortige Testaktion. Titel und Text von Programmbenachrichtigungen bleiben erhalten, wenn sie mitgeliefert werden; eine einfache Terminal-Glocke hat keinen Nachrichtentext, der wiederhergestellt werden könnte. Ein Klick auf eine Benachrichtigung wählt den zugehörigen Host und die zugehörige Sitzung aus. Desktop-Benachrichtigungen setzen voraus, dass die App läuft; Android verwendet seinen optionalen Vordergrund-Verbindungsdienst; der Web-Client verwendet Web Push des Browsers. Benachrichtigungsinhalte können je nach Betriebssystemeinstellungen auf dem Sperrbildschirm erscheinen.

## Bekannte Einschränkungen

- Bis zu 16 aktive Shells, 32 aufbewahrte Ansichten, 2 MiB Roh-Replay pro PTY und 10.000 xterm-Scrollback-Zeilen. „Alles kopieren“ umfasst den aufbewahrten Verlauf, kein unbegrenztes Protokoll.
- Dateilimit des Hosts: 512 MiB. Downloads im Arbeitsspeicher sind in Browsern ohne direktes Schreiben von Dateien auf 128 MiB begrenzt; Vorschauen auf 16 MiB. Bis zu acht gleichzeitige Uploads und 1 GiB deklarierte Gesamtgröße.
- Uploads werden nach Netzwerkunterbrechungen fortgesetzt, solange Host und Seite die Übertragung behalten. Nach einem Neustart des Hosts oder einem vollständigen Neuladen der Seite müssen Sie den Upload neu starten; jaunt verschafft sich keinen unautorisierten dauerhaften Zugriff auf die lokalen Dateien des Smartphones.
- Gewöhnliche Shells überleben Verbindungsabbrüche und kompatible Laufzeit-Updates, **nicht aber ein ausdrückliches Stoppen/Neustarten des Daemons oder einen Neustart des Rechners**. tmux kann einen Daemon-Neustart überleben, aber keinen Neustart des Betriebssystems.
- Nur ein jaunt-Anwendungstab pro Browserprofil kann den Tresor gleichzeitig besitzen. Mehrere Terminal-Tabs innerhalb von jaunt und mehrere Geräte werden unterstützt.
- Browser-Benachrichtigungen erfordern eine Berechtigung und Web-Push-Unterstützung. In der APK aktivieren Sie Android-Hintergrundbenachrichtigungen in den Einstellungen; Akku-Einschränkungen von Android können die Zustellung verzögern. Unter iOS verwenden Sie die installierte PWA. Die Zustellung hängt vom Netzwerk und vom Push-Anbieter ab; sie ist nicht in Echtzeit garantiert.
- Ein schlafender oder ausgeschalteter Host ist nicht erreichbar. Es gibt kein Fernwecken, keinen beliebigen TCP-Tunnel, keinen grafischen Desktop und keine Unterstützung für native Windows-Shells.
- Linux-Desktop-Pakete sind für x64 und ARM64 verfügbar; macOS-Archive sind weder signiert noch notarisiert. Ein natives Windows-Desktop-Paket wird nicht bereitgestellt. Das Verhalten auf physischen Android-Smartphones und die geschützte Autorisierung des macOS-Updaters wurden nicht validiert; Emulator-Ergebnisse sind separat dokumentiert.
- Kosten, Kontingente und Verfügbarkeit des Produktions-Relays hängen vom Cloudflare-Konto ab. Die grundlegenden Schutzmaßnahmen des Relays sind kein garantierter kommerzieller Missbrauchsschutz.

## Lokale Entwicklung

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm ci
npm run prepare-web
python scripts/dev.py
```

Der Runner lauscht nur auf `127.0.0.1`, startet einen Host und ein lokales Relay und zeigt einen Test-QR-Code an. **Der Host wird dadurch nicht im Internet erreichbar.** Verwenden Sie auf einem physischen Smartphone die HTTPS-Bereitstellung: `localhost` bezeichnet dort das Smartphone, nicht den PC.

```sh
pytest -q                        # Python tests and Node interoperability tests
npm test                         # Relay model, protocol/UI helpers and desktop updater
npm run test:relay               # Real Miniflare runtime; npm dependencies required
python scripts/check_project.py  # Resource consistency and syntax
python scripts/build_release.py  # Wheel, manifest, and SHA256SUMS
python tests/browser_e2e.py       # Real browser and host in temporary isolation
python tests/shared_workspace_e2e.py # Electron + browser sharing real PTYs; needs a display
python tests/terminal_render_e2e.py  # Scroll, selection and terminal geometry
python tests/installer_e2e.py        # Real wheel install and protected upgrade
python tests/client_update_e2e.py    # Browser-driven host self-update, pushed progress, refusal of a broken release
python tests/bridge_e2e.py           # Real Claude Code and Codex sessions discover and message each other through the bridge (uses your real accounts)
python tests/workspace_sync_e2e.py   # Shared open sessions between two clients, close-or-terminate choice, displayed-only mode
```

Setzen Sie `jaunt_BROWSER_EXECUTABLE=/path/to/chromium`, um einen Systembrowser zu verwenden. Andernfalls führen Sie `python -m playwright install chromium` aus. Die Tests ändern niemals die Sicherheitsrichtlinien Ihres Browsers.

## Erstbereitstellung — einmalig durch den Projekteigentümer

Übergeben Sie [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md) an einen Agenten mit GitHub-Zugriff. Er richtet GitHub Pages, ein Host-Release und **ein einziges Cloudflare-Relay für das gesamte Projekt** ein. Eine Cloudflare-Autorisierung ist erforderlich; ein GitHub-Token stellt sie nicht bereit. Endnutzer erstellen keine Infrastruktur.

jaunt leiht sich keine Relays von sshx, Happy oder Zedra. Es hängt weder von deren Servern noch von Tailscale oder einem jaunt-Benutzerkonto ab. Für das Cloudflare-Konto des Eigentümers können Kontingente oder Kosten anfallen; ein kostenloses oder unbegrenztes Relay wird nicht versprochen.

## Dokumentation

[Bereitstellung](docs/DEPLOYMENT.md) · [Sicherheit](SECURITY.md) · [Protokoll](docs/PROTOCOL.md) · [Fehlerbehebung](docs/TROUBLESHOOTING.md) · [Validierung](docs/VALIDATION.md) · [Hinweise zu Drittanbietern](../../../THIRD_PARTY_NOTICES.md)

Englisch ist die kanonische Dokumentationssprache. Übersetzungen: [Français](../fr/README.md), [Español](../es/README.md), [Italiano](../it/README.md), [Português](../pt/README.md), [Deutsch](README.md). Jeder übersetzte Dokumentationsbaum enthält die Leitfäden zu Sicherheit, Bereitstellung und Validierung.

Web, Android und Desktop wählen die Systemsprache automatisch. Überschreiben Sie sie unter **Einstellungen → Sprache**. Die CLI verwendet die Systemsprache; `jaunt --language fr --help` überschreibt sie für einen Aufruf und `jaunt language fr` speichert die Einstellung. Mit `system` stellen Sie die automatische Auswahl wieder her. Befehlsnamen, Argumente, Terminalausgaben und Nutzerinhalte werden nie übersetzt.

Die öffentliche Webadresse stellt das Projekt vor; **Arbeitsbereich öffnen** führt in den Client. Native Apps öffnen den Arbeitsbereich direkt.

## Android-App

Der Android-Client ist eine APK mit gebündelter WebView-Oberfläche und nativer Integration von Zwischenablage, Kamera, Dateien und Hintergrundbenachrichtigungen. Siehe [Android: Installation, Architektur und Validierung](docs/ANDROID.md). Die Seite bietet die APK an, sobald ihre öffentlichen Assets verifiziert wurden.

Die APK ist ein natives Android-Paket mit gebündelter WebView, keine PWA-Installation. Oberfläche und Typografie sind mit den Web- und Desktop-Apps identisch; die native Integration liefert Kamera, Zwischenablage, Dateiauswahl und Benachrichtigungen. Die Anforderungen an die Installationsbestätigung entnehmen Sie der Update-Tabelle oben.
