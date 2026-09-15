[English](../../../VALIDATION.md) · [fr](../../fr/docs/VALIDATION.md) · [es](../../es/docs/VALIDATION.md) · [it](VALIDATION.md) · [pt](../../pt/docs/VALIDATION.md) · [de](../../de/docs/VALIDATION.md)

# jaunt — consegna convalidata il 14 settembre 2026

Consegna attuale: [controlli di sessione, feedback dei clienti, test di rilascio pubblico e limitazioni](SESSION_CONTROLS_VALIDATION.md). Prima host beta.5 / Android beta.3 consegna: [relazione consolidata storica](PUBLIC_DELIVERY.md). Le sezioni sottostanti conservano osservazioni storiche; poi i rapporti superano i loro conteggi di prova e lo stato specifico della versione.

**Page: https://moukrea.github.io/jaunt/**

**Relay: wsss://jaunt-relay.moukrea.workers.dev**

[v0.1.0-beta.2](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.2)]

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

La forma precedente di questo comando (`curl -fsSL … | bash`) è stata eseguita in una VM Ubuntu pulita senza sorgente modificabile. Vedere [correzioni bootstrap e Fedora testing](INSTALLER_FEDORA.md) per il comando corrente.** Gli utenti finali non creano alcun account GitHub/Cloudflare e non configurano né un server pubblico né un protocollo VPN.

## Storia e pubblicazione

L'archivio è stato integrato senza leggere la vecchia implementazione per l'ispirazione. Original commit `eb71cfe9b80749d3c53f11e428f027b0d64fb372` è conservato su `backup/pre-rewrite-20260914`. PR [8](https://github.com/moukrea/jaunt/pull/8) e [9](https://github.com/moukrea/jaunt/pull/9) sono stati fusi dopo i controlli necessari, senza bypassare protezioni, forza-pushing, o cancellare la storia.

Il proprietario ha concesso Wrangler OAuth attraverso il browser. jaunt Versione Worker `00dd364c-c69c-4e89-8878-00ebd38ca414` usi `ROOMS` / `Room`, migrazione SQLite `v1`, e APP_ORIGIN `https://moukrea.github.io`. Nessun altro relè del progetto è stato utilizzato. HTTP salute, WebSocket autenticazione, routing bidirezionale, ping/pong e rifiuto di un'origine non autorizzata sono stati verificati. shell l'operazione è stata poi testata pubblicamente.

[Beta.2 rilascio](https://github.com/moukrea/jaunt/actions/runs/34855623613): tre beni pubblici (ruota, host-manifest.json, SHA256SUMS) scaricati e verificati prima [Pages](https://github.com/moukrea/jaunt/actions/runs/34855764137). GitHub variabili jaunt_RELAY_URL, jaunt_RELEASE_TAG, jaunt_PAGE_URL Le 25 richieste di risorse della pagina, compresi i moduli JS, le immagini, le licenze jsQR/xterm, l'installatore e il lavoratore di servizio, sono state confrontate con i byte consegnati sotto `/jaunt/`. Nessun runtime JS è venuto da un CDN.

CLOUDFLARE_ACCOUNT_ID è impostato in GitHub; una futura distribuzione di relè Azioni richiede ancora la propria CLOUDFLARE_API_TOKEN. La distribuzione osservata utilizzata OAuth locale, non un token GitHub o un token OAuth copiato come API permanente non comporta.

## Comandi e risultati osservati

Configurazione di sviluppo: `python3 -m venv .venv`, poi `pip install -e . -r requirements-dev.txt pip-audit` e `npm ci`. L'installazione di sviluppo modificabile è separata dal test delle ruote.

| Comando | Risultato
|---|---|
| `npm install`, quindi `npm ci` | Real package-lock.json risolto e commesso; installazione riproducibile |
| `npm run prepare-web` | 20 risorse; jsQR 1.4.0 e Apache licenza copiata localmente |
| `pytest -q` | **36 superato**; reale PTY, interoperabilità Web Crypto, aggiornamento atomico, invio interrotto |
| `npm test` | **17 superato **** |
| `npm run test:relay` | **1 integrazione attiva/Miniflare superato**, SQLite e WebSockets |
| `python scripts/check_project.py` | Passato senza esenzione `--source` |
| `python scripts/build_release.py` | Ruota Beta.2, manifesto e checksum costruiti |
| `python -m playwright install chromium` | Chromium realmente installato |
| `python tests/browser_e2e.py` | **20 scenari passati** in CI con il relè Python |
| `jaunt_E2E_RELAY=workerd python tests/browser_e2e.py` | **20 scenari passati**, localmente e in CI |
| `python tests/installer_e2e.py` | **8 controlli passati** su beta.2, localmente e in CI |
| `jaunt_INSTALLER_ONLINE=1 python tests/installer_e2e.py` | **8 controlli passati** su beta.1, utilizzando uno specchio loopback e dipendenze PyPI in ambienti freschi |
| `npm audit` | **0 vulnerabilità note** nel grafico risolto |
| `pip-audit` | **0 vulnerabilità note**; il pacchetto locale jaunt è assente da PyPI e quindi non coperto

[Beta.2 CI](https://github.com/moukrea/jaunt/actions/runs/34855112550): sette posti di lavoro di successo, tra cui 36 test host in tutto Linux/macOS × Python 3.11/3.13 ed entrambi i set di 20 scenari del browser. `lint` e `test` eseguire controlli reali; quest'ultimo dipende da tutte le suite complete che riescono.

Versioni locali: Python 3.14.2, Node 25.5.0, npm 11.8.0, pytest 9.1.1, Playwright 1.62.0, Chromium 151.0.7922.34. Node 22, Python 3.11/3.13. Host: websockets 16.0, cryptography 50.0.1, qrcode 8.2, pywebpush 2.5.0.Costruire: setuptools 84.0.0, pip 26.2.1, Wrangler 4.131.2, diretto Miniflare 4.20260730.0; Wrangler utilizza anche Miniflare 5.20260911.1-alfa. Miniflare overrides: tagliente 0.35.4 e undici 7.29.0.

Crittografia iniziale/pip e MiniflareI consulenti /sharp/undici sono stati affrontati con aggiornamenti e sovrascritti, poi rivisitati. Fonti: [cryptography](https://github.com/pyca/cryptography/security/advisories)[sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)[indici]](https://github.com/advisories/GHSA-4cwx-7wf7-3272). L'esatta provenienza/versione del fascio xterm fornito rimane limitata come descritto in THIRD_PARTY_NOTICES.md; npm l'audit non copre questo pacchetto.

## Prova di accettazione pubblica su una macchina pulita

QEMU/KVM Ubuntu 24.04 VM, Python 3.12.3, immagine ufficiale verificata contro SHA-256 `612b2c0cc1bc413a6cb8c38fd611794caf0f2b436c50013d8b3794db12ad7354`. Nessun codice sorgente o runtime modificabile è stato installato lì. L'installazione pubblica beta.1 ha prodotto un codice QR e ha abilitato il servizio utente systemd; un riavvio reale ha confermato l'avvio automatico, la connettività relayta e l'identità di servita.

Uno script di accettazione privato ha guidato SSH e Chromium contro la pagina pubblica. Ha eseguito il comando di installazione corrente, `jaunt status`, `jaunt pair --json`, comandi `systemctl --user` e le interazioni UI. I codici QR e l'output privato rimangono al di fuori del repository.

- Accoppiamento pubblico e un canale crittografato autenticato attraverso Cloudflare.
- Arbitrario shell, `printf`/`cat`, e `PUBLIC_jaunt_PROVED` verificati sia in terminal che in un file; seconda scheda e ritorno al primo.
- Multi-chunk Unicode/binary upload e download comparati byte per byte.
- Immagine trasferita e citata percorso inserito senza Enter; un file sentinel ha verificato che nulla viene eseguito automaticamente.
- Ricarica pagina con identità ricordata e nessun nuovo codice QR.
- Interruzione della rete VM in uscita reale tramite una regola temporanea limitata a quella VM e rimossa in un blocco `finally`: stesso shell PID e sessione, con un collaudato comando `RESUMED` dopo la riconnessione senza accoppiamento.
- Aggiornamento pubblico rifiutato con due ordinaria shells attivo; daemon mantenuto.
- Aggiornamento con `jaunt_ALLOW_RESTART=1`: riavvio esplicito, shells terminato, servizio attivo, host/device identità conservate, browser ricollegato.
- Rivocazione disconnesso il browser e disattivata creazione shell.
- Nessuna eccezione del browser non catturato.

Gli undici assegni sono stati registrati in `docs/evidence/public-report.json`, a fianco delle prove di installazione dipendenti e beta.2. A quel punto, `browser-report.json` ha mantenuto il precedente 18-scenario locale eseguito come prova storica; il CI citato ha dimostrato la suite 20-scenario. I file di prova sono stati da allora aggiornati per la consegna successiva descritta in PUBLIC_DELIVERY.md.

## Fallimenti fissi senza rimuovere caratteristiche o affermazioni

- Una risposta directory-list tardiva ha superato il percorso digitato: per-host bozze e richieste revisioni ha risolto; il test ritarda risposte crittografate reali.
- Le tesi leggono il terminal prima della consegna asincrona: il limite aspetta ora controllare l'output effettivo, l'inserimento o l'allegato completato.
- Un controllo Bash separato da shutdown raced con la creazione shell: l'arresto di aggiornamento di demoni atomici chiude l'ammissione.
- I pong di relè mascherati di perdita dell'host: i messaggi di host autenticati vengono monitorati separatamente e attivano la riconnessione. Il test sospende il vero host lasciando il relè in esecuzione.
- Un'eccezione WebSocket durante l'invio ha terminato l'attività di uscita PTY: gli invii interrotti diventano ConnectionError e chiudono il canale. Due regressioni real-PTY non riescono con il vecchio trasporto e passano dopo la correzione, inclusa la riproduzione e l'uscita fresca sullo stesso PID.
- I test senza testa hanno ereditato l'ambiente desktop e i profili personali: le variabili grafiche vengono rimosse e testano l'esecuzione shells senza profili in directory temporanee.
- Uccidere solo il genitore Miniflare ha lasciato il lavoro collegato: l'imbracatura ora interrompe il proprio gruppo di processo isolato.

## Limitazioni e report che devono rimanere visibili

Queste osservazioni descrivono la consegna iniziale beta.2; successivamente la convalida qui sotto e in PUBLIC_DELIVERY.md registra i progressi successivi.

- L'agente non ha usato alcun telefono fisico. L'utente ha segnalato l'accoppiamento cellulare di successo dopo aver dimenticato una voce ricordata; che non convalida fotocamera, tastiera/IME, galleria, rotazione, Wi-Fi/mobile handoff, sospeso PWA, o push a schermo chiuso. L'utente ha anche segnalato guasto Android incolla dello screenshot in Claude Code; tale flusso specifico era ancora oggetto di indagine a questo punto.
- La consegna effettiva del Web Push e la pasta nativa all'interno di Claude/Codex non sono stati convalidati. Un percorso inserito non è un attaccamento nativo; nessun clipboard del sistema operativo è promesso su un host senza testa.
- lanciato, installazione macOS/WSL, bootstrap senza Python, Safari/Firefox, tmux reale, carico sostenuto, quote di relè/costi, e SLA non sono stati convalidati in questa prima esecuzione.
- Il protocollo, l'host, il frontend e il relè non hanno alcun controllo indipendente.

## Artefatti e privacy

Le tre risorse di ogni release sono state scaricate, i checksum verificati e i contenuti delle ruote ispezionati. Gitleaks 8.30.1 non ha trovato perdite nelle ruote. L'istantanea iniziale ha prodotto una recensione falsa positiva: xterm's JavaScript FourKeyMap/TwoKeyMap inizializzazione. I controlli coprono il progetto e i suoi dispositivi, scansioni mai distruttive delle directory personali. Nessun host.json, stato di sviluppo, QR codice, volta, segreto, o privato terminal il contenuto è pubblicato. I flussi di lavoro sono stati esaminati e l'uso npm ci; Pages verifica tutti e tre i beni prima dell'implementazione. Lo ZIP è costruito da una lista di permessi, con controlli CRC, confronti byte e controlli per-file. La licenza jsQR è conservata intatta, inclusa la sua ultima nuova linea.

## Usability corregge i seguenti feedback dell'utente

Paste potrebbe trattare il testo vuoto come una pasta di successo. Ora apre un'area di pasta ricca quando l'API non fornisce contenuti utili, accetta le immagini FileList/DataTransfer e i dati PNG incorporati dall'HTML, e non inserisce l'HTML né scarica gli URL esterni. Una singola immagine viene inviata automaticamente al clipboard host e poi Ctrl+V nella sessione catturata quando un backend nativo è disponibile.

Il flusso operaio locale ha raggiunto **22 scenari**, tra cui la lettura di un'immagine reale attraverso l'API Clipboard di Chromium e la simulazione di un risultato di testo vuoto seguito da una pasta ricca a un host reale. Quest'ultimo simula solo l'ingresso di appunti; non rivendica l'interazione Android.

Una VM Xvfb/X11 separata ha anche ricevuto l'immagine dal browser attraverso il Worker pubblico e ha installato la ruota beta.2. PTY ricevuto solo byte `16` (Ctrl+V), senza Enter. Questo test pre-pubblicazione ha iniettato i file UI ramo in Chromium all'origine della pagina; vedi `native-clipboard-report.json`. Non dimostra l'esposizione dell'allegato all'interno effettivo Claude Code/Codex. L'utente ha riferito che entrambe le modalità Attach hanno lavorato sul loro dispositivo; la soluzione specifica di Paste è ancora attesa conferma sul loro telefono.

Tracciamento, cancellazione e percorsi rimangono disponibili in File → Trasferimento attività dopo un trasferimento; il browser salva i download.

macOS CI ha rivelato un altro caso di chiusura: la bandiera viva del mietore potrebbe rimanere vera dopo che il processo era effettivamente uscito. Chiusura ora controlla Popen.poll prima di segnalare il gruppo di processo. EPERM è tollerato solo se il processo è uscito; il fallimento su un bambino vivente rimane un errore. Una regressione verifica che un già uscito PID Questo ha portato la suite locale a 37 test e beta preparata.3.

## Android client e beta.3 follow-up — 2026-09-14

PR #10 ha superato ogni lavoro CI, tra cui 37 Python prove su Linux/macOS e entrambi i backend del relè del browser, poi fusi come `f85b9cb`. Host pubblica `v0.1.0-beta.3` è stato pubblicato da run `34859426583`; tutti e tre i beni pubblici, i contenuti delle ruote e i checksum sono stati verificati, e la scansione segreta della ruota non ha trovato perdite. `34859891960` riuscito; la sua configurazione beta.3 e le risorse di interfaccia cambiate sono state confrontate con la sorgente fusa. Ubuntu VM aggiornata dall'installatore pubblico con la sua identità conservata e il suo servizio utente attivo.

Android osservazioni locali di costruzione:

- JDK 17; Gradle 9.5.0 con distribuzione ufficiale SHA-256; AGP 9.3.2; compila SDK 37.0 / target 36 / minimo 26.
- `android/gradlew -p android :app:assembleRelease :app:lintRelease :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug --write-locks --write-verification-metadata sha256 --no-daemon`: successo. Due test unità di protocollo nativo superati (crittografia bidirezionale, replay/tamper rifiuto e binding di prova). Il canale nativo anche autenticato contro l'attuale host Python pubblico, indipendentemente da questi dispositivi di unità.
- Android lint: nessun errore. Le avvertenze rimanenti riguardano l'API 36, la versione compatibile Gradle, JavaScript essere abilitato per l'interfaccia in bundle e l'analisi di funzionalità-guard; questi sono i confini esaminati, non le affermazioni soppresse.
- OSV ha interrogato tutti i 21 risolti Android rilascio runtime Maven artefatti: nessun consulente segnalato su 2026-09-14. Questa è la copertura del database, non un controllo di sicurezza. WebKit è stato aggiornato a 1.17.0 e la libreria di test JVM JSON a 20260814 dopo aver controllato le versioni disponibili.
- `apksigner verify --verbose --print-certs`: rilascio firmato APK verifica con APK Scheme di firma v2, RSA 4096, certificato SHA-256 `0c94f35fe68a30eb155c4aa5b9003f633b5b4884f191c54f84bdeeec956348fe`. Firmato locale APK l'installazione e il lancio sono riusciti nell'emulatore. Il debug è disabilitato; l'automazione end-to-end qui sotto ha usato il debug build WebView debug, non un punto finale debug di produzione.
- Android 14/API 34 x86_64 emulatore: installato APK → pubblico Cloudflare relay → host beta.3 pubblica di rilascio → reale shell comando e file di output; nativo Android testo clipboard round-trip; canale di notifica crittografato Java nativo; effettivo Android notifica con l'app sottofondo ed emulatore schermo spento; nativo Android immagine clipboard → upload → host isolato X11 clipboard → PTY byte `16` (Ctrl+V), no Enter, PNG byte uguali; rotazione e rete da attivare mantengono lo stesso shell ID/PID; Android Salva la finestra di dialogo scrive byte di fixture binarie esatte.
- Android è una strumentazione separata APK. Non è nell'applicazione firmata. Tutti i test host/clipboard/immagine utilizzati dati sintetici nel VM/emulatore isolato, mai il clipboard desktop dell'utente o cartelle personali.
- Dopo l'integrazione di interfaccia condivisa: `npm test` e `npm run test:relay` passato; `python tests/browser_e2e.py` ha passato tutti i 22 scenari del browser; `python scripts/check_project.py` passato. GitHub CI ripete entrambi i backend del relè del browser prima di fondersi.

Evidence: `docs/evidence/android-report.json` e `android-dependency-audit.json`. Controllo fisico della fotocamera Android, reale comportamento della tastiera/IME, varianti della galleria, effettiva consegna Wi-Fi/mobile, comportamento profondo della batteria idle/OEM e riconoscimento dell'allegato all'interno di un protocollo Claude Code/Codex non sono garantiti.

Il contenitore nativo conserva ora una schermata di apertura/ricerca esplicita fino a quando l'applicazione in bundle conferma la disponibilità e richiede un riflusso. Tre partenze fredde consecutive del rilascio non-debuggable firmato poi ha mostrato lo spazio di lavoro. La verifica iniziale di clean-run CI ha respinto anche due controlli mancanti dei metadati Gradle; una risoluzione di dipendenza-cache ha generato i controlli mancanti di POM/module.

## Aggiornamenti automatici — validazione dell'implementazione

L'aggiornamento host richiesto aggiunge sei test di guasto / sicurezza: un defer di aggiornamento scaricato con un reale stato di sessione attiva anche quando l'autorizzazione di riavvio viene ereditata; byte delle ruote manomesse non possono raggiungere l'arresto dell'host; strisce di installazione automatiche riavviare e override dello sviluppatore; riavvio esplicito viene gestito separatamente; i tag di rilascio vecchi / invalidi vengono rifiutati; disabilitando gli aggiornamenti automatici impedisce l'accesso alla rete. `pytest -q`: **43 superato****. La vera suite di installatori passa ancora tutti i controlli **8************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************ PTY rifiuto e riavvio esplicito. Installazione automatica pubblica versione-to-versione e AndroidL'installatore di aggiornamento reale viene tracciato separatamente da questi test e deve essere registrato dopo la pubblicazione del rilascio.

Il sottoscritto (non-debuggable) APK abbinato con successo attraverso Android's Documenti/gallery picker utilizzando un QR immagine, contro l'host beta.3 pubblico e Cloudflare Relè. AndroidE' stata anche esercitata la vera finestra di dialogo con il permesso della fotocamera e il lancio dello scanner ZXing nativo; una vera e propria telecamera fisica che decodifica una QR non è ancora rivendicato. APK bypassare deliberatamente il vecchio WebView's BarcodeDetector per galleria QR decodifica: l'API si è schiantato nell'emulatore quando Google Play Services era assente; in bundle jsQR ha decodificato con successo la stessa coppia.

L'arresto automatico-update di guardia ora sfida anche durante i trasferimenti di file. Un carico temporaneo effettivo rimane writable dopo un riavvio rifiutato e completa con byte identiche prima dell'arresto è consentito. Python suite ora segnala che e' passata la 45. Android rilascio scoperta utilizza il canale di pagina pubblica verificato invece di richiedere a ogni dispositivo di consumare GitHub Quota API. Test nativi JVM: **3 superato**. APK anche eseguito un comando attraverso il suo Android Input Compose/keyboard; il file host risultante conteneva gli byte esatti attesi.

## Rilascio dello spazio di lavoro condiviso

Vedi [valida dello spazio di lavoro](WORKSPACE_VALIDATION.md) per le attuali impostazioni desktop/shared-session, geometria terminal, inserimenti Android e modifiche di notifica.

## Regressioni di consegna successive

Vedere [regressione di consegna correzioni](DELIVERY_REGRESSIONS.md) per l'ambiente shell segnalato dall'utente, avvio Ubuntu, launcher/icon, difetti di scorrimento Android e di notifica scoperti dopo la consegna precedente.
