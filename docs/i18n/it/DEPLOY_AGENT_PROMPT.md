[English](../../../DEPLOY_AGENT_PROMPT.md) · [fr](../fr/DEPLOY_AGENT_PROMPT.md) · [es](../es/DEPLOY_AGENT_PROMPT.md) · [it](DEPLOY_AGENT_PROMPT.md) · [pt](../pt/DEPLOY_AGENT_PROMPT.md) · [de](../de/DEPLOY_AGENT_PROMPT.md)

# Richiesta di consegna — jaunt

Hai autorizzato l'accesso GitHub a `moukrea/jaunt`. Integrare e distribuire il progetto in questo archivio. Non leggere la vecchia implementazione per l'ispirazione: questo progetto è una riscrittura. Conservare lo stato precedente su un ramo di backup, quindi lavorare attraverso un ramo e PR. Non forza-push o cancellare la storia.

Il requisito non negoziabile è l'accesso reale all'arbitrario shells attraverso un UI mobile/desktop, non solo Claude/Codex agenti. Installazione host a un comando, no VPN/Tailscale o configurazione server per gli utenti finali. QR codice, tasti persistenti, modifiche di rete senza abbinare di nuovo, file, immagini, appunti, sessioni multiple e notifiche.

## Esecuzione

1. Read README.md, SECURITY.md, docs/VALIDATION.md, and docs/DEPLOYMENT.md; ispezionare il codice consegnato. Non riscrivere i componenti di lavoro semplicemente per semplificarli. Non nascondere i limiti documentati.
2. Installare dipendenze di compilazione/test e generare e commettere un vero e proprio pacchetto-lock.json. Controllare le versioni attuali e i consulenti di sicurezza. `npm run prepare-web` deve produrre una copia jsQR locale e la sua licenza. Nessun runtime JavaScript da un CDN. Verificare ogni importazione e risorsa sotto il percorso `/jaunt/` pubblicato.
3. Eseguire pytest, relè Node test, veri test Miniflare, check_project, build_release e browser E2E. Leggere i guasti e correggere le loro cause; non rimuovere mai solo le affermazioni o le caratteristiche.
4. Distribuire il lavoratore con l'autorizzazione Cloudflare I segreti richiesti sono CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID. Se Cloudflare l'autorizzazione non è disponibile, richiedere SOLO che l'autorizzazione mancante attraverso il meccanismo sicuro appropriato e spiegare che un GitHub token non lo concede, mai inventare un URL o prendere in prestito il relè pubblico di un altro progetto.
5. Configurare APP_ORIGIN, verificare la salute E reale WebSockets, quindi impostare jaunt_RELAY_URL in GitHub. Pubblicare il tag/release host e i suoi tre beni prima di Pages. Impostare jaunt_RELEASE_TAG e abilitare Pagine attraverso Azioni.
6. Verificare il checksum, il servizio utente, l'avvio e il codice QR. Verificare gli aggiornamenti di identità e il rifiuto di uccidere silenziosamente il normale shells. Distruggerli deve continuare a richiedere l'autorizzazione di riavvio esplicita.
7. Eseguire il flusso di accettazione end-to-end: pagina pubblica → accoppiamento → shell → comando con uscita comprovata → nuova scheda → ritorno al primo shell → immagine/text upload → download con il confronto byte → relay/network interruzione → stessa sessione senza una nuova QR → revoca. Su un telefono fisico autorizzato, macchina fotografica di prova QR scansione, tastiera, galleria, rotazione, Wi-Fi/cambio mobile, PWA, e spingere con lo schermo bloccato. Mai pretendere di aver usato un telefono se nessuno è disponibile.
8. Conservare la distinzione tra upload-plus-path senza Enter e pasta nativa condizionale. Non rivendicare un attacco Claude/Codex quando solo un percorso è stato inserito.
9. Non pubblicare mai registri host.json, .dev-state, secrets, codici QR, esportazioni di volte o registri privati terminal. Ispezionare contenuti ZIP/release e flussi di lavoro prima della pubblicazione. Non eseguire scansioni distruttive sulle directory personali dell'utente per i test.
10. Fornire l'URL pubblicato, il comando di installazione convalidato, il tag/release, il rapporto di prova e le limitazioni non valide. Non consegnare oltre 40 attività manuali. L'implementazione del proprietario avviene una volta; gli utenti finali non devono aver bisogno di account Cloudflare/GitHub per connettersi.

## Blocchi di pubblicazione

Un relè non configurato, falsamente ha rivendicato la pasta dell'immagine, non funzionale creato shell, test di passaggio artificialmente, importazione JS mancante, rilascio inventato/URL, o la pubblicazione del blocco dei segreti del repository. La sicurezza del protocollo non è stata controllata: mantenere quella divulgazione anche quando tutti i test passano.
