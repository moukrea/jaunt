[English](../../../SESSION_CONTROLS_VALIDATION.md) · [fr](../../fr/docs/SESSION_CONTROLS_VALIDATION.md) · [es](../../es/docs/SESSION_CONTROLS_VALIDATION.md) · [it](SESSION_CONTROLS_VALIDATION.md) · [pt](../../pt/docs/SESSION_CONTROLS_VALIDATION.md) · [de](../../de/docs/SESSION_CONTROLS_VALIDATION.md)

# Convalida dei controlli di sessione

Il gestore di sessione ha precedentemente nidificato i pulsanti di file-menu a larghezza intera all'interno di una riga orizzontale non-scorrevole. Le azioni hanno traboccato la finestra di dialogo; il rinominare era assente dall'elenco.

Ordinario shell la creazione non apre più una finestra di dialogo di denominazione. L'azione della cartella fornisce la navigazione directory con un nome opzionale. shellLa directory corrente; gli host più anziani usano l'ultima directory iniziale conosciuta. I controlli di divisione Desktop selezionano l'orientamento direttamente e mostrano un nuovo/esisting-session in linea che sceglie. Ogni pannello piastrellato può muoversi in una scheda indipendente senza creare o terminare un PTY.

Osservato localmente il 2026-09-15:

- Python 3.14.2: `python -m pytest -q` — 67 passato, compresi innocui frame di flusso tardivo dopo la terminazione, reale eredità di directory PTY dopo `cd`, override di directory esplicita e nomi automatici non codificanti.
- Node 25.5.0: `npm test` — 27 superato; `npm run test:relay` — 2 veri test Miniflare/workerd passati.
- `python tests/shared_workspace_e2e.py` in Electron con un host di fissazione isolato — passato. Esercizi locali/remote condivisi PTYs, entrambi gli orientamenti divisi, la selezione di sessione esistente, spostando un riquadro a una scheda, ricarica la persistenza, flattening mobile, limiti di sessione-azione a 390 e 1300 pixel, rinomina locale/close/reopen/terminate, la creazione automatica con contenuto directory attuale.
- `python tests/browser_e2e.py` — 23 scenari passati.
- `python tests/terminal_render_e2e.py` — la geometria del rotolo / tastiera e l'avvio isolato effettivo Claude Code/Codex superato.
- Il pacchetto desktop Linux costruito ha passato lo stesso controllo di sessione espanso E2E. `node scripts/check_desktop_package.mjs` verificato le importazioni, le opere d'arte e le autorizzazioni del lanciatore.
- `python scripts/check_project.py` e `python scripts/build_release.py` sono passati durante lo sviluppo.

The Electron l'imbracatura di prova disabilita la sua sandbox in isolamento; non è un'impostazione di lancio di produzione. Il pacchetto Debian installato beta.8 è iniziato in Ubuntu 24.04 con il renderer Seccomp=2 e NoNewPrivs=1; un nuovo locale shell ha scritto un file di prova fresco. APK passato Android test di emulatore per l'effettiva ridimensionamento dell'IME, il touch scroll, la rotazione e la selezione dei contenuti di notifica/target. Il primo tentativo di emulatore ha incontrato un'uscita esterna del processo di UIAutomator 137; APK L'installatore ha superato tutti i 9 controlli, compreso il rifiuto del checksum, l'importazione non modificabile della ruota, attivo-shell protezione e riavviamento esplicitamente autorizzato con identità conservata. Le osservazioni di consegna pubblica sono registrate di seguito. Non si fa richiesta di telefono fisico. Il protocollo rimane indipendentemente non verificato.

Un test di installazione ha esposto un difetto aggiuntivo: il vecchio installatore chiamato `service stop` anche con `jaunt_NO_SERVICE=1`, arrestando il servizio locale reale del manutentore. Il servizio è stato riavviato; PTYs ordinario non può essere recuperato dopo una fermata di demoni. L'installatore ora rispetta la modalità no-service durante l'arresto troppo.

La selezione delle sessioni persiste ora il layout prima di rendere o aspettare l'attacco terminal. L'affermazione del carico immediato rimane nel test dello spazio di lavoro condiviso.

## Operazioni visibili e aggiornamenti desktop

La striscia di attività mantiene il progresso di upload e l'esito finale effettivo: l'inserimento di file/path verificato senza Enter, o il completamento del clipboard host più la consegna Ctrl+V. Non rivendica il riconoscimento come un allegato Claude Code/Codex. Inoltre, segue gli stati di aggiornamento dell'host tramite il controllo, il download, la verifica, l'installazione, l'errore esplicito e il deferral per l'aggiornamento attivo shells.

L'aggiornamento del desktop controlla il canale pubblicato sull'avvio e ogni 15 minuti, scarica solo l'asset di rilascio di proprietà del progetto corrispondente, e verifica SHA-256 sia dopo il download che prima dell'installazione. L'installazione automatica viene eseguita quando l'applicazione desktop si chiude. Impostazioni fornisce una funzione di aggiornamento automatica, controllo manuale, progresso visibile e installazione e riapertura. Linux pacchetti di sistema e protetti macOS posizioni di applicazione può richiedere l'autorizzazione del sistema operativo. L'installatore distaccato non chiama l'host CLI o un gestore di servizi; terminal le sessioni appartengono al processo host separato.

Node i test coprono la selezione della versione/asset, le fasi di progresso, i risultati delle attuali versioni, il rifiuto del checksum, la rivalidazione prima dell'installazione, e l'estrazione/applicazione dell'archivio reale in una casa isolata mentre un processo non correlato e i dati di identità salvati rimangono intatti. Electron test carica anche un'immagine attraverso il ponte locale e verifica l'indicatore di completamento persistente. Android ora visualizza una finestra di dialogo di controllo esplicita e determinati progressi di download quando è disponibile una lunghezza di contenuto.

Il test di revoca del browser ora passa `--` prima dell'ID posizionale, come già fatto il test del desktop; le affermazioni di revoca e di mantenimento della sessione rimangono invariate.

## Consegna pubblica — 2026-09-15

I risultati di rilascio e di installazione pubblica sono stati registrati dopo la pubblicazione e completano le osservazioni locali e CI sopra.

- PR: https://github.com/moukrea/jaunt/pull/22
- Pagina: https://moukrea.github.io/jaunt/
- Host: v0.1.0-beta.10 (CLI 0.1.0b10)
- Desktop: desktop-v0.1.0-beta.8
- Android: android-v0.1.0-beta.6 (versioneCodice 6)

Un candidato di aggiornamento pacchetto privato ha scaricato e verificato il beta del desktop pubblico esistente.7, installato il suo pacchetto Debian e riaperto lo stesso profilo in un Ubuntu 24.04 VM. Host e PTY PIDs sono rimasti immutati, e i comandi eseguiti prima e dopo l'aggiornamento.

Il README completo è in inglese e ora descrive l'installazione, l'host/desktop separato/AndroidI meccanismi di aggiornamento /web, la creazione di sessioni e l'eredità di directory, sia gli orientamenti divisi, i risultati della consegna delle immagini, il comportamento di notifica e i limiti di validazione. npm audit ha riferito zero vulnerabilità; pip-audit non ha segnalato alcuna vulnerabilità di dipendenza nota, con il progetto modificabile stesso escluso dal catalogo dei pacchetti esterni.

L'implementazione fusa è impegnata `937fb52ea56297326ce3fd090cb66802a76a063d`. La validazione richiesta di CI, Android e sia Linux/macOS costruisce una distribuzione passata prima della fusione. Il controllo finale della versione del registro Node ha trovato solo una nuova alfa Miniflare; la stabile collaudata Miniflare 4.20260730.0 è stata mantenuta

I tre beni ospitanti pubblici sono passati manifesti/SHA-256 validazione e scansione gitleaks della ruota estratta. Una vera e propria installazione pubblica beta.9→beta.10 Ubuntu Prima della promozione di Pages questo test ha esplicitamente selezionato il tag host già pubblicato. APK beta.5→beta.6 l'aggiornamento ha mantenuto l'accoppiamento esistente e ricollegato sul vero Worker del proprietario. APK creato un shell, ha eseguito un comando provato da un file, e ha terminato la sessione di fissazione. APK non era debuggable, e il suo checksum pubblico e il certificato di firma pinned abbinato.

Tutte e dieci le attività del desktop pubblico corrispondevano al loro catalogo SHA-256 pubblicato. Sia gli archivi Linux e macOS, per x64 e ARM64, contenevano l'aggiornamento previsto, l'interfaccia utente visibile, le risorse locali di jsQR e Lucide, il logo originale immutato e i collegamenti di rilascio attuali host/Android/desktop.

L'esatto comando di installazione dalla pagina pubblica successivamente è passato in una nuova Ubuntu account utente (servizio utente attivo abilitato e QR uscita) e una fresca Fedora 43 container. La Pagina dispiegata ha servito tutte le 29 risorse controllate sotto `/jaunt/` con uguaglianza byte. La vera ricetta pubblica si è dimostrata l'accoppiamento, un controllo completo dell'aggiornamento dell'host, arbitrario shell esecuzione, schede di commutazione, caricamento multichunk/download byte uguaglianza, inserimento immagine/percorso senza Enter, ricarica e un'interruzione effettiva della rete degli ospiti che ritornano alla stessa shell PID, rifiuto di aggiornamento protetto, dispositivo esplicitamente autorizzato riavviare con identità conservata, e revoca.

Il pubblico Android l'applicazione beta.5 ha anche eseguito il proprio aggiornamento beta.6 attraverso la scoperta del canale, HTTPS scarica, verifica checksum/firma, la Android la schermata di autorizzazione e l'installatore del pacchetto OS. L'accoppiamento esistente è sopravvissuto. Il suo successivo controllo esplicito ha mostrato un risultato up-to-date. Android's etichette del pulsante maiuscolo, vista del permesso controllabile, e il pulsante Open dell'installatore; questi erano correzioni di navigazione di prova, non override del risultato dell'applicazione.

## Seguito: feedback asincrono costante

Il follow-up rimuove le cascate di brindisi di connessione-error, mantiene gli errori di dialogo/pairing accanto alla loro azione, e delimita i brevi toast di conferma. I controlli di attività mantengono i nodi DOM stabili mentre i cambiamenti di progresso; i risultati completati crollano nella storia accessibile e i progressi tardivi non possono sovrascrivere il completamento. Download, configurazione di servizio, attesa di rete, cancellazione e azioni aggiornate utilizzano la stessa area di attività.

La generazione tardiva di chiavi asincrono e le risposte di benvenuto decifrate vengono respinte quando è iniziata una connessione sostitutiva. Android carbonesce controlli/download simultanei e sostituisce la finestra di dialogo dei risultati invece di impilare i risultati.

Osservato localmente: 29 Node I test passati, tra cui due regressioni di stallo-collegamento. Il feedback dedicato E2E passato con tre interruzioni di mano reale, cinque RPC interrotti, nessuna cascata di errore-toast, riconnettersi alla stessa PTY, errori contestuali, controlli di progresso cliccabili stabili, storia compatta conservata e mobile terminal bounds. Browser E2E ha passato tutti i 23 scenari; condiviso Electron e isolato effettivo Claude Code/Codex terminalIl dispositivo host/browser utilizza ora le proprie directory di dati HOME e XDG, quindi la navigazione iniziale dei file non può enumerare le directory personali.


La regressione Impostazioni host selezionata è anche coperta: la commutazione della barra laterale mentre Impostazioni è aperta ora ricostruisce immediatamente i controlli host-bound, aggiorna lo stato di aggiornamento dell'host selezionato e ignora le risposte stanti dalla selezione precedente. I controlli di servizio locali Desktop appaiono solo per l'host locale; gli aggiornamenti delle applicazioni desktop e le notifiche rimangono impostazioni del dispositivo.

Validazione osservata: `python tests/feedback_e2e.py` accoppiato due host reali isolati, scambiati tra loro senza lasciare Impostazioni, rinominato Y, dimenticato X e verificato Y's shell PID era invariato. `DISPLAY=:179 python tests/desktop_remote_e2e.py` usato Electronla vera connessione locale e il pubblico del proprietario WSS relè, controlli verificati sul servizio locale scompaiono sulla selezione remota e ritornano sulla selezione locale, poi eseguiti e terminato un apparecchio shell. `python scripts/check_project.py` passato. I primi nuovi-test fallimenti sono stati un selettore nascosto delle impostazioni di sola mobile e una persistenza asincrono di asserzione della volta; i test ora utilizzano il pulsante Impostazioni del desktop visibile e aspettano il nome salvato prima di commutare.
