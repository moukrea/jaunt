[English](../../../AGENTS.md) · [fr](../fr/AGENTS.md) · [es](../es/AGENTS.md) · [it](../it/AGENTS.md) · [pt](../pt/AGENTS.md) · [de](AGENTS.md)

# jaunt Beitragsrichtlinien

- Lesen Sie SECURITY.md und docs/PROTOCOL.md, bevor Sie den Transport ändern.
- Willkürliche shells sind die Kernfunktion. Beschränken Sie nicht den Zugriff auf KI-Agenten.
- Legen Sie niemals Geheimnisse in Anforderungs-URLs, Protokolle oder veröffentlichte Tests; Pairing verwendet das Fragment.
- Rendern Sie Remote-DOM-Inhalte mit textContent, niemals innerHTML. Keine CDN-Skripte zur Laufzeit in der Benutzeroberfläche.
- Wiederholen Sie niemals terminal-Eingaben nach dem Wiederanschließen. Uploads verwenden idempotente Offsets und SHA-256 Commits.
- Senden Sie niemals Enter automatisch, nachdem Sie ein Bild/Pfad eingefügt haben.
- Schließen Sie PTYs nicht, wenn sich ein Browser trennt.
- Tests: pytest; Knoten --test tests/relay.test.mjs; npm run test:relay; python tests/browser_e2e.py.
- docs/VALIDATION.md zeichnet Beobachtungen auf, keine Versprechungen. Aktualisieren Sie sie genau.
- Repository-Dokumentation, Beitragsführung und Release Notes standardmäßig in Englisch schreiben. Anwendungslokalisierung ist separat.
