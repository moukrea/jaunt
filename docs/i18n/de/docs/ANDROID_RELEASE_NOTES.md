[English](../../../ANDROID_RELEASE_NOTES.md) · [fr](../../fr/docs/ANDROID_RELEASE_NOTES.md) · [es](../../es/docs/ANDROID_RELEASE_NOTES.md) · [it](../../it/docs/ANDROID_RELEASE_NOTES.md) · [pt](../../pt/docs/ANDROID_RELEASE_NOTES.md) · [de](ANDROID_RELEASE_NOTES.md)

# jaunt Android 0.1.0-beta.8

Dieses Update fügt Touch-Scrollen mit Momentum hinzu, behält die Leseposition über die Tastaturgröße bei, verwendet gebündelte Lucide-Interface-Symbole und verwendet das ursprüngliche transparente Logo als Launcher-Symbol. Es verwendet das ursprüngliche jaunt-Symbol, stellt den freigegebenen Sitzungsmanager und die Themen bereit und erhält automatische terminal Bell / Programm / Session-Exit-Benachrichtigungen, wenn aktiviert. Desktop-Split-Layouts bleiben gewöhnliche Sitzungsregisterkarten bei mobilen Breiten.

Diese Version regelt den schnellen terminal-Eingang, um ein Überlaufen der begrenzten Eingangswarteschlange des Hosts zu vermeiden. Ausstehende Eingaben werden verworfen, wenn sich der verschlüsselte Kanal ändert; Befehle werden nach der Wiederverbindung nie wiedergegeben.

Installieren Sie das signierte `.apk` Aktiva nach unten Android 8 oder neuer. Erlauben Sie die Installation von Ihrem Browser, wenn Android fragt, offen jauntScannen Sie dann die QR hergestellt durch `jaunt pair` über Ihren Gastgeber. Nein Android, GitHub oder Cloudflare Ein Konto ist erforderlich, um sich zu verbinden.

Dies ist eine installierbare Android APK mit einer gebündelten WebView-Schnittstelle und nativen Integrationen, keine PWA und keine vollständig neu geschriebene Android-Benutzeroberfläche:

- Native Kamera QR Scannen und Galerie / Dateiauswahl.
- Android Bild/Text-Zwischenablage zugreifen. Ein eingefügtes Bild wird hochgeladen und, wenn der Host eine unterstützte OS-Zwischenablage hat, dort kopiert, bevor Ctrl+V an das ausgewählte shell gesendet wird, ohne Enter. Headless-Hosts behalten ein explizites Upload/Pfad-Fallback bei.
- Systemspeicher-Dialog für Downloads; verifizierter Übertragungsfortschritt bleibt in Dateien verfügbar.
- Optionale native Vordergrundverbindung für Benachrichtigungen, auch während die App im Hintergrund ist. Aktivieren Sie sie in Einstellungen. Die persistente Android-Benachrichtigung enthält Stop. Benachrichtigungen zeigen den Titel/Body an, der von Programmen ausgestrahlt wird; Tippen auf eine öffnet die passende Sitzung. Android Lock-Screen-Datenschutzeinstellungen gelten weiterhin.
- Die gespeicherte Kopplung überlebt App-Updates und Netzwerkänderungen. Schlüssel sind vom Backup ausgeschlossen; Hintergrund-Service-Identitäten sind mit Android Keystore verschlüsselt.

Der Host muss in Betrieb bleiben; der öffentliche One-Command-Installer konfiguriert seinen Benutzerservice. Android Force-Stop, Batteriebeschränkungen, Host-/Netzwerkausfälle und OS-Planung können Benachrichtigungen verzögern oder verhindern. Dies verspricht keine garantierte Lieferung im tiefen Leerlauf. Das Protokoll wurde keiner unabhängigen Sicherheitsüberprüfung unterzogen.

Der Validierungsbericht unterscheidet Emulatortests von physischen Telefontests und genauen Zwischenablagen/Ctrl+V Lieferung aus der Erkennung als Attachment innerhalb eines bestimmten Claude Code/Codex Version. siehe `docs/ANDROID.md` und `docs/VALIDATION.md` In der getaggten Quelle.

Die APK prüft automatisch nach Updates. Einstellungen bieten auch eine sofortige Überprüfung. Downloads werden mit Release-Prüfsummen und der installierten Signaturidentität verifiziert, bevor Android nach Installationsbestätigung fragt. Updates bewahren App-Daten und -Paarungen auf; Deinstallation entfernt sie.

Sitzungssteuerelemente halten nun die Ansicht Offen, Umbenennen, Schließen und Beenden in jeder responsiven Sitzungskarte. Neues shell erstellt sofort einen automatisch benannten terminal. Neues shell im Ordner bietet Verzeichnis-Browsing und einen optionalen Namen. Der Host kann das aktuelle Verzeichnis des aktiven shell erben. Desktop verfügt über separate Side-by-Side- und oben/unten Split-Steuerelemente, eine Inline-Auswahl neuer oder bestehender Sitzungen und eine Schaltfläche, um jeden Bereich in seinen eigenen Tab zu verschieben. Mobile behält gewöhnliche Sitzungsregisterkarten. Schließen einer Ansicht hält sein shell am Leben; die Beendigung erfordert weiterhin eine explizite Bestätigung.

Verbindungsunterbrechungen teilen sich jetzt ein persistentes Statusbanner. Späte asynchrone Handshake-Ergebnisse können eine Ersatzverbindung nicht überschreiben. Dialogfehler bleiben inline; Aktionsfehler bleiben ohne Toast-Kaskaden bestehen. Übertragungen zeigen Warten/Stornieren/Fertigstellen, abgeschlossene Aktivität bricht in einen barrierefreien Verlauf ein und die Updateverfügbarkeit hält ihre Aktion sichtbar.

Diese Version fügt sechs systemdetektierte UI-Sprachen mit einem gespeicherten Override hinzu, stabile Draggable-Tabs mit Doppelklick-Umbenennung, korrigiertes Betriebs-Feedback und lokal gebündelte Claude/OpenAI-Vordergrundsymbole. Die native App öffnet den Workspace direkt; die Präsentations-Homepage ist für die Website reserviert.
