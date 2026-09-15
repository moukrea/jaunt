[English](../../../DEPLOYMENT.md) · [fr](../../fr/docs/DEPLOYMENT.md) · [es](../../es/docs/DEPLOYMENT.md) · [it](../../it/docs/DEPLOYMENT.md) · [pt](../../pt/docs/DEPLOYMENT.md) · [de](DEPLOYMENT.md)

# Einsatz von Instandhaltungspersonal

Endbenutzer installieren nur den Host. Der **Projektbesitzer** stellt diese beiden Komponenten einmal bereit:

1. GitHub Seiten: HTML, JavaScript, CSS, Logo, Installer und öffentliche Konfiguration.
2. Cloudflare Worker with a SQLite Durable Object: WebSocket relay. Ersetzen Sie es nicht durch einen Looping GitHub Actions Job, einen persönlichen Tunnel oder die öffentlichen Server eines anderen Projekts.

## Zubereitung

Speichern Sie das vorhandene Repository auf einem Backup-Zweig, integrieren Sie dann die Dateien auf einem Arbeitszweig. Überschreiben Sie nicht den Verlauf oder Force-Push. Installieren Sie Python und Node 22+, führen Sie dann `pip install -e . -r requirements-dev.txt`, `npm ci` und `npm run prepare-web` aus. Die Build-Kopien jsQR 1.4.0 und seine Lizenz lokal und erzeugen einen versionierten PWA-Cache. Begehen Sie die echt aufgelösten `package-lock.json` und überprüfen Sie Lizenzen; erfinden Sie niemals eine Lockfile.

Die Scharf/Undici-Adressierung überschreibt bekannte Hinweise in der Miniflare 4-Testabhängigkeit; siehe [VALIDATION.md](VALIDATION.md)].

## Relais

- Erstellen oder Auswählen eines Cloudflare-Kontos, das für Worker und SQLite Durable Objects autorisiert ist.
- Autorisieren Sie den Agenten zur Bereitstellung oder zum Festlegen der Aktionsgeheimnisse `CLOUDFLARE_API_TOKEN` und `CLOUDFLARE_ACCOUNT_ID` über die sichere Schnittstelle von GitHub. Das Token muss die Bereitstellung von Worker und die Migration von Dauerhaltbarkeitsobjekten in diesem Konto ermöglichen.
- `relay.yml` führt Wrangler mit `relay/wrangler.jsonc` aus: Anfangsname `jaunt-relay`, Bindung `ROOMS`, Klasse `Room`, SQLite Migration `v1`.
- APP_ORIGIN muss `https://moukrea.github.io` sein (der Ursprung, ohne `/jaunt/`). Verwenden Sie `*` in der Produktion nicht. `config.json` muss die tatsächliche WSS-URL des Workers enthalten, ohne einen angehängten `/v1/room/...`-Pfad; der Client konstruiert diesen Pfad.
- Überprüfen Sie `/health`, dann ** echtes Pairing und einen verschlüsselten Befehl **. Eine HTTP 200-Gesundheitsreaktion validiert WebSockets nicht.

## Host, Desktop und Android Releases, dann Pages

1. Pass CI. Erstellen Sie das Host-Tag, derzeit `v0.1.0-beta.10` (Python Version `0.1.0b10`). Der Release-Workflow baut das Rad auf und veröffentlicht es mit `host-manifest.json` und `SHA256SUMS`. Beta-Releases werden explizit als Pre-Releases markiert. Überschreiben Sie niemals die Assets eines vorhandenen Releases.
2. Veröffentlichen Sie für Android das Tag, derzeit `android-v0.1.0-beta.7`, mit seinem signierten APK, `SIGNING-CERTIFICATE.txt` und `SHA256SUMS`; überprüfen Sie die öffentlichen Assets.
3. `desktop-v0.1.0-beta.9`: Linux x64/ARM64-Archive, deb/rpm-Pakete, macOS x64/ARM64 zip/dmg-Pakete und `SHA256SUMS`. Überprüfen Sie die öffentlichen Archive, bevor Sie sie bewerben. Das Linux-Paket muss Chromium-Sandbox-Unterstützung behalten; macOS-Builds sind nicht signiert.
4. Setzen Sie Repository-Variablen `jaunt_RELAY_URL` (aktuelle WSS URL), `jaunt_RELEASE_TAG` (`v0.1.0-beta.10`), `jaunt_ANDROID_RELEASE_TAG` (`android-v0.1.0-beta.7`), `jaunt_DESKTOP_RELEASE_TAG` (`desktop-v0.1.0-beta.9`) und optional `jaunt_PAGE_URL` (Standards für die Repository-Seiten-URL).
5. Seiten im GitHub-Aktionsmodus aktivieren. `pages.yml` erstellt die Web-App, validiert die Konfiguration, kopiert das Installationsprogramm und veröffentlicht es.
6. Führen Sie keine Seiten mit einem nicht vorhandenen Release aus. Die Bereitstellungsaufforderung erfordert diesen Auftrag.

## Erforderliche Fernakzeptanzprüfung

Auf a Linux Maschine ohne exponierten ankommenden Port: von der veröffentlichten Seite installieren, die QR Code in Chrome Android, erstellen Sie eine shellFühren Sie einen Befehl aus, laden Sie eine Datei hoch und laden Sie sie herunter, fügen Sie ein Bild ein, testen Sie beide Bildmodi nach Host-Fähigkeiten, schließen / öffnen Sie die PWASchalter Wi-Fi/mobile Netzwerke, Rückkehr zum gleichen shell ohne a QR Code, Test-Push mit gesperrtem Bildschirm und Rücknahme des Geräts. macOS Firefox/Safari, wenn verfügbar.

Der enthaltene lokale Bericht beweist nicht allein die Cloudflare-Konnektivität oder das Verhalten von physischen Telefonen.

## Veröffentlichung und Vorhaben

Führen Sie technische Protokolle ohne Nutzlasten, überwachen Sie Fehler und Quoten, planen Sie Identitätsrotation und private Host-State-Backups und verwandeln Sie das Relais nicht in Dateispeicherung. Worker-Updates können Verbindungen unterbrechen; Hosts und Clients müssen sich wieder verbinden, ohne erneut gepaart zu werden.

Primärquellen: [Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [uv installation](https://docs.astral.sh/uv/getting-started/installation/)].]

## Früherer Einsatz, 14.–15. September 2026

Siehe [den aktuellen Lieferbericht](SESSION_CONTROLS_VALIDATION.md) für nachfolgende Veröffentlichungen und beobachtete Annahmeergebnisse].

Seiten: https://moukrea.github.io/jaunt/ ; Relais: `wss://jaunt-relay.moukrea.workers.dev` ; Host-Release: `v0.1.0-beta.9` ; APK: `android-v0.1.0-beta.5`.

Der Worker wurde unter Verwendung des vom Eigentümer autorisierten Wrangler OAuth bereitgestellt, lokal mit Verschlüsselung und einem Schlüssel im Systemschlüsselring gespeichert. `CLOUDFLARE_ACCOUNT_ID` wird gesetzt in GitHub; ein zukünftiger Relaiseinsatz durch Aktionen braucht seine eigenen `CLOUDFLARE_API_TOKEN`Kein temporäres OAuth-Token wurde in ein permanentes API-Geheimnis kopiert. Cloudflare oder GitHub siehe [VALIDATION.md]](VALIDATION.md) für beobachtete Ergebnisse und deren Grenzen.
