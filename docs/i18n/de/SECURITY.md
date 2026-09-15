[English](../../../SECURITY.md) · [fr](../fr/SECURITY.md) · [es](../es/SECURITY.md) · [it](../it/SECURITY.md) · [pt](../pt/SECURITY.md) · [de](SECURITY.md)

# Sicherheitsmodell — ungeprüftes Beta

jaunt bietet eine vollständige shell unter dem Host-Konto. Es gibt keine Dateisystem-Sandbox oder Lesefunktion: Ein autorisiertes Gerät kann als dieser Benutzer fungieren. Führen Sie den Host nicht mit Privilegien aus, die Remote-Geräte nicht benötigen.

## Was geschützt ist

Befehle, Ausgabe, Dateien und Zwischenablagedaten werden zwischen Browser und Host verschlüsselt. Das Relais sieht Netzwerkadressen, Räume, Anwesenheit, Paketgrößen und Timing sowie ephemere öffentliche Schlüssel. Es enthält keine Pairing- oder Gerätegeheimnisse. Der Kanal wird durch ein zufälliges 256-Bit-Geheimnis mit ephemerem ECDH und AES-GCM authentifiziert. Siehe [die Protokollspezifikation](docs/PROTOCOL.md)].

Die Primitiven stammen aus Kryptographie und Web Crypto. **Ihre Zusammensetzung in diesem Protokoll ist neu und hat kein externes Audit erhalten. ** Manipulations-/Wiedergabe- und Interoperabilitätstests ersetzen kein Audit. Beschreiben Sie jaunt nicht als zertifiziert, unverwundbar oder standardmäßig für sensible Produktionsumgebungen bereit.

## Was nicht geschützt ist

- Ein kompromittiertes Browser-, Maschinen- oder Systemkonto bleibt kompromittiert.
- GitHub Pages bietet Code, der nach dem Entsperren auf Geheimnisse zugreifen kann: Ein Angreifer, der das Repository oder die Seite kontrolliert, kann die JavaScript ersetzen.
- Ohne Passwort werden Schlüssel unverschlüsselt in IndexedDB gespeichert, wie eine erinnerte Sitzung. Ein Passwort/PIN verschlüsselt sie im Ruhezustand; eine kurze PIN bleibt anfällig für Offline-Raten. Bevorzugen Sie eine lange Passphrase.
- Die Sperrung stoppt Verbindungen und löscht aktive Ansichten. Es garantiert nicht die kryptographische Löschung des Browser-RAM.
- Ein vollständiger QR-Code gewährt shell Zugriff für zehn Minuten.
- Browserbenachrichtigungen werden über den Push-Service des Browsers geliefert. Programmbereitgestellte Benachrichtigungstitel und -körper werden über diesen Dienst angezeigt und gesendet; fügen Sie keine Geheimnisse in Benachrichtigungen ein. Android folgt den Datenschutzeinstellungen des Systemsperrbildschirms. Die Terminalausgabe wird nicht für Benachrichtigungen verschrottet.
- Ein widerrufenes Gerät kann sich nicht mehr gegenüber dem Kanal authentifizieren, kennt aber die vorherige gemeinsame Routing-Fähigkeit. Es kann immer noch die Verfügbarkeit des Relais stören, bis die Host-Identität gedreht wird. Routing-Geheimnisse sind kein vollständiges Kontingent oder Anti-DDoS-System.

## Geteilte GitHub Seiten Ursprung

Sites in `moukrea.github.io/another-project/` und `moukrea.github.io/jaunt/` teilen sich einen Browser-Ursprung. Ein anderes anfälliges Projekt auf diesem Ursprung könnte auf den Speicher von jaunt abzielen. Pfade sind keine Sicherheitsgrenze. Für sensible Zwecke dienen Sie jaunt mit einem dedizierten Ursprung (eigene Domain/Subdomain) und koppeln sich dort wieder. Eine PIN schützt die ruhenden Schlüssel, ersetzt jedoch nicht die Ursprungsisolierung oder das Vertrauen in die bediente JavaScript.

## Speicherung und Berechtigungen

`~/.local/share/jaunt/host.json` und das Steuerelement sind privat für das Girokonto. Das Verzeichnis verwendet den Modus 0700, der Zustand verwendet 0600 und schreibt atomar. `attachments/` enthält hochgeladene Dateien; das Sperren der App löscht sie nicht. Entfernen Sie nicht benötigte Anhänge über den Dateibrowser.

Persistente Schlüssel erscheinen nie in Anforderungs-URLs: Pairing verwendet das Fragment, das sofort aus der Historie entfernt wird. Relay-Fähigkeiten werden im ersten WebSocket-Rahmen über TLS gesendet. Der Worker protokolliert keine Nutzlasten.

## Entsendung

Verwenden Sie HTTPS/WSS Outside Loopback, beschränken Sie APP_ORIGIN auf den genauen Pages-Ursprung, aktivieren Sie MFA- und Branch-Schutz, minimieren Sie Cloudflare/GitHub-Berechtigungen und überwachen Sie Kontingente und Kosten. Fügen Sie keine Analytics-Skripte oder Erweiterungen von Drittanbietern zur Seite hinzu. Der statische CSP blockiert Inline-Skripte und dynamische Auswertung; Abhängigkeiten sind lokal. GitHub Pages kann nicht jeden Server-Sicherheitsheader einstellen; Verwenden Sie eine kontrollierte Domäne / Proxy für weitere Härtung.

## Melden einer Schwachstelle

Veröffentlichen Sie niemals einen Schlüssel, QR-Code, vertrauliches terminal-Log, host.json-Datei oder Vault-Export des Repositorys, falls verfügbar. Vor der Veröffentlichung muss der Maintainer einen privaten Meldekanal und eine Rotationspolitik einrichten.

## Desktop-Grenze

Der Desktop-Renderer ist sandboxed, mit deaktivierter Node-Integration und aktivierter Kontextisolation. Er erhält eine schmale Vorlade-IPC-Schnittstelle, die mit dem Hauptframe der Anwendung validiert ist. Gebündelte Ressourcen werden über das sichere `jaunt://app/`-Schema bedient. Die externe Navigation öffnet den Systembrowser und empfängt niemals die Host-Bridge. Das Relay gibt auch den genauen nativen Renderer-Ursprung `jaunt://app` für Remote-Desktop-Verbindungen zu; beliebige Browser-Ursprünge bleiben abgelehnt. Ursprungsprüfungen sind keine Authentifizierung: native Clients benötigen weiterhin Routing-Fähigkeiten und den Host-authentifizierungs-verschlüsselten Handshake. Lokaler Zugriff nutzt den vorhandenen privaten Unix-Steuersockel und gewährt die gleichen Account-Rechte wie der CLI. Es ist kein zweiter Netzwerk-Hörer und umgeht keine Remote-Authentifizierung.

Die Desktop-Release und das Host-Installationsprogramm sind Teil der vertrauenswürdigen Update-Oberfläche. Checksums erkennen beschädigte / nicht übereinstimmende Artefakte; sie schützen nicht vor einem kompromittierten Repository / Release-Publisher. Desktop-Pakete enthalten nur zulässige Anwendungsdateien und Laufzeitabhängigkeiten, keine Hostzustands- oder Benutzerprofile. Test-only-Renderer-Sandbox-Overrides dürfen niemals in Produktionsstarter eingeben.
