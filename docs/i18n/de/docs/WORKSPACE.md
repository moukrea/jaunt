[English](../../../WORKSPACE.md) · [fr](../../fr/docs/WORKSPACE.md) · [es](../../es/docs/WORKSPACE.md) · [it](../../it/docs/WORKSPACE.md) · [pt](../../pt/docs/WORKSPACE.md) · [de](WORKSPACE.md)

# Freigegebener terminal-Arbeitsbereich

Jede shell gehört dem Host-Daemon, nicht dem Fenster, das sie erstellt hat. Die Desktop-App, die Android-App und autorisierte Browser können gleichzeitig an dieselbe gewöhnliche PTY anhängen. tmux ist optional. Bestehende Terminals, die außerhalb von jaunt erstellt wurden, werden nicht rückwirkend übernommen; erstellen Sie eine jaunt shell oder fügen Sie explizit eine bestehende tmux-Sitzung an.

## Sitzungen und Ansichten

**Neues shell** erstellt sofort ein terminal mit einem automatischen Namen, z. B. `bash 1`. Sein Verzeichnis folgt dem zuvor aktiven shell, einschließlich `cd`-Änderungen auf unterstützten Hosts. Das Ordnersymbol öffnet **Neues shell im Ordner** mit Verzeichnisbrowsing und einem optionalen Namen. Wenn das Betriebssystem das aktuelle Verzeichnis eines shell nicht lesen kann, verwendet der Host das ursprüngliche Verzeichnis von shell.

Verwenden Sie **Sessions** neben den Registerkarten, um jede beibehaltene Sitzung auf dem ausgewählten Host anzuzeigen, einschließlich Sitzungen ohne offene Ansicht. Die Liste zeigt an, ob jede shell ausgeführt wird und welche Geräte sie geöffnet haben.

- **Rename** ändert den gemeinsamen Sitzungsnamen. Doppelklicken Sie auf einen Tab-Namen oder Doppelklicken Sie auf einen Fenstertitel, um ihn ebenfalls umzubenennen.
- **Open** verbindet dieses Gerät mit dem bestehenden shell und seiner beibehaltenen Historie.
- Die **x**- oder **Close-Ansicht des Tabs löst nur diese Ansicht. Der shell und andere Clients bleiben verbunden.
- **Terminate** bittet um Bestätigung, beendet dann das shell und seine Jobs für alle Zuschauer. Für tmux tötet es explizit diese tmux-Sitzung, einschließlich Anhängen außerhalb von jaunt.

Die normale Beendigung umfasst Prozesse in der shell-POSIX-Sitzung terminal, einschließlich Hintergrund-Auftragssteuerungsgruppen. Ein Prozess, der absichtlich in eine separate Betriebssystemsitzung daemonisiert wurde, befindet sich außerhalb dieser Grenze.

Beendete shells behalten ihren Wartestatus, bis die Sitzung entfernt wird, und behalten den Leader PID, so dass überlebende Hintergrundjobs weiterhin sicher beendet werden können.

Das Schließen der App, der Verlust einer Netzwerkverbindung oder das Sperren des Tresors beendet shells nicht. Kompatible Host-Updates behalten gewöhnliche shell-Prozesse und deren Verlauf durch einen lokalen Laufzeitersatz bei. Ein expliziter Daemon-Stopp / Neustart oder Neustart beendet sie immer noch. Legacy-Hosts ohne Übergabe-Aufschub-Updates, während gewöhnliche shells aktiv sind, es sei denn, der Neustart ist ausdrücklich autorisiert. tmux bleibt verfügbar, wenn eine neustartunabhängige Persistenz erforderlich ist.

Tabs behalten ihre Reihenfolge bei, wenn sie ausgewählt werden. Ziehen Sie sie zur Neubestellung; auf einer Tastatur verwenden Sie Alt+Shift+Links/Rechts. Doppelklick-Umnamen; Halten eines Tabs öffnet keinen Umnamen. Desktop-Split-Gruppen und mobile Tab-Reihenfolge werden über Reverbindungen beibehalten. Die Desktop-Seitenleiste kann zusammenbrechen, und ihre Präferenz wird gespeichert.

## Gemeinsame Dimensionen und Scrollen

Jede Sitzung hat eine PTY-Größe. Durch Klicken/Berühren oder Tippen in eine Ansicht wird die Größe des Geräts kontrolliert. Die Größe eines passiven Fensters stiehlt nicht die Kontrolle. Passive Ansichten behalten die gemeinsame Geometrie bei und können horizontal oder vertikal scrollen, wenn das terminal des anderen Geräts größer ist. Klicken Sie nach innen, um es an Ihren Bildschirm anzupassen.

Das gemessene innere Element des terminal hat keine Polsterung; umgebende UI-Ränder sind von der Zeilen-/Spaltenzahl ausgeschlossen. Die Fußzeile, Aktionstasten, Android-Balken und die Tastatur reservieren ihren eigenen Speicherplatz. Die **↓ Latest**-Taste kehrt zur letzten Ausgabe zurück; das Scrollen nach oben bleibt möglich, während die Ausgabe fortgesetzt wird. **Select** öffnet eine native Textsteuerung für mobile Auswahlgriffe und das Kopieren des beibehaltenen terminal-Textes. Desktop-Mausauswahl und Ctrl/Command+Shift+C bleiben verfügbar.

xterm 6 unterstützt synchronisierte Ausgabe (DEC-Modus 2026). Anwendungsspezifisches alternatives Bildschirmverhalten gilt weiterhin: Der alternative Bildschirm ist kein unbegrenzter Scrollback-Puffer. Ein terminal-Programm kann absichtlich seinen eigenen Bildschirm löschen oder seine eigene Historie deaktivieren. jaunt schreibt die Escape-Sequenzen dieses Programms nicht in eine fabrizierte Ausgabe um.

## Ziegellaschen

Auf dem Desktop wählen die beiden Split-Symbole nebeneinander oder oben / unten Platzierung. Ihr Inline-Wahler bietet eine neue shell oder eine beliebige Sitzung außerhalb der aktuellen Split-Gruppe. Ziehen Sie den Teiler oder fokussieren Sie ihn und verwenden Sie Pfeiltasten. Jeder Tab kann einen Split-Baum enthalten; Auswählen eines anderen Tabs behält vorherige Gruppen. Der ** Fensterbereich zu seinem eigenen Tab**-Symbol in jedem Fenster-Header trennt ihn, ohne eine Sitzung zu beenden.

Layouts, Verhältnisse, offene Ansichten, Host-Order, freundliche Namen und der Standard-Host werden im Tresor dieses Geräts gespeichert. Sie überleben die Wiederverbindung und das Wiederöffnen der App. Auf dem Handy erscheint jede Sitzung in einer Split-Gruppe als gewöhnliche Registerkarte; die Rückkehr zur Desktop-Breite stellt die Split-Anordnung wieder her. Die Layout-Einstellungen gelten pro Client, so dass ein Gerät den Arbeitsbereich eines anderen Geräts nicht neu anordnet.

## Desktop Installation und Host Controls

Das grafische Host-Installationsprogramm installiert die Desktop-Anwendung für den aktuellen Benutzer, wenn eine Desktop-Version angekündigt wird. Bestehende Hosts können `jaunt gui` verwenden, um sie zu installieren / zu öffnen, oder `jaunt gui --install-only`, um den Anwendungsstarter hinzuzufügen, ohne ein Fenster zu öffnen. Linux-Pakete und macOS-Anwendungen werden ebenfalls in der Desktop-Version bereitgestellt. Die Anwendung heißt **jaunt** und verwendet das mitgelieferte Kunstwerk.

Die Desktop-Schnittstelle ist die gleiche gebündelte Schnittstelle wie der Webclient, mit einer zusätzlichen **Diese Computereinstellungsgruppe: Installieren / Aktualisieren des Hosts, starten Sie ihn, installieren Sie seinen Anmeldedienst, koppeln Sie ein anderes Gerät und autorisieren Sie explizit ein Update / Neustart. Es kann auch mit anderen Hosts als normaler Client gekoppelt werden. Lokales shells ist über einen privaten Unix-Socket mit dem gleichen Konto zugänglich, ohne dass eine Relaisverbindung erforderlich ist; Remote-Clients authentifizieren sich immer noch durch das verschlüsselte Relais.

Linux Benutzer-Space-Archive verlassen sich auf das System, das Chromiums Benutzer-Namespace-Sandbox erlaubt. Bei Ubuntu, das diesen Mechanismus einschränkt, wählen `jaunt gui` und das grafische Installationsprogramm automatisch das `.deb`-Paket aus und fordern bei Bedarf die Systemautorisierung an. Das Paket konfiguriert sein AppArmor-Profil. Produktionsstarter fügen niemals `--no-sandbox` hinzu. macOS Desktop-Artefakte sind nicht signiert; OS-Vertrauensaufforderungen können gelten. Das Schließen des Desktop-Fensters lässt den Daemon und shells laufen. Desktop-Benachrichtigungen erfordern, dass die Desktop-App läuft.

## Präferenzen und Mitteilungen

Die Einstellungen verwenden ein Gang-Symbol. Dunkel ist die Standardeinstellung. Licht, System und Circadian sind ebenfalls verfügbar; Circadian verwendet Licht von 07:00 bis 19:00 Uhr in der lokalen Zeitzone des Geräts. Terminal-Schrifteinstellungen bleiben in den Bereichen dieses Clients geteilt.

Jeder Host stellt Ereignisschalter für terminal-Glocken, Programmbenachrichtigungen (OSC 9 und OSC 777) und Sitzungsausgang zur Verfügung. Diese Schalter beeinflussen die Ereignisgenerierung dieses Hosts. Aktivieren Sie die separate Bereitstellung auf jedem Client: native Android-Hintergrundbenachrichtigungen, Browser-Web-Push- oder Desktop-Betriebsbenachrichtigungen. `jaunt notify` und `jaunt run -- command` bleiben für explizite Benachrichtigungen und den individuellen Befehlsabschluss verfügbar. Der shell kann nicht zuverlässig auf den Begriff "fertiges Denken" jeder Anwendung schließen.

Die Benachrichtigungen lassen die terminal-Ausgabe standardmäßig aus. Browser-/OS-Berechtigungen, Force-Stop, Batterierichtlinien, Netzwerkverfügbarkeit und der Online-Host beeinflussen die Hintergrundbereitstellung. Es wird keine garantierte Lieferung oder unabhängige Sicherheitsüberprüfung beansprucht.

Programmbenachrichtigungen bewahren den OSC 9-Nachrichtentext und den OSC 777-Titel/Body. Durch Klicken auf eine native Benachrichtigung werden der Host und die Sitzung ausgewählt, auch nach dem erneuten Verbinden oder Entsperren. Android folgt den OS Lock-Screen-Datenschutzeinstellungen. Die Terminalausgabe wird nicht verschrottet, um den Benachrichtigungstext zu erfinden.

Interface-Piktogramme verwenden gepinnte, lokal gebündelte Lucide-Icons (ISC-Lizenz). Das mitgelieferte jaunt-Kunstwerk bleibt das Anwendungslogo; Linux-Pakete enthalten Standard-Icon-Größen und Android verwendet einen adaptiven Launcher-Wrapper um dieses Kunstwerk.

## Updates und sichtbare Fortschritte

Host/CLI und Desktop-Versionen sind getrennt. Der Host überprüft automatisch und wartet darauf, dass gewöhnliche shells und Transfers vor dem Neustart abgeschlossen sind. Der Desktop überprüft beim Start und alle 15 Minuten, überprüft Downloads und installiert, wenn das Fenster geschlossen wird. Einstellungen bieten manuelle Überprüfungen und Installation und erneutes Öffnen. Die Desktop-Installation bewahrt die gespeicherten Computer der App und stoppt nicht den Host shells; Systempakete erfordern möglicherweise eine OS-Autorisierungsaufforderung. Android überprüft seine APK und signiert Identität, bevor die Installation an Android übergeben wird.

Der Aktivitätsstreifen bleibt durch Bildvorbereitung, Upload, Verifizierung und Einfügen sichtbar. Enter aus einem PNG in der Host-Zwischenablage mit Ctrl+V Es verspricht nie, dass eine bestimmte CLI Attachment erkannt. Aktualisieren überprüft aktuell, installiert, warten auf aktiv shells, oder fehlgeschlagen; abgeschlossene / Fehlerergebnisse bleiben bis zur Entlassung.

### Icons für Vordergrundprogramme

Tabs und Pane-Beschriftungen verwenden die lokal gebündelten Meteor-Icons Claude und OpenAI-Marken, während das eigene PTY-Vordergrundprogramm `claude` oder `codex` ist. Erkennung wird einmal pro Sekunde aktualisiert und sendet nur die Programmkategorie, niemals Befehlsargumente. Zurück zum shell stellt das terminal-Symbol wieder her. Freundliche Sitzungsnamen beeinflussen die Erkennung nicht. Bestehende tmux-Sitzungen und unerkannte Wrapper behalten das terminal-Symbol. Meteor-Icons 4.4.0 ist MIT-lizenziert; seine Lizenz ist im Web-Bundle enthalten.
