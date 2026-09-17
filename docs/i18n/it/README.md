[English](../../../README.md) · [fr](../fr/README.md) · [es](../es/README.md) · [it](README.md) · [pt](../pt/README.md) · [de](../de/README.md)

# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

**Le tue macchine, le tue shell, i tuoi file. Su ogni schermo.**

jaunt collega i dispositivi che porti con te alle macchine su cui lavori. Installi un piccolo host su ogni macchina Linux o macOS, associ una sola volta il telefono, il portatile o il desktop, e ognuno di essi mostra lo stesso spazio di lavoro: shell vere in PTY veri, i file che stanno accanto e le sessioni che hai lasciato in esecuzione. Puoi aprire, rinominare, dividere, riordinare, chiudere o terminare le shell di qualsiasi host da qualsiasi dispositivo; con le *sessioni aperte condivise* attive, le stesse schede, gli stessi riquadri e la stessa shell attiva ti seguono da uno schermo all'altro. Claude Code e Codex girano lì come qualsiasi altro programma e, quando entrambi sono installati su un host, un solo interruttore permette alle loro sessioni sullo stesso progetto di conoscersi e scambiarsi messaggi. I client sono tre: un browser (installabile anche come PWA), un'app Android nativa e un'app desktop nativa; tutti e tre offrono la stessa interfaccia. Le connessioni partono dall'host verso l'esterno attraverso un relay, cifrate end-to-end, senza porte aperte, senza VPN e senza account.

**Host: 0.1.0-beta.29 · Desktop: 0.1.0-beta.23 · Android: 0.1.0-beta.21.** [Apri jaunt](https://moukrea.github.io/jaunt/). La pubblicazione e la validazione delle release sono tracciate nel rapporto di validazione. Il protocollo **non ha ricevuto un audit di sicurezza indipendente**. Consulta l'[ultimo rapporto di validazione](docs/SEAMLESS_WORKSPACE_VALIDATION.md) per i risultati dei test osservati e le limitazioni non validate.

## Installare l'host

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Supporta Linux, macOS e WSL. Richiede `curl`. L'installer usa un runtime Python 3.11–3.14 compatibile oppure installa un runtime Python privato tramite uv. L'host si installa senza privilegi di amministratore. Su Ubuntu con i namespace utente limitati, l'app desktop opzionale usa il gestore di pacchetti di sistema e può chiedere la password di amministratore per configurare la propria sandbox. L'installer verifica lo SHA-256 della release, crea un ambiente privato e avvia un servizio utente quando disponibile. Gli aggiornamenti automatici sono attivi. Gli host compatibili conservano i processi shell durante la sostituzione del runtime e attendono il completamento dei trasferimenti.

Su Android, [installa l'APK firmato](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.21/jaunt-android-v0.1.0-beta.21.apk), poi scansiona il codice QR mostrato dall'host. Da un desktop o da un browser, apri **https://moukrea.github.io/jaunt/**. In alternativa puoi incollare la stringa di associazione `jaunt1.…`. Il codice QR scade dopo dieci minuti e può essere usato una sola volta. Ogni dispositivo memorizzato usa poi la propria chiave, quindi passare dal Wi-Fi alla rete mobile o viceversa non richiede una nuova associazione. Tieni la scheda aperta per la riconnessione automatica; riapri l'app se il sistema operativo mobile la sospende o la termina.

```sh
jaunt gui                        # Open/install the native desktop workspace
jaunt pair                       # Pair another device
jaunt service install            # Install and enable the user service
jaunt status                     # Host and shell status
jaunt update                     # Check for an update without closing shells
jaunt doctor                     # Diagnostics without exposing secrets
jaunt devices                    # List authorized devices
jaunt revoke -- DEVICE_ID           # Revoke a lost device
jaunt notify "Build finished"     # Notify connected devices
jaunt run -- make test            # Notify when a command finishes
jaunt clipboard < notes.txt      # Make text available to the client
jaunt stop                       # Stop the host AND its non-tmux shells
```

L'associazione concede l'accesso come **account di sistema che esegue l'host**, con tutti i permessi di quell'account. Non eseguirlo come root per l'uso ordinario. Un codice QR dà accesso alla shell: non pubblicarlo mai.

## Funzionalità

| Area | Comportamento |
|---|---|
| Host | Associa tutte le macchine Linux/macOS che vuoi; ognuna mantiene le proprie sessioni, i propri file, le proprie impostazioni e il proprio nome descrittivo; passa dall'una all'altra da un'unica barra laterale; host predefinito e ordinamento |
| Terminali | PTY veri con la tua shell, tastiera interattiva, schede, creazione/rinomina/apertura/scollegamento/terminazione, trascinamento per riordinare, riquadri divisi (affiancati o impilati), dimensioni condivise, tasti Ctrl/Alt/Esc/Tab/frecce su mobile, casella di composizione per gli input lunghi |
| Sessioni aperte condivise | Per host: ogni client e l'host stesso mostrano le stesse schede, gli stessi riquadri, lo stesso ordine e la stessa shell attiva; modalità opzionale "esistono solo le sessioni visualizzate" |
| Riconnessione | Cronologia limitata, riconnessione automatica, stato memorizzato; una disconnessione del browser non chiude la shell; le shell sopravvivono agli aggiornamenti in loco dell'host |
| Sessioni tmux esistenti | Le sessioni tmux preesistenti restano supportate; le nuove sessioni create dall'interfaccia sono normali shell condivise |
| File | Navigazione, file nascosti, paginazione, creazione di directory, rinomina, eliminazione non ricorsiva, upload/download, anteprime di testo e immagini |
| Trasferimenti | Avanzamento visibile e risultati di successo/errore conservati; tracciamento dettagliato in File → Attività di trasferimento; blocchi da 48 KiB, ripresa dagli offset di rete, SHA-256 degli upload, finalizzazione atomica, annullamento |
| Immagini | Galleria, selettore di file, incolla e trascinamento; conversione in PNG per i formati decodificabili dal browser; inserimento del percorso o incolla nativo condizionale |
| Appunti | Selezione, copia dello scrollback conservato, lettura/scrittura degli appunti dell'host quando disponibili, buffer di testo per host headless, OSC 52 in sola copia |
| Claude Code ↔ Codex | Un interruttore per host: le sessioni sullo stesso progetto si scoprono a vicenda tramite i loro hook e possono inviare messaggi alla conversazione aperta dell'altra; disattivandolo si rimuove tutto ciò che jaunt ha aggiunto |
| Protezione | Codici QR monouso, chiavi per dispositivo, revoca, cassaforte del browser opzionale protetta da PIN/password e blocco automatico |
| Notifiche | Servizio Android nativo opzionale o Web Push del browser; campanelli del terminale, eventi dei programmi, uscita di sessione, test nelle Impostazioni e CLI `notify`/`run` |
| Interfaccia | App native desktop e Android con un'interfaccia comune inclusa nel pacchetto; client browser e PWA; sei lingue; temi scuro, chiaro, di sistema e circadiano |
| Aggiornamenti | L'host si sostituisce in loco senza chiudere le shell; l'app desktop e l'APK controllano, verificano e installano da sé i propri aggiornamenti |

## Solo client desktop

Per connettersi ad altri host senza installare un servizio host locale o la CLI jaunt:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash -s -- --client-only'
```

Questo comando installa la stessa applicazione desktop e lo stesso launcher, con associazione remota, sessioni, file, notifiche e aggiornamenti automatici dell'app. Non avvia alcun demone e non mostra i controlli dell'host locale. Non disinstalla un host installato in precedenza. Per abilitare in seguito l'integrazione con l'host locale, esegui il normale comando di installazione dell'host.

L'applicazione browser installata si chiama **jaunt (PWA)** per distinguerla dall'app nativa **jaunt**. Entrambe usano il logo trasparente originale. Android nativo usa la stessa grafica senza sfondo scuro incorporato; i singoli launcher possono applicare il proprio trattamento all'icona.

## Spazio di lavoro desktop condiviso

Apri **jaunt** dal menu delle applicazioni dell'host oppure esegui `jaunt gui`. L'host e i client remoti condividono le stesse shell ordinarie, senza tmux. **Nuova shell** apre subito una shell con nome automatico, che eredita la directory corrente della shell attiva precedente. Il pulsante cartella permette di sfogliare le directory dell'host e, se vuoi, di dare un nome alla nuova shell. **Sessioni** elenca le sessioni in esecuzione e quelle terminate: apri, rinomina, chiudi solo la tua vista, oppure termina esplicitamente una shell per tutti. Puoi anche rinominare una scheda con un doppio clic sul suo titolo, o fare doppio clic sul titolo di un riquadro. Trascina le schede per riordinarle; selezionare una scheda non ne cambia mai la posizione. Il dispositivo con cui interagisci controlla la dimensione condivisa del terminale.

Le due **icone di divisione** dispongono i riquadri affiancati o uno sopra l'altro sul desktop, usando una sessione nuova o esistente. Ogni riquadro può essere spostato in una scheda propria. Le disposizioni sopravvivono alla riapertura; su mobile le loro sessioni compaiono come schede normali. La barra laterale del desktop può essere ridotta, e la preferenza viene mantenuta. Le Impostazioni comprendono i nomi descrittivi degli host, l'ordinamento e l'host predefinito, i temi scuro/chiaro/di sistema/circadiano e i controlli delle notifiche. Le impostazioni dell'host seguono immediatamente la macchina selezionata, compresi la sua identità e i controlli di aggiornamento. L'app desktop nativa gestisce anche il servizio host locale e si associa ad altri host; i controlli del servizio locale compaiono solo per l'host locale, mentre gli aggiornamenti dell'applicazione desktop restano separati. Consulta la [guida allo spazio di lavoro](docs/WORKSPACE.md) e il [rapporto di validazione](docs/WORKSPACE_VALIDATION.md).

**Bridge Claude Code ↔ Codex.** Quando su un host sono installati sia `claude` che `codex`, le Impostazioni mostrano un interruttore. Se attivato, le sessioni reali di Claude Code e Codex aperte in shell jaunt sullo stesso progetto si conoscono automaticamente (come normale contesto degli hook) e possono inviare messaggi alla conversazione aperta dell'altra, su tua richiesta o di propria iniziativa. È disattivato per impostazione predefinita; disattivandolo si rimuove tutto ciò che jaunt ha aggiunto a entrambi i runtime. Consulta la [guida al bridge](../../../docs/BRIDGE.md).

## Gestione delle immagini

L'avanzamento resta visibile durante l'upload e la consegna tramite appunti o percorso. Le operazioni completate si riducono a un risultato compatto; **Mostra cronologia** conserva i dettagli. L'annullamento di un trasferimento viene mostrato come tale e gli errori restano legati alla propria operazione. Il risultato finale indica esattamente cosa è successo; gli errori restano visibili con un'azione di nuovo tentativo. Un inserimento del percorso o una consegna con Ctrl+V andati a buon fine non dimostrano che Claude Code o Codex abbiano riconosciuto un allegato.

**Incolla:** quando è disponibile un backend nativo, l'immagine viene caricata negli appunti dell'host e incollata nella sessione selezionata con Ctrl+V. Se il browser restituisce appunti vuoti, l'interfaccia offre un'area di incolla avanzata e un selettore di immagini. Allega mantiene entrambe le modalità esplicite. Non viene inviato alcun tasto Invio.

**Ripiego con connessione attiva:** seleziona o incolla un'immagine, caricala sull'host e inserisci nel terminale il suo percorso correttamente protetto dall'escape. Nulla invia il comando in automatico. Claude, Codex o un altro strumento possono leggere il file se la loro modalità lo consente.

**Incolla nativo condizionale:** quando l'host dispone di appunti grafici accessibili (macOS, Wayland con `wl-clipboard` o X11 con `xclip`), jaunt vi deposita il PNG e invia Ctrl+V al terminale. Il risultato dipende anche dalla scorciatoia e dal comportamento dello strumento CLI. **Su un host headless, jaunt non può fabbricare un allegato nativo di Claude/Codex: ripiega su un file e sul suo percorso.** HEIC e gli altri formati che il browser non sa decodificare possono comunque essere trasferiti come file, ma non vengono convertiti in PNG.

## Aggiornamenti automatici

| Componente | Comportamento di aggiornamento |
|---|---|
| Host / CLI | Stessa installazione. Controlla il canale pubblicato ogni 15 minuti, verifica i download e sostituisce i runtime compatibili senza chiudere i processi shell. I trasferimenti vengono prima completati. Le Impostazioni o `jaunt update` eseguono subito un controllo. Gli host più vecchi, privi del passaggio di consegne del runtime, rinviano l'aggiornamento finché ci sono shell ordinarie attive; chiudere quelle shell richiede comunque una conferma esplicita. |
| App desktop | Versione separata da quella dell'host. Controlla, scarica e verifica automaticamente un aggiornamento; lo installa alla chiusura dell'app. Le Impostazioni offrono un controllo manuale, un interruttore per l'aggiornamento automatico e **Installa e riapri**. Aggiornare la GUI non ferma l'host né le sue shell. I pacchetti di sistema possono richiedere l'autorizzazione del sistema operativo. |
| APK Android | Controlla automaticamente la presenza di un nuovo APK. Una finestra visibile di controllo/download porta alla conferma di installazione di Android. Vengono verificati il checksum e il certificato di firma dell'APK; Android non consente l'auto-installazione silenziosa. |
| Client web | Usa la versione pubblicata su Pages. Riapri o ricarica la pagina per attivare un aggiornamento del service worker già scaricato. |

Le installazioni esistenti hanno bisogno della release che contiene il loro updater prima che questo possa funzionare. Rieseguire il comando ufficiale di installazione dell'host aggiorna l'host e installa l'app desktop annunciata; si rifiuta di chiudere in silenzio le shell ordinarie attive. Le chiavi di associazione vengono conservate. Consulta [aggiornamenti e protezione dal riavvio](docs/UPDATES.md).

## Feedback sulla connessione e sulle operazioni

Un'interruzione di rete produce un unico banner di connessione persistente con un'azione di nuovo tentativo. jaunt si riconnette con la chiave di dispositivo salvata; non ritrasmette l'input del terminale non inviato. La revoca e il fallimento della verifica dell'host interrompono la connessione e spiegano il passo successivo. Gli errori di una finestra di dialogo restano in quella finestra; gli altri errori di azione restano visibili finché non vengono chiusi. I brevi toast di conferma sono deduplicati e limitati a due.

Upload, download, installazione del servizio e controlli di aggiornamento mostrano l'avanzamento e un risultato finale in Attività. Le pause di rete sono esplicite, l'annullamento dei trasferimenti è disponibile e la cronologia delle operazioni completate può essere espansa. Gli aggiornamenti disponibili offrono un'azione diretta invece di un toast a scadenza.

## Notifiche

Attiva le notifiche nelle **Impostazioni** e usa la relativa azione di test. Titolo e testo delle notifiche dei programmi vengono conservati quando forniti; un semplice campanello del terminale non ha alcun corpo di messaggio da recuperare. Un clic su una notifica seleziona l'host e la sessione corrispondenti. Le notifiche desktop richiedono che l'app sia in esecuzione; Android usa il suo servizio di connessione in primo piano opzionale; il client web usa il Web Push del browser. Il contenuto delle notifiche può comparire nella schermata di blocco secondo le impostazioni del sistema operativo.

## Limitazioni note

- Fino a 16 shell attive, 32 viste conservate, 2 MiB di replay grezzo per PTY e 10.000 righe di scrollback xterm. Copia tutto copre la cronologia conservata, non un registro illimitato.
- Limite per file sull'host: 512 MiB. I download in memoria sono limitati a 128 MiB nei browser senza scrittura diretta su file; le anteprime sono limitate a 16 MiB. Fino a otto upload simultanei e 1 GiB di dimensione totale dichiarata.
- Gli upload riprendono dopo un'interruzione di rete finché l'host e la pagina conservano il trasferimento. Dopo un riavvio dell'host o un ricaricamento completo della pagina, riavvia l'upload; jaunt non ottiene alcun accesso persistente non autorizzato ai file locali del telefono.
- Le shell ordinarie sopravvivono alla disconnessione e agli aggiornamenti compatibili del runtime, **non a un arresto/riavvio esplicito del demone né a un riavvio della macchina**. tmux può sopravvivere al riavvio del demone, ma non a un riavvio del sistema operativo.
- Una sola scheda dell'applicazione jaunt per profilo del browser può possedere la cassaforte alla volta. Più schede di terminale all'interno di jaunt e più dispositivi sono supportati.
- Le notifiche del browser richiedono il permesso e il supporto di Web Push. Nell'APK, attiva le notifiche in background di Android nelle Impostazioni; le restrizioni sulla batteria di Android possono ritardare la consegna. Su iOS, usa la PWA installata. La consegna dipende dalla rete e dal provider push; non è garantita in tempo reale.
- Un host in sospensione o spento è irraggiungibile. Non sono previsti risveglio remoto, tunnel TCP arbitrari, desktop grafico né supporto per shell Windows native.
- I pacchetti desktop Linux sono disponibili per x64 e ARM64; gli archivi macOS non sono firmati né notarizzati. Non viene fornito alcun pacchetto desktop Windows nativo. Il comportamento su telefoni Android fisici e l'autorizzazione protetta dell'updater su macOS non sono stati validati; i risultati su emulatore sono documentati a parte.
- Costi, quote e disponibilità del relay di produzione dipendono dall'account Cloudflare. Le protezioni di base del relay non sono un servizio commerciale garantito contro gli abusi.

## Sviluppo locale

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm ci
npm run prepare-web
python scripts/dev.py
```

Il runner ascolta solo su `127.0.0.1`, avvia un host e un relay locale e mostra un codice QR di prova. **Questo non espone l'host a Internet.** Su un telefono fisico usa il deployment HTTPS: `localhost` indica il telefono, non il PC.

```sh
pytest -q                        # Python tests and Node interoperability tests
npm test                         # Relay model, protocol/UI helpers and desktop updater
npm run test:relay               # Real Miniflare runtime; npm dependencies required
python scripts/check_project.py  # Resource consistency and syntax
python scripts/build_release.py  # Wheel, manifest, and SHA256SUMS
python tests/browser_e2e.py       # Real browser and host in temporary isolation
python tests/shared_workspace_e2e.py # Electron + browser sharing real PTYs; needs a display
python tests/terminal_render_e2e.py  # Scroll, selection and terminal geometry
python tests/installer_e2e.py        # Real wheel install and protected upgrade
python tests/client_update_e2e.py    # Browser-driven host self-update, pushed progress, refusal of a broken release
python tests/bridge_e2e.py           # Real Claude Code and Codex sessions discover and message each other through the bridge (uses your real accounts)
python tests/workspace_sync_e2e.py   # Shared open sessions between two clients, close-or-terminate choice, displayed-only mode
```

Imposta `jaunt_BROWSER_EXECUTABLE=/path/to/chromium` per usare un browser di sistema. Altrimenti esegui `python -m playwright install chromium`. I test non modificano mai le politiche di sicurezza del browser.

## Deployment iniziale — una sola volta, a cura del proprietario del progetto

Consegna [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md) a un agente con accesso a GitHub. L'agente configura GitHub Pages, una release dell'host e **un solo relay Cloudflare per l'intero progetto**. È necessaria l'autorizzazione Cloudflare; un token GitHub non la fornisce. Gli utenti finali non creano alcuna infrastruttura.

jaunt non prende in prestito i relay di sshx, Happy o Zedra. Non dipende dai loro server, da Tailscale né da un account utente jaunt. L'account Cloudflare del proprietario può comportare quote o costi; non viene promesso alcun relay gratuito o illimitato.

## Documentazione

[Deployment](docs/DEPLOYMENT.md) · [Sicurezza](SECURITY.md) · [Protocollo](docs/PROTOCOL.md) · [Risoluzione dei problemi](docs/TROUBLESHOOTING.md) · [Validazione](docs/VALIDATION.md) · [Note di terze parti](../../../THIRD_PARTY_NOTICES.md)

L'inglese è la lingua canonica della documentazione. Traduzioni: [Français](../fr/README.md), [Español](../es/README.md), [Italiano](README.md), [Português](../pt/README.md), [Deutsch](../de/README.md). Ogni albero tradotto include le guide di sicurezza, deployment e validazione.

Web, Android e desktop selezionano automaticamente la lingua di sistema. Puoi cambiarla in **Impostazioni → Lingua**. La CLI usa la locale di sistema; `jaunt --language fr --help` la sovrascrive per una singola invocazione e `jaunt language fr` salva la preferenza. Usa `system` per ripristinare la selezione automatica. Nomi dei comandi, argomenti, output del terminale e contenuti dell'utente non vengono mai tradotti.

L'indirizzo web pubblico presenta il progetto; **Apri spazio di lavoro** entra nel client. Le app native aprono direttamente lo spazio di lavoro.

## App Android

Il client Android è un APK con un'interfaccia WebView inclusa e integrazioni native per appunti, fotocamera, file e notifiche in background. Consulta [installazione, architettura e validazione Android](docs/ANDROID.md). La pagina annuncia l'APK dopo la verifica dei suoi asset pubblici.

L'APK è un pacchetto Android nativo con WebView incluso, non un'installazione PWA. L'interfaccia e la tipografia sono condivise con le app web e desktop; l'integrazione nativa fornisce fotocamera, appunti, selezione dei file e notifiche. Per i requisiti di conferma dell'installazione, vedi la tabella degli aggiornamenti qui sopra.
