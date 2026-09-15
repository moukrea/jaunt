[English](../../../DEPLOYMENT.md) · [fr](../../fr/docs/DEPLOYMENT.md) · [es](../../es/docs/DEPLOYMENT.md) · [it](DEPLOYMENT.md) · [pt](../../pt/docs/DEPLOYMENT.md) · [de](../../de/docs/DEPLOYMENT.md)

# Distribuzione Maintainer

Gli utenti finali installano solo l'host. Il proprietario del progetto ** distribuisce questi due componenti una volta:

1. Pagine GitHub: HTML, JavaScript, CSS, logo, installer e configurazione pubblica.
2. Cloudflare Worker con un SQLite Durable Object: WebSocket relay. Non sostituirlo con un processo di looping GitHub Actions, un tunnel personale o server pubblici di un altro progetto.

## Preparazione

Conservare il repository esistente su un ramo di backup, quindi integrare i file su un ramo di lavoro. Non sovrascrivere la storia o forza-push. Python e Node 22+, poi correre `pip install -e . -r requirements-dev.txt`, `npm ci`, `npm run prepare-web`. Le copie di compilazione jsQR 1.4.0 e la sua licenza localmente e genera una versioned PWA cache. Impedire il risolutamente risolto `package-lock.json` e rivedere le licenze; mai inventare un file di blocco.

Gli strumenti di distribuzione vengono individuati e il file di blocco risolto viene commesso. I overrides affilati/undici affrontano i consulenti noti nella dipendenza di prova Miniflare 4; vedi [VALIDATION.md](VALIDATION.md).

## Relè

- Creare o selezionare un account Cloudflare autorizzato per i lavoratori e gli oggetti durevoli SQLite.
- Autorizza l'agente a distribuire o impostare Segreti di Azioni `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` attraverso l'interfaccia sicura di GitHub.
- `relay.yml` esegue Wrangler con `relay/wrangler.jsonc`: nome iniziale `jaunt-relay`, binding `ROOMS`, classe `Room`, migrazione SQLite `v1`.
- APP_ORIGIN deve essere `https://moukrea.github.io` (l'origine, senza `/jaunt/`). Non utilizzare `*` in produzione. `config.json` deve contenere l'URL WSS effettivo del Worker, senza un percorso `/v1/room/...` allegato; il client costruisce tale percorso.
- Verificare `/health`, quindi **l'accoppiamento reale e un comando crittografato**. Una risposta sanitaria HTTP 200 non convalida WebSockets.

## Host, desktop e versioni Android, quindi Pagine

1. Passare CI. Creare il tag host, attualmente `v0.1.0-beta.10` (Python versione `0.1.0b10`). Il flusso di lavoro di rilascio costruisce la ruota e la pubblica con `host-manifest.json` e `SHA256SUMS`. Le versioni Beta sono contrassegnate esplicitamente come prereleases.
2. Per Android, pubblicare il tag, attualmente `android-v0.1.0-beta.7`, con il suo firmato APK, `SIGNING-CERTIFICATE.txt`, e `SHA256SUMS`; verificare i beni pubblici.
3. Pubblicare `desktop-v0.1.0-beta.9`: archivi Linux x64/ARM64, pacchetti deb/rpm, pacchetti macOS x64/ARM64 zip/dmg, e `SHA256SUMS`. Verificare gli archivi pubblici prima di pubblicizzarli. Il pacchetto Linux deve mantenere il supporto della sandbox Chromium; macOS.
4. Impostare le variabili di repository `jaunt_RELAY_URL` (effettivo URL WSS), `jaunt_RELEASE_TAG` (`v0.1.0-beta.10`), `jaunt_ANDROID_RELEASE_TAG` (`android-v0.1.0-beta.7`), `jaunt_DESKTOP_RELEASE_TAG` (`desktop-v0.1.0-beta.9`), e facoltativamente `jaunt_PAGE_URL` (definisce l'UR di pagina del repository).
5. Attivare Pagine in GitHub Modalità azioni. `pages.yml` costruisce l'app web, convalida la configurazione, copia l'installatore e la pubblica.
6. Non eseguire Pages con un rilascio non esistente. Il prompt di distribuzione richiede questo ordine.

## Prova di accettazione remota richiesta

Su una Linux macchina senza una porta in arrivo esposta: installare dalla pagina pubblicata, eseguire la scansione QR codice in Chrome Android, creare un shell, eseguire un comando, caricare e scaricare un file, incollare un'immagine, testare entrambe le modalità di immagine in base alle funzionalità host, chiudere/riaprire PWA, interruttore Wi-Fireti /mobile, ritorno alla stessa shell senza QR codice, test push con lo schermo bloccato e revocare il dispositivo. Ripetere il percorso minimo macOS e Firefox/Safari quando disponibile.

Non contrassegnare mai un test ineseguito come convalidato. Il rapporto locale incluso non dimostra di per sé la connettivitÃ Cloudflare di produzione o il comportamento del telefono fisico.

## Pubblicazioni e operazioni

Mantenere registri tecnici senza carichi di pagamento, monitorare gli errori e le quote, pianificare la rotazione dell'identità e backup host-state privati, e non trasformare il relè in archiviazione di file.

Fonti primarie: [Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/), [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [uv install](https://docs.astral.sh/uv/getting-started/installation/)].

## Prima implementazione, 14-15 settembre 2026

Vedi [l'attuale rapporto di consegna](SESSION_CONTROLS_VALIDATION.md) per le versioni successive e i risultati di accettazione osservati.

Pagine: https://moukrea.github.io/jaunt/ ; relè: `wss://jaunt-relay.moukrea.workers.dev` ; rilascio dell'host: `v0.1.0-beta.9` ; APK: `android-v0.1.0-beta.5`.

Il Worker è stato distribuito utilizzando Wrangler OAuth, proprietario autorizzato, memorizzato localmente con crittografia e una chiave nel keyring di sistema. `CLOUDFLARE_ACCOUNT_ID` è impostato in GitHub; un futuro dispiegamento di relè attraverso Azioni avrà bisogno di una propria `CLOUDFLARE_API_TOKEN`. Nessun token OAuth temporaneo è stato copiato in un segreto API permanente. Cloudflare o GitHub Azione. Vedi [VALIDATION.md](VALIDATION.md) per i risultati osservati e le loro limitazioni.
