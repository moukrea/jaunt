[English](../../../INSTALLER_FEDORA.md) · [fr](../../fr/docs/INSTALLER_FEDORA.md) · [es](../../es/docs/INSTALLER_FEDORA.md) · [it](../../it/docs/INSTALLER_FEDORA.md) · [pt](../../pt/docs/INSTALLER_FEDORA.md) · [de](INSTALLER_FEDORA.md)

# Installateurkorrekturen — 15. September 2026

Der ursprüngliche Benutzerbericht betraf Fedora: Der Befehl erzeugte keine Ausgabe und die ausführbare Datei blieb auf Beta.2. Es gab keinen Fernzugriff auf diesen Computer. Die anfänglichen Bootstrap-Korrekturen stellten die Ursache auf dem Computer des Benutzers nicht fest. Ein späterer Bericht lieferte `curl (23) Failed writing body` während des `config.json`-Downloads.

## Reproduzierte Mängel und Korrekturen

- Der alte `curl -fsSL … | bash`-Befehl gibt 0 zurück, wenn Curl fehlschlägt und Bash leere Eingaben erhält. Der offizielle Befehl verwendet jetzt Bash mit `pipefail`, sichtbarem Fortschritt, einem 10-Sekunden-Verbindungs-Timeout und einem 120-Sekunden-Limit für den ersten Skript-Download.
- Eine `.curlrc`-Ausgabedateieinstellung kann das Skript absorbieren, so dass nichts läuft. Dies wurde mit echtem Curl und einem lokalen HTTP-Server reproduziert. Der führende `-q` ignoriert diese Konfiguration im offiziellen Befehl; interne Downloads verwenden `--disable`.
- Unerwartete Fehler identifizieren Bühne, Zeile und Exit-Code, ohne Geheimnisse oder vollständige Befehle zu drucken.
- Interne HTTPS-Downloads werden auf 120 Sekunden pro Versuch begrenzt. Ausgewählte Verbindungs-/Übertragungsfehler lösen eine sichtbare IPv4-Wiederholung aus; HTTP und Zertifikatsfehler werden nicht umgangen. Weiterleitungen bleiben auf HTTPS beschränkt.
- Ein Curl-Prozess mit einem separaten Dateisystem-Namespace kann den von Bash erstellten temporären Verzeichnispfad nicht öffnen. Eine echte Fedora-Container-Curl, die den Ausgang 23 bei `Downloading config.json` vor jeder Installationsmutation wiedergegeben hat. Downloads verwenden jetzt die shell-Ausgabeumleitung: Bash öffnet das Ziel und curl schreibt durch geerbten Stdout. Dies funktioniert auch dann, wenn curl den Zielpfad nicht sehen kann. Es umgeht nicht die Speichererschöpfung oder Schreibverweigerung auf das Zieldateisystem.
- Active-shell-Wächter, Radverifizierung und Identitätserhaltung bleiben bestehen.

Die Curl-Dokumentation definiert [Exit 23 als lokalen Schreibfehler](https://curl.se/libcurl/c/libcurl-errors.html). Dieser Code allein identifiziert nicht die genaue Ursache auf dem Computer des Benutzers; die Filesystemisolation ist der hier angesprochene reproduzierte Fall.]

## Beobachtungen

- `pytest -q tests/test_installer_bootstrap.py`: vier Fehler gegen die vorherigen Bootstrap-Dateien, dann vier Durchläufe nach der ersten Korrektur, die Netzwerkfehler, HTTP-Fehler, Pipeline-Ausgangsstatus und `.curlrc`-Ausgangsumleitung abdecken.
- `pytest -q`: 49 Tests wurden lokal mit Python 3.14.2 nach der ersten Korrektur bestanden.
- `python scripts/build_release.py`, `npm run prepare-web`, `python scripts/check_project.py`: bestanden.
- `python tests/installer_e2e.py`: acht Prüfungen bestanden, einschließlich manipulierter Prüfsummen, die sich weigern, ein echtes aktives shell zu töten, und ausdrücklich einen Neustart autorisiert haben.
- Fedora 44, frischer offizieller Container, vorheriges öffentliches Skript durch `curl … | bash`: Beta.5-Installation erfolgreich. Fedora allein hat das Problem des Benutzers nicht reproduziert.
- Fedora 44, frischer offizieller Container, korrigiertes Skript in Bash: installiert das echte öffentliche Beta.5-Rad, mit privatem Python 3.12.14, installiert von uv; Ausgang 0 und Version 0.1.0b5.
- Fedora 43, frischer offizieller Container: vorheriger Installateur und öffentliches Beta.2-Rad, gefolgt von korrigiertem Installateur und öffentlichem Beta.5-Rad; Versionen vorher/nachher überprüft; Identität und Gerätetabelle beibehalten.
- Der erste korrigierte Befehl wurde von der veröffentlichten Seite abgerufen und in einem neuen Fedora 43-Container nach [Seitenbereitstellung](https://github.com/moukrea/jaunt/actions/runs/34931947575)] ausgeführt. Öffentliche Installationsbytes stimmten mit der überprüften Quelle überein und Version 0.1.0b5 wurde verifiziert.
- `python tests/installer_namespace_e2e.py`: reale öffentliche Radinstallation mit Curl in einem Fedora 44 Container und Bash/Python außerhalb davon. Es werden keine Host-Verzeichnisse in den Curl Container eingefügt. Vor dem Output-Redirection Fix ist der Config Download mit dem Exit 23 fehlgeschlagen. Nach dem Fix wurde das Rad von der öffentlichen Version installiert, aus der privaten Laufzeit importiert und der Daemon mit aktivierten automatischen Updates gestartet.
- Erforderliche CI enthält echte Fedora 43/44-Installationen. Der Fedora 44-Job führt zusätzlich die separate Dateisystem-Curl-Installationsregression aus.

Fedora-Tests verwenden isolierte Container ohne Benutzerdienstmanager (`jaunt_NO_SERVICE=1`) und unterdrücken QR-Ausgaben (`jaunt_SKIP_PAIR=1`). Sie validieren Installation und Hintergrundstart, nicht systemd/SELinux auf einer physischen Fedora-Arbeitsstation. Der Benutzerdienst wurde zuvor auf Ubuntu validiert; es wird keine neue physische Fedora-Validierung beansprucht.

Diese Korrekturen gelten für den Pages-Einstiegspunkt und die Installer-Quelle. Veröffentlichte Beta.5-Assets und APK Beta.3 bleiben unveränderlich. Der Host benötigt keine neue Versionsnummer, um das aktualisierte Pages-Installationsprogramm zu verwenden. Der im Beta.5-Rad eingebettete Installer behält seinen vorherigen Code bis zu einer zukünftigen Host-Version.

Das Protokoll bleibt ohne ein unabhängiges Sicherheitsaudit.

## Follow-up: persistenter Exit 23 nach shell-Umleitung

Anschließend meldete der Benutzer den gleichen Schreibfehler in Zeile 65. Die Namespace-Regression war verstrichen, aber sie hatte den Fehler des entfernten Benutzers nicht behoben.

Ein separater Fedora 44-Test mit Python 3.14.7 und einem komplett vollen 4 KiB `/tmp` tmpfs hat den genauen `curl: Failed writing body`-Fehler und den Line-65-Fehler wiedergegeben. Dort konnte noch ein Verzeichnis und eine leere Datei erstellt werden, aber das Schreiben der Antwort ist fehlgeschlagen. Dieser Test verwendet nur einen Einweg-Docker-Container; er füllt keinen Host oder persönliches Dateisystem.

Der Installer schaltet sich nun neben der Laufzeit auf das Zieldateisystem ein, prüft, ob er 1 MiB dort schreiben kann, und liefert dieses private temporäre Verzeichnis während der Installation an pip/uv. Es ändert nicht die TMPDIR der Host-Daemon- oder shell-Sitzungen. Das Staging-Verzeichnis wird beim Verlassen entfernt. Ein vollständiges Zieldateisystem erzeugt immer noch einen eindeutigen Speicherfehler; der Installer löscht keine Benutzerdateien, um Platz zu schaffen.

Wenn curl 23 zurückgibt und Python verfügbar ist, ruft ein Standardbibliotheks-HTTPS-Downloader die Datei unabhängig ab. Er verwendet eine normale Zertifikatsvalidierung, lehnt Nicht-HTTPS-Weiterleitungen ab, begrenzt die gesamte Übertragung auf 120 Sekunden und 128 MiB, erkennt unvollständige Körper und spült/fsyncs das Ergebnis. Die Überprüfung der Radprüfsumme erfolgt immer noch vor dem Ersetzen der Laufzeit. Dieser Fallback behandelt keine willkürlichen TLS/HTTP-Ausfälle, indem er die Validierung abschwächt.

Validierungsbefehle für dieses Follow-up:

- `pytest -q`: 53 Tests vor Ort bestanden. Vier neue Prüfungen üben die HTTPS-Fallbacks des Python aus und leiten Grenzen um.
- `python tests/installer_storage_e2e.py`: echte Fedora-Installationen mit einem vollständigen `/tmp` und mit jedem internen Curl-Download, der gezwungen ist, in `/dev/full` zu schreiben. Das zweite Szenario übt den tatsächlichen Curl-Exit 23 aus, gefolgt von echten öffentlichen HTTPS-Downloads über Python. Beide Szenarien überprüfen den laufenden Daemon, die Staging-Bereinigung und das Fehlen eines gelöschten Staging-Pfades in der Daemon-Umgebung.
- `python tests/installer_e2e.py`: Alle acht vorhandenen Prüfungen wurden bestanden, einschließlich der Aktiv-shell-Erhaltung, der Ablehnung von Prüfsummen und der expliziten Neustartberechtigung.
- `python scripts/build_release.py`, `npm run prepare-web` und `python scripts/check_project.py`: bestanden.

Der erforderliche Fedora CI-Job führt neben dem früheren Namespace-Test beide neuen Installationsszenarien aus: Es handelt sich um Beobachtungen in der Testumgebung, nicht um einen Anspruch auf eine erfolgreiche Ausführung auf der unzugänglichen Fedora-Maschine des Benutzers.
