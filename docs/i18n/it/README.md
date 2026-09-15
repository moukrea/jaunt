[English](../../../README.md) · [fr](../fr/README.md) · [es](../es/README.md) · [it](README.md) · [pt](../pt/README.md) · [de](../de/README.md)

# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

Il tuo shells, i tuoi file, la tua macchina, dal tuo telefono.

jaunt fornisce applicazioni desktop nativo e Android, un client web mobile/desktop e un host POSIX. Si collega a terminali reali, tra cui arbitrary shells, Claude Code e Codex. L'applicazione web statica utilizza un relè condiviso per effettuare connessioni di uscita crittografate dall'host e dal client.

**Host: 0.1.0-beta.11 · Desktop: 0.1.0-beta.10 · Android: 0.1.0-beta.8.** [Apri jaunt](https://moukrea.github.io/jaunt/). Pubblicazione e validazione del rilascio sono tracciati nel rapporto di convalida. Il protocollo non ha ricevuto un controllo di sicurezza indipendente**.](docs/SEAMLESS_WORKSPACE_VALIDATION.md) per i risultati dei test osservati e le limitazioni non valutate.

## Installare l'host

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Supporti Linux, macOS, e WSL. Richiede `curl`. L'installatore utilizza un compatibile Python 3.11–3.14 runtime o installa un privato Python runtime through uv. L'host installa senza privilegi di amministratore. Ubuntu con spazi di nome utente ristretti, l'app desktop opzionale utilizza l'installatore del pacchetto di sistema e può richiedere una password di amministratore per configurare la sua sandbox. SHA-256, crea un ambiente privato, e avvia un servizio utente quando disponibile. Gli aggiornamenti automatici sono abilitati. shell processi durante la sostituzione di runtime e attendere i trasferimenti per terminare.

Su Android, [installare il firmato APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.8/jaunt-android-v0.1.0-beta.8.apk), poi la scansione QR codice visualizzato dall'host. Su un desktop o in un browser, aperto **https://moukrea.github.io/jaunt/**. È anche possibile incollare il `jaunt1.…` accoppiamento stringa. QR codice scade dopo dieci minuti e può essere utilizzato solo una volta. Ogni dispositivo ricordato poi utilizza la propria chiave, in modo da commutazione Wi-Fi Mantenere la scheda aperta per la riconnessione automatica; riaprire l'applicazione se il sistema operativo mobile sospende o lo uccide.

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

L'accoppiamento garantisce l'accesso come account di sistema ** che esegue l'host**, con tutte le autorizzazioni di tale account. Non eseguire come root per l'uso ordinario. Un codice QR garantisce l'accesso shell: non pubblicarlo mai.

## Caratteristiche

| Area | Comportamento |
|---|---|
| Terminals | Real PTYs, tastiera interattiva, schede multiple, creare/rinominare/aperto/detach/terminato, dimensionamento condiviso, mobile Ctrl/Alt/Esc/Tab/arrow keys |
| Reconnection | Storia ricca, ricollegamento automatico, stato ricordato; una disconnessione del browser non chiude shell |
| Le sessioni esistenti tmux | Le sessioni Legacy tmux rimangono supportate; le nuove sessioni dell'interfaccia utente sono comuni ordinarie shells |
| File | Browsing, file nascosti, paginazione, creare directory, rinominare, cancellazione non ricorsiva, upload/download, anteprime di testo/immagine |
| Trasferimenti | Progressi visibili e risultati di successo/error conservati; tracciamento dettagliato in File → Attività di trasferimento; 48 blocchi KiB, offset del curriculum di rete, upload SHA-256, finalizzazione atomica, cancellazione |
| Immagini | Gallery, raccoglitore di file, pasta e drag-and-drop; conversione PNG per i formati di browser-deciso; inserimento del percorso o pasta nativa condizionale |
| Clipboard | Selezione, copia di scorrimento conservata, clipboard host lettura/scrittura quando disponibile, buffer di testo senza testa, copia solo OSC 52 |
| Protezione | Codici QR ad uso singolo, chiavi per dispositivo, revoca, opzione PIN/password-protetto browser volta e blocco automatico |
| Notifiche | Servizio nativo opzionale Android o browser Web Push; Campane terminal, eventi di programma, uscita sessione, test delle impostazioni e CLI `notify`/`run` |
| Interface | desktop nativo e applicazioni Android con un'interfaccia condivisa in bundle; client browser; locale JavaScript |

## Solo client desktop

Per connettersi ad altri host senza installare un servizio host locale o jaunt CLI:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash -s -- --client-only'
```

Questo installa la stessa applicazione desktop e launcher, con l'accoppiamento remoto, le sessioni, i file, le notifiche e gli aggiornamenti automatici delle app. Non avvia un daemon o mostra i controlli degli host locali. Non disinstalla un host precedentemente installato. Eseguire il normale comando di installazione host per abilitare l'integrazione host locale in seguito.

L'applicazione del browser installato è denominata **jaunt (PWA** così si può distinguere dal nativo **jaunt** app. Entrambi usano il logo trasparente originale. Native Android utilizza la stessa opera d'arte senza uno sfondo scuro in bundle; i singoli lanciatori possono applicare il proprio trattamento icona.

## Spazio di lavoro desktop condiviso

Aprite!jaunt** dal menu delle applicazioni dell'host o eseguire `jaunt gui`. I client host e remoti condividono lo stesso ordinario shells senza tmux.**Nuovo shell** apre un nome automatico shell immediatamente, ereditando il precedente attivo shelldirectory corrente. Il pulsante della cartella consente di sfogliare le directory dell'host e di nominare facoltativamente il nuovo shell. **Sessions** elenca le sessioni in esecuzione e in uscita: aprire, rinominare, chiudere solo la vista, o terminare esplicitamente una shell Puoi anche rinominare una scheda facendo doppio clic sul suo titolo, oppure fare doppio clic sul titolo di un pannello. Trascina le schede per riordinarle; selezionando una scheda non cambia mai la sua posizione. Il dispositivo che interagisci con i controlli condivisi terminal taglia.

Le due icone **split** organizzano i riquadri fianco a fianco o sopra/sotto sul desktop, utilizzando una nuova o esistente sessione. Ogni riquadro può muoversi nella propria scheda. I layout sopravvivono alla riapertura; il cellulare visualizza le sessioni come schede normali. La barra laterale del desktop può crollare, con la preferenza mantenuta.](docs/WORKSPACE.md) e [relazione di valutazione](docs/WORKSPACE_VALIDATION.md).

## Movimentazione immagine

Le operazioni completate crollano in un risultato compatto; **Mostra la storia** conserva i dettagli. L'annullamento di un trasferimento viene mostrato come cancellazione e gli errori rimangono con il loro funzionamento. Il risultato finale afferma esattamente ciò che è accaduto; gli errori rimangono visibili con un'azione di riprovazione. Ctrl+V la consegna non dimostra che Claude Code o Codex ha riconosciuto un attaccamento.

**Paste:** quando è disponibile un backend nativo, un'immagine viene caricata sul clipboard host e incollata nella sessione selezionata con Ctrl+V. Se il browser restituisce un clipboard vuoto, l'interfaccia utente offre un'area ricca di pasta e un raccoglitore di immagini. Attach mantiene entrambe le modalità esplicite. Enter La chiave e' inviata.

**Fallback con una connessione attiva:** selezionare o incollare un'immagine, caricarla sull'host e inserire il suo percorso correttamente evaso nella terminal. Nulla invia automaticamente il comando. Claude, Codex, o un altro strumento può leggere il file se la sua modalità supporta.

**Condizionale pasta nativa:** quando l'host ha un clipboard grafico accessibile (macOS♪, Wayland with `wl-clipboard`, o X11 con `xclip`), jaunt mette il PNG lì e invia Ctrl+V al terminal. Questo dipende anche dal CLI La scorciatoia e il comportamento dello strumento. jaunt non può produrre un nativo Claude/Codex ** HEIC e altri formati che il browser non può decodificare possono ancora essere trasferiti come file, ma non sono convertiti in PNG.

## Aggiornamenti automatici

| Component | Comportamento di aggiornamento |
|---|---|
| Host / CLI | Stessa installazione. Controlla il canale pubblicato ogni 15 minuti, verifica download e sostituisce runtime compatibili senza terminare shell processi. Trasferimenti finire prima. Impostazioni o `jaunt update` assegni immediatamente. I padroni di casa più vecchi senza defer magazzino di runtime mentre ordinario shells sono attivi; terminare quelli shells richiede ancora una conferma esplicita.
| Desktop app | Versione separata dall'host. Controlla automaticamente, scarica e verifica un aggiornamento; installa quando si chiude l'app. Impostazioni fornisce un controllo manuale, una attivazione automatica e **Install e riaprire**. Aggiornamento della GUI non arresta l'host o il suo shells. I pacchetti di sistema possono richiedere l'autorizzazione del sistema operativo.
| Android APK | Controllo automatico di una nuova APK. Una finestra di dialogo di controllo/download visibile porta alla conferma dell'installazione di Android. Il controllo e il certificato di firma APK sono verificati; Android non consente l'installazione silenziosa. |
| Web client | Utilizza la versione pubblicata su Pages. Riaprire/ricaricare per attivare un aggiornamento di service-worker scaricato.

Le installazioni esistenti hanno bisogno del rilascio che contiene il loro aggiornamento prima che l'aggiornamento possa essere eseguito. shells. Le chiavi di accoppiamento sono mantenute. Vedi [aggiornamento e riavviare la protezione](docs/UPDATES.md).

## feedback di connessione e funzionamento

Un'interruzione di rete ha un banner di connessione persistente con un'azione di riprovazione. jaunt si ricollega con la chiave del dispositivo salvato; non riproduce un ingresso terminal. La rivocazione e la verifica dell'host non riuscita arrestano la connessione e spiegano il passo successivo. Errori in una finestra di dialogo rimangono visibili altri errori di azione fino a quando non vengono eliminati.

Caricamenti, download, installazione di servizi e controlli di aggiornamento mostrano i progressi e un risultato finale in Attività. Le pause di rete sono esplicite, la cancellazione di trasferimento è disponibile e la storia completa può essere ampliata.

## Notifica

Attiva le notifiche in **Impostazioni** e utilizza la sua azione di prova. I titoli di notifica del programma e il testo vengono conservati quando forniti; una campana terminal non ha un corpo di messaggio da recuperare. Fare clic su una notifica seleziona l'host e la sessione corrispondenti. Le notifiche Desktop richiedono che l'app sia in esecuzione; Android utilizza il suo servizio di connessione prefondo opzionale; il client web utilizza le impostazioni del browser Web Push.

## Limitazioni conosciute

- Fino a 16 shells attivo, 32 visualizzazioni conservate, 2 MiB di replay raw per PTY, e 10.000 linee di scorrimento xterm.
- Limite di file host: 512 MiB. I download in memoria sono limitati a 128 MiB nei browser senza scrittura diretta di file; le anteprime sono limitate a 16 MiB. Fino a otto upload simultanei e 1 GiB di dimensione totale dichiarata.
- Riavviare il caricamento dopo un riavvio dell'host o una ricarica completa della pagina; jaunt non ottiene un accesso persistente non autorizzato ai file locali del telefono.
- Il normale shells sopravvive alla disconnessione e agli aggiornamenti di runtime compatibili, ** non un arresto o riavvio esplicito del daemon **. tmux può sopravvivere a un riavvio del daemon, ma non a un riavvio del sistema operativo.
- Solo una scheda di applicazione jaunt per profilo del browser può possedere la volta alla volta. Sono supportate più schede terminal all'interno di jaunt e più dispositivi.
- Nel APK, abilitare le notifiche di sfondo Android in Impostazioni; le restrizioni della batteria Android possono ritardare la consegna. Su iOS, utilizzare il PWA installato. La consegna dipende dalla rete e dal provider di spinta; non è garantita in tempo reale.
- Non c'è una sveglia remota, un tunnel TCP arbitrario, un desktop grafico o un supporto Windows shell.
- I pacchetti desktop Linux sono disponibili per x64 e ARM64; gli archivi macOS sono non firmati e non nominati. Non è previsto alcun pacchetto desktop Windows. Il comportamento del telefono Android e l'autorizzazione protetta dell'aggiornamento macOS non sono stati convalidati; i risultati dell'emulatore sono documentati separatamente.
- I costi di relè di produzione, le quote e la disponibilità dipendono dal conto Cloudflare. Le garanzie di relè di base non sono un servizio di protezione commerciale garantito.

## Sviluppo locale

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm ci
npm run prepare-web
python scripts/dev.py
```

Il corridore ascolta solo su `127.0.0.1`, avvia un host e relè locale, e visualizza un codice QR test. **Questo non espone l'host a Internet.** Utilizzare la distribuzione HTTPS su un telefono fisico: `localhost` si riferisce al telefono, non al PC.

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
```

Impostare `jaunt_BROWSER_EXECUTABLE=/path/to/chromium` per utilizzare un browser di sistema. Altrimenti eseguire `python -m playwright install chromium`. I test non cambiano mai le politiche di sicurezza del browser.

## Distribuzione iniziale — una volta, dal proprietario del progetto

Date [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md) a un agente con GitHub accesso. Configura GitHub Pagine, un rilascio di host, e ** uno Cloudflare relè per l'intero progetto**. Cloudflare è richiesta l'autorizzazione; GitHub token non lo fornisce. Gli utenti finali non creano infrastrutture.

jaunt non prende in prestito relè da sshx, Happy o Zedra. Non dipende dai loro server, Tailscale, o da un account utente jaunt. L'account Cloudflare del proprietario può incorrere in quote o costi; non viene promesso alcun relè libero o illimitato.

## Documentazione

[Deployment](docs/DEPLOYMENT.md) · [Security](SECURITY.md) · [Protocol](docs/PROTOCOL.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Validation](docs/VALIDATION.md) · [Note di terzi](../../../THIRD_PARTY_NOTICES.md)]

Traduzioni: [Français](../fr/README.md), [Español](../es/README.md), [Italiano](README.md), [Português](../pt/README.md), [Deutsch](../de/README.md).

Web, Android e desktop selezionare la lingua di sistema automaticamente. Override in ** Impostazioni → Lingua**. CLI utilizza il sistema locale; `jaunt --language fr --help` sovrascrive una invocazione e `jaunt language fr` salva la preferenza. `system` ripristinare la selezione automatica. Nomi di comando, argomenti, terminal output e contenuti utente non vengono mai tradotti.

L'indirizzo web pubblico introduce il progetto; **Apri lo spazio di lavoro** entra nel client. Applicazioni native aprono direttamente lo spazio di lavoro.

## App Android

Il client Android è un APK con un'interfaccia WebView in bundle e clipboard nativo, fotocamera, file e integrazioni di notifica di sfondo. Vedi [Android installazione, architettura e validazione](docs/ANDROID.md). La pagina pubblicizza lo APK dopo la verifica dei suoi beni pubblici.

APK è un pacchetto Android nativo con un bundle WebView, non un'installazione PWA. L'interfaccia e la tipografia sono condivise con le applicazioni web e desktop; l'integrazione nativo fornisce fotocamera, appunti, selezione dei file e notifiche.
