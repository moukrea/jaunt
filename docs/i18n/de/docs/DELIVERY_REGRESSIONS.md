[English](../../../DELIVERY_REGRESSIONS.md) · [fr](../../fr/docs/DELIVERY_REGRESSIONS.md) · [es](../../es/docs/DELIVERY_REGRESSIONS.md) · [it](../../it/docs/DELIVERY_REGRESSIONS.md) · [pt](../../pt/docs/DELIVERY_REGRESSIONS.md) · [de](DELIVERY_REGRESSIONS.md)

# Delivery Regression Fixes — 15. September 2026

Dieser Bericht folgt von Benutzern gemeldeten Fehlern nach der vorherigen Veröffentlichung. Vorherige bestandene Tests haben keinen korrekten Benutzer-shell-Start, benutzbares Touch-Scrollen oder den Standard-Ubuntu-Archiv-Startpfad erstellt.

## Reproduzierte Ursachen und Veränderungen

- Bash-Anmeldeprofile können `.bashrc` weglassen. Das vom Dienst gestartete shell verpasste daher interaktive PATH-Ergänzungen und prompte Farben. Neue Sitzungen laden die Anmeldeumgebung und dann die interaktive Bash-Konfiguration; fehlende SHELL verwendet das Konto shell.
- Unbeaufsichtigte Host-Updates überspringen GUI-Installations- und Systemautorisierungsaufforderungen. Interaktive grafische Installation und explizite `jaunt gui` installieren immer noch die Desktop-App.
- Das veröffentlichte Desktop-Archiv bricht unter Ubuntu 24.04 eingeschränkte Benutzernamensräume mit einem Sandbox-Helfer-Fehler ab. Der Installer wählt nun dort das verifizierte Systempaket aus, so dass seine AppArmor-Unterstützung installiert werden kann, ohne Chromium-Sandboxing zu deaktivieren.
- Das native Logo extraResource hat seine Quelle von den verpackten Web-Assets ausgeschlossen und das In-App-Logo gebrochen. Die native Ressource verwendet jetzt ein generiertes Desktop-Symbol, wobei das Original in Web-Assets beibehalten wird.
- Linux-Symbol-Verpackung verwendete ein nicht indexiertes 547×547-Themenverzeichnis. Es enthält jetzt acht Standardgrößen, die vom Original-Kunstwerk abgeleitet sind. Build-Hooks und explizite Icon-Berechtigungen entfernen umask-abhängige unlesbare Launcher-Dateien.
- UI-Piktogramme stammen jetzt von Lucide 1.46.0, gebündelt lokal mit seiner ISC-Lizenz. Android verwendet einen adaptiven Launcher-Wrapper um das mitgelieferte Kunstwerk.
- Die Benutzeroberfläche für neue Sitzungen bietet keine tmux mehr. Bestehende tmux-Sitzungen und die Hostkompatibilität bleiben intakt.
- Android Touch Swipes hat den virtuellen Viewport von xterm nicht gescrollt. Ein Touch-Handler sorgt für Scrollen und Momentum; die Größe der Tastatur behält den Leseanker bei, anstatt in die erste oder letzte Reihe zu springen.
- Der Programmbenachrichtigungstext wurde verworfen. OSC 9-Nachrichten und OSC 777-Titel/Body erreichen nun native Benachrichtigungen. Benachrichtigungsziele bleiben bis zur Verfügbarkeit ihres Hosts/Session anhängig. Es wird kein terminal-Ausgang verschrottet.
- Die Split-Ansicht befindet sich in der Desktop-Tab-Leiste, mit direkter Erstellung neben/unten, bestehenden Session-Splits, persistiertem Layout und mobilem Tab-Fallback.

## Beobachtete lokale Validierung

- `npm install` / `npm audit`: gepinnte Abhängigkeiten und echte Lockfile; Null bekannte Sicherheitslücken zum Zeitpunkt dieses Laufs. Node 25.5.0, npm 11.8.0, Electron 44.3.0, Elektronen-Builder 26.15.3.
- `.venv/bin/python -m pytest -q`: 63 hat Python 3.14.2 bestanden, einschließlich echter PTY Login-PATH / Color-Prompt-Regression und chunked Benachrichtigungs-Content-Tests.
- `node --test tests/js.test.mjs tests/relay.test.mjs`: 21 bestanden.
- `npm run test:relay`: 2 echte Miniflare/Workerd Routing Tests bestanden.
- `npm run prepare-web` und `.venv/bin/python scripts/check_project.py`: bestanden; lokale jsQR, xterm, Lucide und Lizenzen.
- `.venv/bin/python scripts/build_release.py`: ein nicht editierbares 0.1.0b9-Rad gebaut.
- `.venv/bin/python tests/browser_e2e.py`, auch mit `jaunt_E2E_RELAY=workerd`: 23 Szenarien pro Backend übergeben.
- `.venv/bin/python tests/terminal_render_e2e.py`: Scrollen, Keyboard-Höhe Leseanker, Auswahl und Themen übergeben, plus tatsächliche isolierte Claude Code und Codex Startup.
- `DISPLAY=:179 .venv/bin/python tests/shared_workspace_e2e.py`: gemeinsam genutztes lokales/ferngesteuertes PTY, Geometriebesitz, Ablösung/Termination und mobiles Pane-Fallback übergeben.
- Unterzeichnet Android Release-/Debug-Builds, Flusen- und Unit-Aufgaben übergeben. `tests/android_workspace_e2e.py` am Android 14/API 34 Emulator übergeben real touch swipe, tatsächliche Tastatur-Anker, System-Einsätze, Rotation, screen-off OSC-Titel/Body und tippen Sie die Benachrichtigung in die richtige Sitzung.

Installiertes Kandidaten-`.deb` plus nicht editierbares 0.1.0b9-Rad, das am Ubuntu 24.04 übergeben wurde: echte PTY-Ausführung, Seccomp=2/NoNewPrivs=1 Renderer, dekodierte In-App-Logos, lokal verfügbare Lucide und lesbare Standard-Launcher-Symbole. Der Kandidaten-Desktop wurde ebenfalls über das öffentliche Relais authentifiziert und erwies sich als Remote-Befehl. `scripts/check_desktop_package.mjs` überprüft nun diese verpackten Ressourcenpfade und Linux Metadaten in CI.

Beim Scannen des binären ASAR wurden zwei falsch positive Werte in den angebotenen JavaScript-Identifikatoren (`FourKeyMap` und `SequencerByKey`) überprüft.

## Veröffentlichte Lieferung

PR [20](https://github.com/moukrea/jaunt/pull/20) fusioniert als `cb0cb99910978e0874cf00235a046f47ff297d72` nach allen Prüfungen bestanden. Backup `backup/pre-delivery-fixes-20260915` behält den vorherigen Zustand bei. Es wurde keine Force-Push- oder History-Löschung verwendet.]

- Öffentliche Seite: https://moukrea.github.io/jaunt/
- Host: [v0.1.0-beta.9](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.9), genau drei Assets. Alle Prüfsummen, Archivpfade und alle 16 Python/Installer-Quelldateien wurden mit der gelieferten Quelle verglichen.
- Desktop: [desktop-v0.1.0-beta.7](https://github.com/moukrea/jaunt/releases/tag/desktop-v0.1.0-beta.7), zehn Linux/macOS-Pakete plus SHA256SUMS. Alle zehn Downloads stimmten mit den Prüfsummen überein. Installiertes öffentliches Ubuntu-Paket: echte lokale und entfernte shell-Ausführung, gemeinsame Browser/Desktop-Sitzung, Terminierung von beiden Seiten, dekodiertes Logo, lesbare Standardsymbole und sandboxed Renderer.]
- Android: [android-v0.1.0-beta.5](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.5), versionCode 5. Die 27 gebündelten Webressourcen des öffentlichen APK stimmten mit der Quelle überein; der Host-Installer wird absichtlich durch den Android Build ausgeschlossen. Seine Prüfsumme und vorhandenes Signaturzertifikat wurden verifiziert. Die Installation über dem öffentlichen Beta.4 APK behielt die Paarung bei und wurde wieder verbunden. Die native UI-Automatisierung auf dem Release APK erstellte dann ein shell, bewies ein Befehlsergebnis auf dem Host und beendete die Sitzung. Es wurde kein debuggabler Release Build verwendet.

Der genaue Befehl, der von der öffentlichen Seite extrahiert wurde, wurde in einem neuen Fedora 43-Container und einem neuen Konto in der Ubuntu 24.04 VM übergeben:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Die interaktive grafische Ubuntu-Installation wählte automatisch das öffentliche System-Desktop-Paket aus. Der Host-Service wurde aktiviert, ausgeführt und verbunden; ein gültiges QR SVG wurde generiert, ohne sein Geheimnis zu drucken oder zu veröffentlichen. Unbeaufsichtigte Host-Updates überspringen die GUI-Einrichtung, so dass sie keine Desktop-Autorisierungsaufforderungen auslösen können.

Die öffentliche Seite → Cloudflare → öffentliche Radakzeptanz bestanden 12 Prüfungen: Paarung, genaue 512-Zeichen-Eingabe, mehrere shells, Datei-Byte-Vergleich, Bild/Pfad/no-Enter Fallback, Reload, echte VM IPv4/IPv6-Netzwerkunterbrechung mit derselben Sitzung/PIDWeigerung, aktiv zu zerstören shells, ausdrücklich autorisierter Neustart mit beibehaltenen Identitäten und Widerruf. siehe [die beobachteten Ergebnisse]](../../../evidence/public-report-beta9.json).

Dieser Maintainer-PC wurde auch durch den öffentlichen Installateur aktualisiert, um 0.1.0b9 mit seinen vorhandenen Host-/Geräteschlüsseln zu hosten. Ein temporärer Dienst-erstellter shell fand und lief `codex-cli 0.154.0` durch PATH und erzeugte eine farbige Eingabeaufforderung; nur diese temporäre Sitzung wurde beendet. Der öffentliche Desktop-Beta.7 wurde installiert und blieb auf Ubuntu laufen.

CI-Beweis: [PR-Prüfungen]](https://github.com/moukrea/jaunt/actions/runs/34960446113), [Desktoppakete]](https://github.com/moukrea/jaunt/actions/runs/34960446067), [Android](https://github.com/moukrea/jaunt/actions/runs/34960446100)Veröffentlichung: [Gastgeber]](https://github.com/moukrea/jaunt/actions/runs/34960988005), [Desktop]](https://github.com/moukrea/jaunt/actions/runs/34961170116), [Android](https://github.com/moukrea/jaunt/actions/runs/34961169894), [Seiten]](https://github.com/moukrea/jaunt/actions/runs/34961981670)Die 28 geprüften Ressourcen der öffentlichen Seite stimmten mit den gelieferten Dateien unter `/jaunt/`. Der Zustand des vorhandenen Relais und real authentifiziert WebSockets Es wurde keine Relay-URL oder ein Relay von Drittanbietern erfunden.

![Öffentliches Desktop-Paket mit dem mitgelieferten Logo und Lucide Interface-Icons](../../../evidence/desktop-release-beta7.png)]

## Verbleibende Grenzwerte

Physische Android-Hardware, herstellerspezifische Tastaturen/Batterierichtlinien, echtes Wi-Fi/Mobile Switching, macOS-Laufzeit und ARM-Laufzeit werden durch diese Tests nicht validiert. Android-Emulatortests werden als solche identifiziert. Authentifizierte Claude Code/Codex-Konversationen werden nicht durch isolierte Starttests abgedeckt. **Das Protokoll bleibt unabhängig voneinander ungeprüft. **
