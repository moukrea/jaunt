[English](../../../DESKTOP_RELEASE_NOTES.md) · [fr](../../fr/docs/DESKTOP_RELEASE_NOTES.md) · [es](../../es/docs/DESKTOP_RELEASE_NOTES.md) · [it](../../it/docs/DESKTOP_RELEASE_NOTES.md) · [pt](../../pt/docs/DESKTOP_RELEASE_NOTES.md) · [de](DESKTOP_RELEASE_NOTES.md)

# jaunt Desktop 0.1.0-beta.10

Eine native Desktop-Anwendung, die die gleiche responsive Benutzeroberfläche wie der Browser und der Android-Client mit lokalen Host-Steuerelementen teilt. Lokale und Remote-Geräte werden mit dem gleichen gewöhnlichen shells ohne tmux verbunden. Desktop-Tabs unterstützen persistente, resizierbare Split-Flächen; mobile Layouts zeigen diese Sitzungen als separate Registerkarten an.

**Sessions** listet laufende und beendete Sitzungen auf, öffnet bestehendes shells, schließt nur eine Ansicht oder beendet explizit ein shell und seine Jobs für alle Zuschauer. Durch Klicken oder Tippen wird ausgewählt, welches Gerät die geteilte terminal-Größe steuert.

Die App verwendet das originale jaunt-Artwork, Dark/Light/System/Circadian-Themes, freundliche Hostnamen/Order/Standards und optionale private OS-Benachrichtigungen. Es kann einen installierten Hostdienst starten und eine Verbindung zu anderen Hosts herstellen. Das offizielle Installationsprogramm bietet auch `--client-only` an, das den Desktop-Client ohne lokalen Host oder lokale Host-Steuerelemente installiert.

Linux: Installieren Sie die `.deb` oder `.rpm` oder verwenden Sie `jaunt gui` für eine verifizierte Archivinstallation pro Benutzer. macOS: Öffnen Sie das Anwendungsarchiv/Disk-Image der passenden CPU oder verwenden Sie `jaunt gui` von einem installierten Host. Desktop-Builds sind auf macOS nicht signiert. Kein Launcher deaktiviert Chromiums Sandbox. Benachrichtigungen erfordern die Ausführung der App.

Das Protokoll hat kein unabhängiges Sicherheitsaudit erhalten, siehe `docs/WORKSPACE.md` und `docs/WORKSPACE_VALIDATION.md` für Verhalten, beobachtete Tests und verbleibende Validierungsgrenzen.

Dieses Update ersetzt Schnittstellenpiktogramme mit Lucide, zeigt Programmbenachrichtigungstext an und behält Benachrichtigungsziele durch Reconnects bei. Linux-Pakete enthalten Standardgrößen für Icon-Themen und lesbare Launcher-Metadaten. Auf Ubuntu mit eingeschränkten Benutzernamensräumen wählt der Host-Installer das Systempaket aus, um die Sandbox-Unterstützung zu konfigurieren.

Sitzungssteuerelemente halten nun die Ansicht Offen, Umbenennen, Schließen und Beenden in jeder responsiven Sitzungskarte. Neues shell erstellt sofort einen automatisch benannten terminal. Neues shell im Ordner bietet Verzeichnis-Browsing und einen optionalen Namen. Der Host kann das aktuelle Verzeichnis des aktiven shell erben. Desktop verfügt über separate Side-by-Side- und oben/unten Split-Steuerelemente, eine Inline-Auswahl neuer oder bestehender Sitzungen und eine Schaltfläche, um jeden Bereich in seinen eigenen Tab zu verschieben. Mobile behält gewöhnliche Sitzungsregisterkarten. Schließen einer Ansicht hält sein shell am Leben; die Beendigung erfordert weiterhin eine explizite Bestätigung.

Die Desktop-App sucht nun automatisch nach Updates, lädt die passende Version herunter und überprüft sie und installiert sie, wenn Sie die App schließen. Einstellungen bieten Check Desktop Update, einen automatischen Update-Schalter und Installieren und erneut öffnen, wenn sie fertig sind. Systeminstallationen können nach OS-Autorisierung fragen. Dadurch wird die Benutzeroberfläche separat vom Host aktualisiert und der Host shells nicht gestoppt. Uploads und Update-Checks zeigen jetzt sichtbaren Fortschritt und ein beibehaltenes Ergebnis anstelle von nur einem Start-Toast.

Verbindungsunterbrechungen teilen sich jetzt ein persistentes Statusbanner. Späte asynchrone Handshake-Ergebnisse können eine Ersatzverbindung nicht überschreiben. Dialogfehler bleiben inline; Aktionsfehler bleiben ohne Toast-Kaskaden bestehen. Übertragungen zeigen Warten/Stornieren/Fertigstellen, abgeschlossene Aktivität bricht in einen barrierefreien Verlauf ein und die Updateverfügbarkeit hält ihre Aktion sichtbar.

Diese Version behebt Einstellungen Layout, stabile Tab-Ordnung, Doppelklick-Umbenennung, Reconnect / Update-Feedback und mobile Scroll-Ankerung. Es fügt eine persistente zusammengebrochene Seitenleiste und sechs systemdetektierte Sprachen mit einer expliziten Überschreibung hinzu. Der Fenstertitel lautet einfach `jaunt`. Claude und Codex Vordergrundsitzungen verwenden lokal gebündelte Meteor-Markensymbole.
