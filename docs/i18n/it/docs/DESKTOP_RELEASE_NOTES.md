[English](../../../DESKTOP_RELEASE_NOTES.md) · [fr](../../fr/docs/DESKTOP_RELEASE_NOTES.md) · [es](../../es/docs/DESKTOP_RELEASE_NOTES.md) · [it](DESKTOP_RELEASE_NOTES.md) · [pt](../../pt/docs/DESKTOP_RELEASE_NOTES.md) · [de](../../de/docs/DESKTOP_RELEASE_NOTES.md)

# jaunt desktop 0.1.0-beta.10

Un'applicazione desktop nativo che condivide lo stesso responsive UI del browser e il client Android, con i controlli host locali. I dispositivi locali e remoti si attaccano allo stesso normale shells senza tmux. Le schede desktop supportano i riquadri divisi persistenti e resizionabili; i layout mobili mostrano quelle sessioni come schede separate.

**Sessions** elenca le sessioni in esecuzione e in uscita, apre esistenti shells, chiude solo una vista, o termina esplicitamente una shell e i suoi lavori per tutti gli spettatori. Fare clic o digitare seleziona quale dispositivo controlla il condiviso terminal taglia.

L'applicazione utilizza l'opera originale jaunt, temi dark/light/system/circadian, nomi host/order/default e notifiche OS privati opzionali. Può avviare un servizio host installato e connettersi ad altri host. L'installatore ufficiale offre anche `--client-only`, che installa il client desktop senza un host locale o controlli host locali.

Linux: installare il `.deb` o `.rpm`, oppure `jaunt gui` per un'installazione di archivio verificata per utente. macOS: aprire l'archivio/immagine dell'applicazione della CPU corrispondente, o utilizzare `jaunt gui` da un host installato. Le costruzioni desktop non sono firmate su macOS. Nessun launcher disabilita la sandbox di Chromium. Le notifiche richiedono che l'app sia in esecuzione.

Vedere `docs/WORKSPACE.md` e `docs/WORKSPACE_VALIDATION.md` per il comportamento, i test osservati e i limiti di validazione rimanenti.

Questo aggiornamento sostituisce i pittogrammi di interfaccia con Lucide, visualizza il testo di notifica del programma e mantiene gli obiettivi di notifica attraverso le ricollegamenti. Linux i pacchetti contengono le dimensioni standard dell'icona e i metadati del lanciatore leggibili. Ubuntu con spazi di nome utente ristretti, l'installatore host seleziona il pacchetto di sistema per configurare il supporto sandbox.

I controlli di sessione ora mantengono Open, Rename, Close view e Terminate all'interno di ogni scheda di sessione reattiva. shell crea un nome automatico terminal subito. Nuovo shell nella cartella offre la navigazione della directory e un nome opzionale. L'host può ereditare l'attiva shellLa directory corrente del desktop ha dei controlli separati lato per lato e sopra/sotto, una scelta in linea di sessioni nuove o esistenti, e un pulsante per spostare ogni riquadro nella propria scheda. shell vivo; la risoluzione richiede ancora una conferma esplicita.

L'applicazione desktop ora controlla gli aggiornamenti automaticamente, scarica e verifica il rilascio corrispondente, e lo installa quando si chiude l'app. Impostazioni offre Controllare l'aggiornamento del desktop, un automatico-update toggle, e Installare e riaprire quando pronto. Le installazioni di sistema possono chiedere l'autorizzazione del sistema. Questo aggiorna l'interfaccia separatamente dall'host e non interrompe l'host shells.

Gli errori di dialogo rimangono in linea; gli errori di azione persistono senza cascate di brindisi. I trasferimenti espongono l'attesa/cancellazione/complezione, l'attività completa crolla nella storia accessibile e l'aggiornamento della disponibilità mantiene visibile la sua azione.

Questa versione corregge il layout Impostazioni, l'ordine stabile della scheda, il rinominamento del doppio clic, il ricollegamento/aggiornamento del feedback e l'ancoraggio della pergamena mobile. Aggiunge una barra laterale crolluta persistente e sei lingue cancellate dal sistema con un override esplicito. Il titolo della finestra è semplicemente `jaunt`. Claude e Codex le sessioni di primo piano utilizzano icone del marchio Meteor in bundle localmente.
