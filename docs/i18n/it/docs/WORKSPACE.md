[English](../../../WORKSPACE.md) · [fr](../../fr/docs/WORKSPACE.md) · [es](../../es/docs/WORKSPACE.md) · [it](WORKSPACE.md) · [pt](../../pt/docs/WORKSPACE.md) · [de](../../de/docs/WORKSPACE.md)

# Spazio di lavoro condiviso terminal

Ogni giorno shell appartiene al demone ospite, non alla finestra che lo ha creato. L'app desktop, Android app, e i browser autorizzati possono allegare alla stessa ordinaria PTY allo stesso tempo. tmux è facoltativo. I terminali esistenti creati all'esterno jaunt non sono retroattivamente adottati; creare un jaunt shell o allegare esplicitamente un esistente tmux sessione.

## Sessioni e visite

**Nuovo shell** crea immediatamente terminal con un nome automatico, come `bash 1`. La sua directory segue il precedente attivo shell, incluso `cd` modifiche sugli host supportati. L'icona della cartella si apre **Nuovo shell nella cartella**, con la navigazione della directory e un nome opzionale. Se il sistema operativo non può leggere un shelldirectory corrente, l'host utilizza che shell’s directory iniziale.

Utilizzare **Sessions** accanto alle schede per vedere ogni sessione conservata sull'host selezionato, comprese le sessioni senza vista aperta. L'elenco mostra se ogni shell è in esecuzione e quali dispositivi lo hanno aperto.

- **Rinominare** cambia il nome della sessione condivisa. Fare doppio clic su un nome della scheda o fare doppio clic su un titolo del riquadro per rinominarlo troppo.
- **Open** collega questo dispositivo all'esistente shell e alla sua storia conservata.
- La scheda è ** ****** o **Close view** distacca solo questa vista. La shell e altri client rimangono collegati.
- **Terminate** chiede la conferma, quindi termina la shell e i suoi lavori per tutti gli spettatori. Per tmux uccide esplicitamente la sessione tmux, compresi gli allegati al di fuori di jaunt.

La risoluzione ordinaria copre i processi nei shell's POSIX terminal un processo deliberatamente deemonizzato in una sessione separata del sistema operativo è al di fuori di quel confine. La risoluzione della sessione non è un processo generale / sandbox del contenitore.

Exited shells mantiene il loro stato di attesa fino a quando la sessione viene rimossa, riservando il leader PID in modo che i lavori di sfondo superstiti possono ancora essere terminati in modo sicuro.

La chiusura dell'app, la perdita di una connessione di rete, o il blocco della sua volta non termina shells. Aggiornamenti host compatibili mantenere ordinario shell i processi e la loro storia attraverso un sostituto di runtime in loco. Un esplicito arresto diemon / riavvio o riavvio li termina ancora. Legacy ospita senza aggiornamenti di defer di handoff mentre ordinario shells sono attivi a meno che il riavvio non sia esplicitamente autorizzato. tmux rimane disponibile quando è necessaria una persistenza dipendente.

Le schede mantengono il loro ordine quando selezionato. Trascinale per riordinare; su una tastiera utilizzare Alt+Shift+Left/Right. Rinominare il doppio clic; tenere una scheda non si apre rinomina. I gruppi di divisione Desktop e l'ordine della scheda mobile vengono mantenuti attraverso le riconnette. La barra laterale del desktop può crollare, e la sua preferenza viene salvata.

## Dimensioni condivise e pergamena

Ogni sessione ha una dimensione PTY. Fare clic/toccare o digitare in una vista rende che il dispositivo controlla le sue dimensioni. Ridimensionare una finestra passiva non ruba il controllo. Le viste passive conservano la geometria condivisa e possono scorrere orizzontalmente o verticalmente quando terminal dell'altro dispositivo è più grande.

The terminal'l'elemento interno misurato non ha imbottitura; i margini dell'interfaccia utente circostante sono esclusi dal suo numero di riga/colonna. Android Le barre, e la tastiera riservano il proprio spazio. Il **↓ Ultimo** pulsante ritorna all'uscita recente; lo scorrimento verso l'alto rimane possibile mentre l'output continua. **Select** apre un controllo del testo nativo per le maniglie di selezione mobile e la copia conservata terminal testo. Selezione del mouse Desktop e Ctrl/Command+Shift+C rimane disponibile.

xterm 6 supporta l'output sincronizzato (modalità DEC 2026). Si applica ancora il comportamento a schermo alternativo specifico dell'applicazione: lo schermo alternativo non è un buffer di scorrimento illimitato. terminal programma può intenzionalmente cancellare il proprio schermo o scegliere di disabilitare la propria storia. jaunt non riscrive le sequenze di fuga di quel programma in output fabbricato.

## Tavole di piastrelle

Sul desktop, le due icone divise scelgono lato per lato o sopra/sotto posizione. Il loro selezionatore in linea offre un nuovo shell o qualsiasi sessione al di fuori del gruppo di divisione corrente. Trascina il divisore, o concentralo e usa i tasti freccia. Ogni scheda può contenere un albero diviso; selezionando un'altra scheda conserva i gruppi precedenti. Il pannello **Move alla propria scheda** icona in ogni intestazione del pannello lo separa senza terminare alcuna sessione.

I layout, i rapporti, le viste aperte, l'ordine host, i nomi amichevoli e l'host predefinito sono memorizzati nella volta di questo dispositivo. Sopravvivono la riconnessione e la riapertura dell'app. Su mobile, ogni sessione in un gruppo diviso appare come una scheda ordinaria; il ritorno alla larghezza del desktop ripristina la disposizione di divisione. Le preferenze dei layout sono per client, quindi un dispositivo non riorganizza lo spazio di lavoro di un altro dispositivo.

## Installazione desktop e controlli host

L'installatore host grafico installa l'applicazione desktop per l'utente corrente quando viene pubblicizzato un rilascio del desktop. `jaunt gui` per installarlo/aprirlo, oppure `jaunt gui --install-only` per aggiungere il lanciatore di applicazione senza aprire una finestra. Linux pacchetti e macOS le applicazioni sono fornite anche nel rilascio del desktop. L'applicazione è denominata **jaunt** e utilizza l'opera d'arte fornita.

L'interfaccia desktop è la stessa interfaccia in bundle del client web, con un ulteriore **Questo gruppo di impostazioni del computer**: installare / aggiornare l'host, avviarlo, installare il suo servizio di login, associare un altro dispositivo, e autorizzare esplicitamente un aggiornamento / riavvio. shells sono accessibili tramite una presa privata Unix senza richiedere una connessione a relè; i client remoti ancora autenticano attraverso il relè crittografato.

Linux Gli archivi user-space si basano sul sistema che consente la sandbox user-namespace di Chromium. Ubuntu limitando tale meccanismo, `jaunt gui` e l'installatore grafico seleziona automaticamente il `.deb` pacchetto e richiesta di autorizzazione del sistema se necessario. Il pacchetto configura il suo profilo AppArmor di portata. `--no-sandbox`. macOS artefatti desktop sono non firmati; i prompt di fiducia del sistema operativo possono applicare. Chiusura della finestra del desktop lascia il demone e shells esegue. Le notifiche Desktop richiedono che l'app desktop rimanga in esecuzione.

## Preferenze e notifiche

Light, System e Circadian sono anche disponibili; Circadian utilizza la luce dalle 07:00 alle 19:00 nel fuso orario locale del dispositivo.

Ogni host espone commutatori di eventi per terminal campane, notifiche di programma (OSC 9 e OSC 777), e uscita di sessione. Questi switch influenzano la generazione di eventi dell'host. Android notifiche di sfondo, browser Web Push, o le notifiche del sistema operativo desktop. `jaunt notify` e `jaunt run -- command` rimangono disponibili per le notifiche esplicite e il completamento dei singoli comandi. shell non può indurre in modo affidabile ogni domanda di “pensiero finito”.

Le notifiche omettono l'output terminal per impostazione predefinita. Le autorizzazioni del browser/OS, la forza-stop, le politiche della batteria, la disponibilità della rete e l'host è in linea influenzano la consegna di sfondo.

Le notifiche del programma conservano il testo del messaggio OSC 9 e il titolo/corpo OSC 777. Fare clic su una notifica nativa seleziona l'host e la sessione, incluso dopo la riconnessione o lo sblocco. Android segue le impostazioni della privacy dello schermo di blocco del sistema operativo. L'uscita del terminale non viene raschiata per inventare il testo di notifica.

I pittogrammi di interfaccia usano le icone di Lucide (la licenza ISC) a pinned, localmente in bundle. L'opera d'arte jaunt fornita rimane il logo dell'applicazione; i pacchetti Linux includono le dimensioni standard dell'icona e Android utilizza un wrapper del lanciatore adattativo intorno a tale opera d'arte.

## Aggiornamenti e progressi visibili

Host/CLI e le versioni desktop sono separate. L'host controlla automaticamente e aspetta ordinaria shells Il desktop controlla l'avvio e ogni 15 minuti, verifica i download e installa quando la finestra si chiude. Impostazioni offre controlli manuali e Installazione e riapertura. Installazione desktop conserva le macchine salvate dell'app e non blocca l'host shells; i pacchetti di sistema possono richiedere un prompt di autorizzazione del sistema operativo. Android la sua testimonianza APK e firma identità prima di consegnare l'installazione a Android.

La striscia di attività rimane visibile attraverso la preparazione dell'immagine, il caricamento, la verifica e l'inserimento. Enter da un PNG posto nella clipboard host con Ctrl+V inviato. Non promette mai che uno specifico CLI ha riconosciuto un allegato. Aggiornare il report corrente, installato, in attesa di attivo shells, o fallito; i risultati completati/error rimangono fino a quando non sono stati respinti.

### Icone del programma di primo piano

Le schede e le didascalie del pannello usano i marchi locali in bundle Meteor Icons Claude e OpenAI mentre il proprietario PTY programma primo piano è `claude` o `codex`. La rilevazione si aggiorna una volta al secondo e invia solo la categoria del programma, mai gli argomenti di comando. shell ripristina il terminal icon. I nomi di sessione amichevoli non influiscono sul rilevamento. tmux sessioni e wrapper non riconosciuti mantengono il terminal Icone Meteor 4.4.0 è licenza MIT; la sua licenza è inclusa nel pacchetto web.
