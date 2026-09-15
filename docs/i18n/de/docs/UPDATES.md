[English](../../../UPDATES.md) · [fr](../../fr/docs/UPDATES.md) · [es](../../es/docs/UPDATES.md) · [it](../../it/docs/UPDATES.md) · [pt](../../pt/docs/UPDATES.md) · [de](UPDATES.md)

# Updates ohne Verlust von Sitzungen oder Identitäten

## Gastgeber

Der öffentliche Installateur konfiguriert automatische Updates standardmäßig. Der Host überprüft die von der veröffentlichten Seite ausgewählte Version nach dem Start und alle 15 Minuten. Dadurch bleibt sie auf dem validierten Bereitstellungskanal des Besitzers. Eine Quellauscheckung hat keine automatische Installationsberechtigung; sie muss zuerst durch den öffentlichen Installateur installiert werden.

Ein neues Rad wird über HTTPS heruntergeladen und mit seinem Veröffentlichungsmanifest verifiziert. Das Installationsprogramm wird von diesem verifizierten Rad ausgelesen. Kompatible Hosts ersetzen die bestehende Python-Laufzeit durch `exec`: Der Daemon PID, die shell-Prozesse und die offenen PTY-Deskriptoren bleiben am Leben. Der begrenzte Wiederholungspuffer und die terminal-Geometrie durchlaufen einen nicht verknüpften privaten Dateideskriptor. Shell-Umgebungsvariablen, Arbeitsverzeichnisse und laufende Befehle bleiben in ihren ursprünglichen Prozessen. Clients verbinden sich mit ihren vorhandenen Schlüsseln wieder. Dies erfordert keine tmux.

Der Installer validiert die neue Laufzeit, bevor er die Übergabe anfordert und stoppt die Annahme neuer Sitzungen während des Wechsels. Wenn die Vorbereitung fehlschlägt, wird der alte Host wieder seinen bestehenden shells bedienen. Der automatische Modus erbt niemals `jaunt_ALLOW_RESTART` oder Entwickler-Download-Überschreibungen.

**Migration von älteren Hosts: ** Releases ohne Runtime Handoff können ihre PTYs nicht über einen Runtime-Ersatz beibehalten. Der Installer erkennt diese Fähigkeit und verzögert sie, während gewöhnliches shells aktiv ist. Um sie zu beenden, ist weiterhin eine ausdrückliche Genehmigung durch **Update und Neustart** oder `jaunt update --allow-restart` erforderlich. Ein gewöhnliches `jaunt update` erteilt diese Berechtigung nie. Nach dieser einmaligen Migration verwenden nachfolgende kompatible Updates automatisch die Handoff.

Anwendungsaktualisierungen bewahren shells; explizites Stoppen/Neustarten des Daemons oder Neustarten des Computers beendet immer noch das normale shells. Dieser Mechanismus ist keine Wiederherstellung nach einem Daemon-Absturz oder Stromausfall.

Der abgetrennte Updater verwendet eine private Sperre, um überlappende Updates zu verhindern und behält die alte Laufzeit, bis der verifizierte Ersatz bereit ist. Host-Identität und Gerätedatensätze bleiben erhalten. Private `installation.json`, `update-status.json`, `update.log` und Stufenräder werden niemals Assets freigeben. Fehlgeschlagene Überprüfungen widerrufen keine Geräte.

## Android

Der APK überprüft öffentliche Android-Versionen automatisch mit einer manuellen Überprüfung in den Einstellungen. Er überprüft heruntergeladene Bytes, Paketidentität, eine strikt neuere Version und das gleiche Signaturzertifikat, bevor er das Android-Installationsprogramm öffnet. App-Daten und -Paarungen werden während eines Updates beibehalten. Android erfordert eine Benutzerbestätigung für die APK-Installation und kann einmal um Erlaubnis bitten, Updates von jaunt zu installieren. Dies ist eine OS-Grenze, kein fehlender Cloud-Service oder Endbenutzerkonto.

Siehe [Android Details und Validierung](ANDROID.md). Aktualisierungsprüfungen, Signaturprüfungen und Funktionstests stellen kein unabhängiges Sicherheitsaudit dar.]

## Desktop-Anwendung

Die Desktop-GUI verfügt über eine eigene Release-Version und einen Updater, getrennt vom Host/CLI. Sie überprüft den veröffentlichten Kanal kurz nach dem Start und alle 15 Minuten, wählt das Linux/macOS-Paket für die aktuelle CPU aus und überprüft SHA-256 nach dem Herunterladen und erneut vor der Installation.

Eine sichtbare Aktivitätszeile folgt der Überprüfung, dem Herunterladen, der Überprüfung, der Bereitschaft und den Fehlern. **Installieren und erneut öffnen** wendet ein verifiziertes Paket an und öffnet das gleiche Anwendungsprofil erneut. Wenn automatische Updates aktiviert sind, wendet das Schließen der App auch ein fertiges Update an. Das abgetrennte GUI-Installationsprogramm stoppt niemals den Hostdienst oder beendet seine shells. Eine System-`.deb`/`.rpm`-Installation oder ein geschützter macOS-Anwendungsstandort kann eine OS-Autorisierung erfordern. macOS-Builds bleiben unsigniert und unnotarisiert.

Ein Installationsergebnis wird im privaten Desktop-Profil beibehalten. Fehler wird beim nächsten Start angezeigt; es wird nicht sofort durch die Startüberprüfung ausgeblendet. Ältere Desktop-Builds benötigen eine Installation eines Releases, das diesen Updater enthält, mit dem öffentlichen Paket oder `jaunt gui --install-only`.

## Sichtbare Fortschritte

Web- und Desktop-Bildübertragungen behalten ihr tatsächliches Ergebnis bei: verifizierter Upload und zitierte Pfadeinfügung ohne Enter oder Host-Zwischenablagevervollständigung plus Ctrl+V-Lieferung. Sie behaupten nicht, dass ein CLI einen Anhang erkannt hat. Host-Checks zeigen Abschluss, Ausfall oder explizite Verschiebung für aktive Arbeit. Android verwendet native Fortschrittsdialoge für Prüfungen und APK Downloads, gefolgt von der Bestätigung des Betriebssystem-Installationsprogramms.
