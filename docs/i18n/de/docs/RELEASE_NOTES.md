[English](../../../RELEASE_NOTES.md) · [fr](../../fr/docs/RELEASE_NOTES.md) · [es](../../es/docs/RELEASE_NOTES.md) · [it](../../it/docs/RELEASE_NOTES.md) · [pt](../../pt/docs/RELEASE_NOTES.md) · [de](RELEASE_NOTES.md)

# jaunt 0.1.0-beta.11

Kompatible Host-Updates ersetzen nun die Laufzeit, während gewöhnliche shell-Prozesse, deren Arbeitsverzeichnisse, Umgebung und terminal-Historie beibehalten werden. Clients verbinden sich automatisch wieder. Ältere Hosts benötigen eine geschützte Migration: Ihre aktive shells kann nicht rückwirkend beibehalten werden, und das Installationsprogramm benötigt immer noch eine explizite Autorisierung, bevor sie beendet werden.

Der freigegebene Arbeitsbereich behebt gequetschte Einstellungen, instabile Registerkartenpositionen, mobile Historiensprünge und übergroße Fehlermeldungen. Registerkarten unterstützen Drag-and-Drop-Ordering und Doppelklick-Umbenennung; die Desktop-Seitenleiste kann zusammenbrechen. Claude und Codex Vordergrundprogramme verwenden lokal gebündelte Meteor-Markensymbole in Registerkarten und Fensterunterschriften. Andere Programme behalten das terminal-Symbol bei.

Web, Desktop, Android und CLI unterstützen Systemsprachenerkennung und explizite Englisch-, Französisch-, Spanisch-, Italienisch-, Portugiesisch- und Deutschpräferenzen. Englisch bleibt die kanonische Repository-Dokumentation mit verknüpften übersetzten Kopien. Die Web-Homepage stellt das Projekt vor und bietet kopierbare Installationsbefehle; native Apps öffnen den Arbeitsbereich direkt.

Das Installationsprogramm bietet `--client-only` für einen Desktop-Client an, ohne einen lokalen Host zu installieren oder lokale Host-Steuerelemente freizulegen. Update- und Übertragungsvorgänge behalten den sichtbaren Fortschritt und die endgültigen Ergebnisse. Desktop-Fenster tragen den Titel `jaunt`; Die installierte Web-App heißt `jaunt (PWA)`. Launcher und Web-Icons verwenden das mitgelieferte transparente Kunstwerk.

Das Protokoll hat kein unabhängiges Sicherheitsaudit durchlaufen. Die Validierung des physischen Telefons wird nicht beansprucht. Siehe [Validierungsbericht](SEAMLESS_WORKSPACE_VALIDATION.md) für beobachtete Tests und verbleibende Plattformgrenzen].
