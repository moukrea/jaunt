[English](../../../PROTOCOL.md) · [fr](../../fr/docs/PROTOCOL.md) · [es](../../es/docs/PROTOCOL.md) · [it](../../it/docs/PROTOCOL.md) · [pt](../../pt/docs/PROTOCOL.md) · [de](PROTOCOL.md)

# jaunt Protokoll v1

Dieses Dokument beschreibt die Umsetzung, keine Standard- oder Sicherheitsgarantie.

## Transport und Identitäten

Endpunkt: `wss://RELAY/v1/room/ROOM`. ROOM besteht aus 18 zufälligen Bytes, codiert als unpadded base64url (24 Zeichen). Routing-Fähigkeiten sind 32 Bytes (43 Zeichen). Der Host registriert sich mit `hostToken` und `clientToken`. Das Durable Object speichert ihre SHA-256 Hashes in einer ersten atomaren Transaktion; ein anderer Host kann sie nicht ersetzen. Der Browser hält nur clientToken. Clientnachrichten werden mit einer Peer-ID geroutet, die vom Relais zugewiesen wird, nicht vom Client ausgewählt.

Das Relay speichert Routing-Hashes und Attachment-Status, die für den Ruhezustand benötigt werden, niemals terminal-Historie. Verschlüsselungsschlüssel bleiben an den Endpunkten. Beide Verbindungen sind ausgehend; der Host benötigt keinen eingehenden Port. Browser WebSockets muss den konfigurierten `APP_ORIGIN` verwenden; der verpackte Desktop verwendet den separat erlaubten `jaunt://app`-Ursprung. Origin-less native Host/Android-Verbindungen bleiben unterstützt. Alle Clients authentifizieren weiterhin Routing-Fähigkeiten und den End-to-End-Kanal.

## Paarung

`jaunt1.` gefolgt von base64url JSON enthaltend `v` (Fassung), `r` (Relais) `h` (Zimmer), `t` (clientToken) `p` (Paarausweis), `s` (Paargeheimnis) und `n` (Hostname): Der Host speichert und erzwingt den Ablauf; der Browser behandelt seinen eigenen Ablaufwert nicht als verbindlich. QR Code zeigt auf die Seite mit diesem Code im Fragment. Lebensdauer: 600 Sekunden, einmalige Nutzung.

Der Browser erstellt seine Geräte-ID und das 32-Byte-Geheimnis und speichert sie VOR dem Verbrauch des QR-Codes, überträgt sie dann erst nach Authentifizierung und Verschlüsselung. Wenn die endgültige Begrüßungsnachricht verloren geht, versucht er zuerst die persistente Geräteidentität, dann die Kopplung, wenn sie noch gültig ist. Der Widerruf entfernt die hostseitige Autorisierung und schließt die Kanäle dieses Geräts.

## Handshake

Client und Server erstellen jeweils einen ephemeren P-256-Schlüssel. Öffentliche Schlüssel verwenden unkomprimierte SEC1-Codierung und base64url. Das Transkript ist ein kompaktes ASCII JSON-Array in genau dieser Reihenfolge:

```
["jaunt-v1", room, auth, id, pair-or-"", clientNonce, clientPublic, serverNonce, serverPublic]
```

Beweise sind HMAC-SHA256 (geheim, `server:` || Transkript) und HMAC-SHA256 (geheim, `client:` || Transkript), die vor dem Öffnen des Kanals überprüft werden. `auth` unterscheidet die Paarung von einem erinnerten Gerät. Jede Verbindung verwendet zufällige Nonces.

Shared = P-256 ECDH. AAD = SHA256(Transcript). HKDF-SHA256, Länge 32, salt SHA256(secret), info AAD || `jaunt-c2h` oder AAD || `jaunt-h2c`. Zwei unabhängige AES-256-GCM-Schlüssel, einer pro Richtung. Strenge Zähler beginnen bei 1; die 12-Byte-Nonce sind vier Nullbytes gefolgt vom Big-Endian-uint64-Zähler. Schließen und wieder verbinden, bevor der Noce-Zähler 2^53 erreicht. Jede Lücke, Duplikat oder GCM-Fehler schließt den Kanal. Ephemere Schlüssel werden nach dem Wiederanschließen nie wiederverwendet.

Anwendungsrahmen: `{type:"box", n:counter, ct:base64url(ciphertext+tag)}`. Entschlüsselte Nachrichten sind JSON; binäre Chunks verwenden base64url. Transportbudget: 132.000 Zeichen. Eingabe, Ausgabe und Dateien werden vor der Verschlüsselung gehackt.

## RPC und Streams

Anfragen: `{type:"rpc", id, method, params}`. Antworten: `{type:"reply", id, ok:true, result}`, oder das in daemon.py definierte Fehlerformular. `Peer.dispatch` und `Host.rpc` sind die Quelle der Wahrheit für Methoden und Ereignisse; erfinden Sie kein zweites, divergierendes Schema.

Sessions verwenden idempotente IDs und geben mit absoluten Byte-Offsets aus. Nach der Wiederverbindung wiederholt `session.attach(after)` nur die beibehaltene Ausgabe, die nicht empfangen wurde. Wenn der Puffer abgeschnitten wurde, wird ein explizites Reset-Ereignis gesendet. Dimensionen werden geteilt: Der letzte aktive Client ändert die Größe des gemeinsamen PTY.

Uploads verwenden Per-Transfer-IDs, Gerätebesitz, einen erwarteten Offset und eine Offset-Antwort für doppelte Blöcke. SHA-256 wird während des Empfangs berechnet; Commit ist atomar und überschreibt kein gleichzeitig erstelltes Ziel. Temporäre Dateien befinden sich im selben Verzeichnis mit dem Modus 0600. Übertragungen laufen nach einer Stunde Inaktivität ab. Es gibt keine Wiederaufnahme auf der Festplatte nach einem Neustart des Hosts. Downloads lesen reguläre Dateien, überprüfen Größe und mtime und verwenden 48 KiB-Blöcke.

## Evolution

Ein nativer Android-Client muss dieses Protokoll und die gleiche Semantik des Identitätsspeichers implementieren; er darf die WebSocket-Sitzung des Browsers nicht kopieren. Versionieren Sie jede inkompatible Änderung. Python/Web Crypto Interoperabilität und Wiederholungstests müssen in CI erforderlich bleiben.

## Gemeinsame Ansichten und lokaler Desktop-Transport

Eine Begrüßung enthält optional `peer`, die aktuelle Ansichtskennung. Sitzungsinformationen umfassen `viewers` und `activeView`. `terminal.geometry` trägt die Spalten, Zeilen, die steuernde Ansicht und die Ansichtsliste des PTY. Eine explizite aktive Eingabe oder Größenänderung beansprucht Geometrie; lediglich Anfügen nicht. Behaltene Ausgabe zeichnet ihre Dimensionen auf und sendet Geometrieänderungen in der Reihenfolge aus. Clients serialisieren diese mit der asynchronen Schreibwarteschlange des terminal Parsers.

`session.detach` entfernt eine Ansicht, ohne die PTY zu schließen. `session.terminate` beendet explizit die zugrunde liegende Sitzung, einschließlich einer benannten tmux-Sitzung, falls zutreffend. Das alte `session.close`-Verhalten bleibt mit älteren Clients kompatibel.

Die Desktop-Bridge sendet die gleichen RPC/Stream-Nachrichten nach `ui.connect` über den 0600 Unix-Steuer-Socket. Das 0700-Mutter-Verzeichnis des Sockets beschränkt den Zugriff auf das Host-Konto. Für diesen Kanal mit demselben Konto wird kein Pairing-Geheimnis generiert; Remote-Verbindungen behalten den vorhandenen kryptographischen Handshake bei. Die Eingabe wird nie wiedergegeben, wenn sich einer der beiden Kanäle wieder verbindet.

Neuer Pairing-Text verwendet das Kleinbuchstabenpräfix `jaunt1.`. Aktualisierte Clients akzeptieren auch das ursprüngliche Großbuchstabenpräfix; Pairing-URL-Fragmente und kryptographische Transkript-Etiketten sind unverändert. Bestehende Umgebungsvariablenüberschreibungen werden als Kompatibilitätsaliase akzeptiert, während neue Dokumentationen Kleinbuchstaben-Produktpräfixe verwenden.

Hosts, die `sessionDirectory: true` bewerben, akzeptieren `session.directory(id)` und das optionale `sourceSession` auf `session.create`. Ein explizites, nicht leeres `cwd` hat Vorrang. Der Host liest das aktuelle Verzeichnis des shell-Prozesses auf Linux/macOS und greift auf sein ursprüngliches Verzeichnis zurück, wenn der Prozess beendet ist oder das Betriebssystem es nicht liefern kann.

Neue Host-Aktualisierungsanforderungen geben eine Operations-ID zurück, die durch Update-Statuseinträge übertragen wird. Clients können das Ergebnis der angeforderten Überprüfung von einer zuvor abgeschlossenen Überprüfung unterscheiden. Statuses umfassen das Überprüfen, Herunterladen, Verifizieren, Installieren, Installieren, Aktuelles, Zurückgestelltes und Fehler. Ein Installationsfehler wird nicht als Warten gemeldet, es sei denn, aktive shells/Transfers blockierten tatsächlich einen nicht autorisierten Neustart.
