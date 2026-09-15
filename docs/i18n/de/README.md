[English](../../../README.md) · [fr](../fr/README.md) · [es](../es/README.md) · [it](../it/README.md) · [pt](../pt/README.md) · [de](README.md)

# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

**Ihr shells, Ihre Dateien, Ihre Maschine.

jaunt bietet native Desktop- und Android-Anwendungen, einen mobilen / Desktop-Webclient und einen POSIX-Host. Es verbindet Sie mit echten Terminals, einschließlich willkürlicher shells, Claude Code und Codex. Die statische Web-App verwendet ein gemeinsames Relais, um verschlüsselte ausgehende Verbindungen vom Host und Client zu übertragen.

**Host: 0.1.0-beta.11 · Desktop: 0.1.0-beta.10 · Android: 0.1.0-beta.8.** [Open jaunt](https://moukrea.github.io/jaunt/). Veröffentlichung und Validierung des Releases werden im Validierungsbericht nachverfolgt. Das Protokoll hat **kein unabhängiges Sicherheitsaudit erhalten**. Siehe den [letzten Validierungsbericht](docs/SEAMLESS_WORKSPACE_VALIDATION.md) für beobachtete Testergebnisse und unvalidierte Einschränkungen].

## Installieren Sie den Host

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Unterstützt Linux, macOS und WSL. Erfordert `curl`. Der Installer verwendet eine kompatible Python 3.11-3.14 Laufzeit oder installiert eine private Python Laufzeit über uv. Der Host installiert ohne Administratorprivilegien. Auf Ubuntu mit eingeschränkten Benutzernamensräumen verwendet die optionale Desktop-App das Systempaket-Installationsprogramm und fordert möglicherweise ein Administrator-Passwort zur Konfiguration seiner Sandbox an. Es überprüft die Veröffentlichung SHA-256, erstellt eine private Umgebung und startet einen Benutzerdienst, wenn verfügbar. Automatische Updates sind aktiviert. Kompatible Hosts behalten ihre shell-Prozesse während des Laufzeitwechsels bei und warten, bis die Übertragungen abgeschlossen sind.

Auf Android [installieren Sie den signierten APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.8/jaunt-android-v0.1.0-beta.8.apk), scannen Sie dann den vom Host angezeigten QR-Code. Auf einem Desktop oder in einem Browser öffnen Sie **https://moukrea.github.io/jaunt/**. Sie können auch den `jaunt1.…`-Paarungsstring einfügen. Der QR-Code läuft nach zehn Minuten ab und kann nur einmal verwendet werden. Jedes erinnerte Gerät verwendet dann seinen eigenen Schlüssel, so dass der Wechsel von Wi-Fi oder Mobilfunknetzen keine erneute Paarung erfordert. Halten Sie die Registerkarte für die automatische Wiederverbindung offen; öffnen Sie die App, wenn das mobile Betriebssystem es aussetzt oder tötet.

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

Pairing gewährt Zugriff als **Systemkonto mit dem Host**, mit allen Berechtigungen dieses Kontos. Laufen Sie nicht als root für den gewöhnlichen Gebrauch. Ein QR-Code gewährt shell-Zugriff: Veröffentlichen Sie ihn niemals.

## Merkmale

| Benehmen | Benehmen |
|---|---|
| Terminals | Echtes PTYs, interaktive Tastatur, mehrere Registerkarten, Create/rename/open/detach/terminate, Shared Sizing, mobiles Ctrl/Alt/Esc/Tab/Pfeiltasten |
| Reconnection | Gebundener Verlauf, automatische Reconnection, erinnerter Zustand; eine Browsertrennung schließt den shell nicht |
| Bestehende tmux-Sitzungen | Legacy tmux-Sitzungen bleiben unterstützt; neue Sitzungen in der Benutzeroberfläche sind gewöhnliche gemeinsame shells |
| Dateien | Durchsuchen, versteckte Dateien, Paginierung, Erstellen von Verzeichnissen, Umbenennen, nicht-rekursives Löschen, Upload/Download, Text/Bildvorschau |
| Transfers | Sichtbarer Fortschritt und beibehaltene Erfolgs- / Fehlerergebnisse; detailliertes Tracking in Dateien → Transferaktivität; 48 KiB-Brocken, Netzwerk-Wiederaufnahme-Offsets, Hochladen von SHA-256, atomare Finalisierung, Löschung |
| Bilder | Galerie, File Picker, Paste und Drag-and-Drop; PNG-Konvertierung für Browser-dekodierbare Formate; Pfadeinfügen oder bedingte native Paste |
| Zwischenablage | Auswahl, beibehaltenes Scrollback-Kopier, Host-Zwischenablage lesen / schreiben, wenn verfügbar, Headless-Textpuffer, Copy-only OSC 52 |
| Schutz | Einweg-QR-Codes, per-Geräte-Schlüssel, Widerruf, optionaler PIN/passwortgeschützter Browser-Tresor und automatische Sperrung |
| Benachrichtigungen | Optional nativer Android Service oder Browser Web Push; terminal Glocken, Programmereignisse, Sitzungsausgang, Einstellungen Test und CLI `notify`/`run` |
| Interface | Native Desktop- und Android-Apps mit gemeinsamer gebündelter Schnittstelle; Browser-Client; lokales JavaScript |

## Desktop-Client nur

So verbinden Sie sich mit anderen Hosts, ohne einen lokalen Hostdienst oder jaunt CLI zu installieren:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash -s -- --client-only'
```

Es installiert dieselbe Desktop-Anwendung und denselben Launcher mit Fernkopplung, Sitzungen, Dateien, Benachrichtigungen und automatischen App-Updates. Es startet keinen Daemon oder zeigt lokale Host-Steuerelemente an. Es deinstalliert keinen zuvor installierten Host. Führen Sie den normalen Host-Installationsbefehl aus, um später die Integration lokaler Hosts zu aktivieren.

Die installierte Browseranwendung trägt den Namen **jaunt (PWA)**, so dass sie von der nativen **jaunt**-App unterschieden werden kann. Beide verwenden das original transparente Logo. Native Android verwendet das gleiche Artwork ohne gebündelten dunklen Hintergrund; einzelne Launcher können ihre eigene Icon-Behandlung anwenden.

## Freigegebener Desktop-Arbeitsbereich

Öffnen Sie **jaunt** aus dem Anwendungsmenü des Hosts oder führen Sie `jaunt gui` aus. Host- und Remote-Clients teilen sich das gleiche gewöhnliche shells ohne tmux. **Neues shell** öffnet sofort einen automatisch benannten shell und erbt das aktuelle Verzeichnis des vorherigen aktiven shell. Die Ordnerschaltfläche ermöglicht es Ihnen, die Verzeichnisse des Hosts zu durchsuchen und optional die neuen shell zu benennen. **Sessions** listet laufende und beendete Sitzungen auf: Öffnen, umbenennen, schließen Sie nur Ihre Ansicht oder beenden Sie explizit ein shell für alle. Sie können auch einen Tab umbenennen, indem Sie auf seinen Titel doppelklicken, oder doppelklicken Sie auf den Titel eines Bereichs. Ziehen Sie Registerkarten, um sie neu zu ordnen; Auswählen eines Tabs ändert nie seine Position. Das Gerät, mit dem Sie interagieren, steuert die gemeinsame Größe von terminal.

Die beiden **Split-Symbole ** ordnen Fenster nebeneinander oder oben/unten auf dem Desktop an, indem sie eine neue oder bestehende Sitzung verwenden. Jedes Fenster kann in eine eigene Registerkarte verschoben werden. Layouts überleben das Wiedereröffnen; Mobilgeräte zeigen ihre Sitzungen als normale Registerkarten an. Die Desktop-Seitenleiste kann zusammenbrechen, wobei die Präferenz beibehalten wird. Einstellungen enthalten freundliche Hostnamen, Bestellung und den Standard-Host, Dark/Light/System/Zirkadian-Themen und Benachrichtigungssteuerungen. Hosteinstellungen folgen sofort dem ausgewählten Computer, einschließlich der Identitäts- und Aktualisierungssteuerungen. Die native Desktop-App verwaltet auch den lokalen Hostdienst und paart sich mit anderen Hosts; lokale Servicesteuerungen erscheinen nur für den lokalen Host, während Desktop-Anwendungsupdates getrennt bleiben. Siehe die [Arbeitsplatzführung](docs/WORKSPACE.md) und [Validierungsbericht](docs/WORKSPACE_VALIDATION.md)].

## Bildverarbeitung

Der Fortschritt bleibt während des Uploads und der Zwischenablage/Pfadzustellung sichtbar. Abgeschlossene Vorgänge fallen in ein kompaktes Ergebnis zusammen; **Die Historie behält die Details bei. Das Abbrechen einer Übertragung wird als Stornierung angezeigt und Fehler bleiben bei ihrer Operation. Das Endergebnis gibt genau an, was passiert ist; Fehler bleiben bei einer Wiederholungsaktion sichtbar. Eine erfolgreiche Pfadeinfügung oder Ctrl+V-Zustellung beweist nicht, dass Claude Code oder Codex einen Anhang erkannt haben.

**Einfügen:** Wenn ein natives Backend verfügbar ist, wird ein Bild in die Host-Zwischenablage hochgeladen und in die ausgewählte Sitzung mit Ctrl+V eingefügt. Wenn der Browser eine leere Zwischenablage zurückgibt, bietet die Benutzeroberfläche einen reichhaltigen Einfügenbereich und eine Bildauswahl. Attach behält beide expliziten Modi bei. Es wird kein Enter-Schlüssel gesendet.

**Rückfall mit aktiver Verbindung: ** Wählen oder Einfügen eines Bildes, laden Sie es auf den Host hoch und fügen Sie den ordnungsgemäß entwichenen Pfad in den terminal ein. Nichts sendet den Befehl automatisch. Claude, Codex oder ein anderes Tool können die Datei lesen, wenn der eigene Modus sie unterstützt.

**Bedingte native Paste:** Wenn der Host eine zugängliche grafische Zwischenablage hat (macOS, Wayland mit `wl-clipboard` oder X11 mit `xclip`), legt jaunt den PNG dorthin und sendet Ctrl+V an den terminal. Dies hängt auch von der Verknüpfung und dem Verhalten des CLI-Tools ab. ** Auf einem Headless-Host kann jaunt keinen nativen Claude/Codex-Anhang herstellen: Es fällt auf eine Datei und ihren Pfad zurück.** HEIC und andere Formate, die der Browser nicht dekodieren kann, können immer noch als Dateien übertragen werden, werden aber nicht in PNG konvertiert.

## Automatische Updates

| Komponente | Aktualisieren des Verhaltens |
|---|---|
| Host / CLI | Gleiche Installation. Prüft den veröffentlichten Kanal alle 15 Minuten, überprüft Downloads und ersetzt kompatible Laufzeiten, ohne shell-Prozesse zu beenden. Übertragungen werden zuerst beendet. Einstellungen oder `jaunt update` prüft sofort. Ältere Hosts ohne Laufzeit-Handoff-Verzögerung, während normale shells aktiv sind; die Beendigung dieser shells erfordert immer noch eine explizite Bestätigung. |
| Desktop-App | Separate Version vom Host. Automatisch überprüft, lädt und überprüft ein Update; installiert, wenn Sie die App schließen. Einstellungen bietet eine manuelle Überprüfung, ein automatisches Update umschalten und **Installieren und erneut öffnen **. Die Aktualisierung der GUI stoppt den Host oder seine shells. Systempakete können die OS-Autorisierung anfordern. |
| Android APK | Prüft automatisch nach einem neuen APK. Ein sichtbarer Check/Download-Dialog führt zur Installationsbestätigung von Android. Prüfsumme und Signaturzertifikat des APK werden überprüft; Android erlaubt keine stille Selbstinstallation. |
| Webclient | Verwendet die auf Pages veröffentlichte Version. Wieder öffnen/neu laden, um ein heruntergeladenes Service-Worker-Update zu aktivieren. |

Bestehende Installationen benötigen die Version, die ihren Updater enthält, bevor dieser Updater ausgeführt werden kann. shells. Pairing-Tasten bleiben erhalten.](docs/UPDATES.md).

## Anschluss- und Betriebsrückmeldung

Eine Netzwerkunterbrechung hat ein persistentes Verbindungsbanner mit einer Wiederholungsaktion. jaunt verbindet sich wieder mit dem gespeicherten Geräteschlüssel; es wiederholt nicht gesendete terminal-Eingaben. Widerruf und fehlgeschlagene Host-Verifizierung stoppen die Verbindung und erklären den nächsten Schritt. Fehler in einem Dialog bleiben in diesem Dialog; andere Aktionsfehler bleiben sichtbar, bis sie abgewiesen werden. Kurze Bestätigungstoasts werden dedupliziert und auf zwei beschränkt.

Uploads, Downloads, Service-Installation und Update-Checks zeigen den Fortschritt und ein Endergebnis in Aktivität. Netzwerkpausen sind explizit, Transfer-Stornierung ist verfügbar und abgeschlossene Historie kann erweitert werden. Verfügbare Updates bieten eine direkte Aktion anstelle eines auslaufenden Toasts.

## Meldungen

Aktivieren Sie Benachrichtigungen in **Einstellungen ** und verwenden Sie die Testaktion. Programmbenachrichtigungstitel und -text bleiben erhalten, wenn sie geliefert werden; eine einfache terminal-Glocke hat keinen Nachrichtenkörper zum Wiederherstellen. Durch Klicken auf eine Benachrichtigung wird der entsprechende Host und die entsprechende Sitzung ausgewählt. Desktopbenachrichtigungen erfordern, dass die App ausgeführt wird; Android verwendet seinen optionalen Vordergrundverbindungsdienst; der Webclient verwendet den Browser Web Push. Benachrichtigungsinhalte können gemäß den Betriebssystemeinstellungen auf dem Sperrbildschirm erscheinen.

## Bekannte Einschränkungen

- Bis zu 16 aktive shells, 32 beibehaltene Ansichten, 2 MiB von Rohwiedergabe pro PTY und 10.000 xterm-Scrollback-Zeilen. Copy-all deckt die gespeicherte Historie ab, nicht ein unbegrenztes Protokoll.
- Host-Dateilimit: 512 MiB. In-Memory-Downloads sind auf 128 MiB in Browsern ohne direktes Dateischreiben beschränkt; Previews sind auf 16 MiB begrenzt. Bis zu acht gleichzeitige Uploads und 1 GiB von deklarierter Gesamtgröße.
- Uploads werden nach Netzwerkunterbrechungen fortgesetzt, während der Host und die Seite die Übertragung beibehalten. Starten Sie den Upload nach einem Neustart des Hosts oder einem Neuladen der gesamten Seite neu; jaunt erhält keinen unbefugten dauerhaften Zugriff auf die lokalen Dateien des Telefons.
- Gewöhnliche shells überleben die Trennung und kompatible Laufzeit-Updates, **nicht ein expliziter Daemon-Stopp / Neustart oder Maschinen-Neustart **. tmux kann einen Daemon-Neustart überleben, aber keinen OS-Neustart.
- Es kann sein, dass nur eine jaunt-Anwendungsregisterkarte pro Browserprofil gleichzeitig den Tresor besitzt. Mehrere terminal-Registerkarten innerhalb von jaunt und mehrere Geräte werden unterstützt.
- Browser-Benachrichtigungen erfordern Erlaubnis und Web-Push-Unterstützung. In der APK aktivieren Sie Android Hintergrundbenachrichtigungen in den Einstellungen; Android Batteriebeschränkungen können die Lieferung verzögern. Auf iOS verwenden Sie die installierte PWA. Die Lieferung hängt vom Netzwerk und Push-Provider ab; es ist nicht in Echtzeit garantiert.
- Ein schlafender oder ausgeschalteter Host ist nicht erreichbar. Es gibt keine Fernaufweckung, keinen beliebigen TCP-Tunnel, keinen grafischen Desktop oder keine native Windows shell-Unterstützung.
- Linux-Desktoppakete sind für x64 und ARM64 verfügbar; macOS-Archive sind unsigniert und unnotarisiert. Es wird kein natives Windows-Desktoppaket bereitgestellt. Physisches Android-Telefonverhalten und geschützte macOS-Updater-Autorisierung wurden nicht validiert; Emulatorergebnisse werden separat dokumentiert.
- Produktionsrelaiskosten, -kontingente und -verfügbarkeit hängen vom Cloudflare-Konto ab. Grundlegende Relaissicherungen sind kein garantierter kommerzieller Missbrauchsschutz.

## Lokale Entwicklung

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm ci
npm run prepare-web
python scripts/dev.py
```

Der Läufer hört nur auf `127.0.0.1`, startet einen Host und ein lokales Relais und zeigt einen Test-QR-Code an. ** Dadurch wird der Host nicht dem Internet ausgesetzt. ** Verwenden Sie die HTTPS-Bereitstellung auf einem physischen Telefon: `localhost` bezieht sich auf das Telefon, nicht auf den PC.

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
```

Stellen Sie `jaunt_BROWSER_EXECUTABLE=/path/to/chromium` so ein, dass Sie einen Systembrowser verwenden. Andernfalls führen Sie `python -m playwright install chromium` aus. Tests ändern niemals die Sicherheitsrichtlinien Ihres Browsers.

## Erstbereitstellung — einmalig durch den Projekteigentümer

Geben Sie [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md)] an einen Agenten mit GitHub-Zugriff. Er konfiguriert GitHub-Seiten, eine Host-Version und ein Cloudflare-Relay für das gesamte Projekt. Cloudflare-Autorisierung ist erforderlich; ein GitHub-Token stellt es nicht bereit. Endbenutzer erstellen keine Infrastruktur.

jaunt leiht keine Relais von sshx, Happy oder Zedra. Es hängt nicht von ihren Servern, Tailscale oder einem jaunt-Benutzerkonto ab. Das Cloudflare-Konto des Besitzers kann Quoten oder Kosten verursachen; es wird kein kostenloses oder unbegrenztes Relais versprochen.

## Dokumentation

[Deployment](docs/DEPLOYMENT.md) · [Security](SECURITY.md) · [Protocol](docs/PROTOCOL.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Validation](docs/VALIDATION.md) · [Mitteilungen Dritter](../../../THIRD_PARTY_NOTICES.md)]]

Englisch ist die kanonische Dokumentationssprache.](../fr/README.md), [Español]](../es/README.md), [Italiano]](../it/README.md)[Português]](../pt/README.md), [Deutsch]](README.md)Jeder übersetzte Baum enthält die Sicherheits-, Bereitstellungs- und Validierungsleitfäden.

Web, Android und Desktop wählen die Systemsprache automatisch aus. Überschreiben Sie sie in **Settings → Language**. Das CLI verwendet das Systemlocal; `jaunt --language fr --help` überschreibt eine Invocation und `jaunt language fr` speichert die Präferenz. Verwenden Sie `system`, um die automatische Auswahl wiederherzustellen. Befehlsnamen, Argumente, terminal-Ausgabe und Benutzerinhalte werden nie übersetzt.

Die öffentliche Webadresse stellt das Projekt vor; **Open Workspace** tritt in den Client ein. Native Apps öffnen den Workspace direkt.

## Android App

Der Android-Client ist ein APK mit einer gebündelten WebView-Schnittstelle und nativen Clipboard-, Kamera-, Datei- und Hintergrundbenachrichtigungsintegrationen. siehe [Android Installation, Architektur und Validierung](docs/ANDROID.md). Die Seite wirbt für das APK, nachdem seine öffentlichen Assets verifiziert wurden].

Das APK ist ein natives Android-Paket mit einem gebündelten WebView, keine PWA-Installation. Die Schnittstelle und Typografie werden mit den Web- und Desktop-Apps geteilt; die native Integration liefert Kamera, Zwischenablage, Dateiauswahl und Benachrichtigungen. Siehe die Aktualisierungstabelle oben für die Installationsbestätigungsanforderungen.
