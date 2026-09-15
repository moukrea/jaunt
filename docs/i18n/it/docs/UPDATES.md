[English](../../../UPDATES.md) · [fr](../../fr/docs/UPDATES.md) · [es](../../es/docs/UPDATES.md) · [it](UPDATES.md) · [pt](../../pt/docs/UPDATES.md) · [de](../../de/docs/UPDATES.md)

# Aggiornamenti senza perdere sessioni o identità

## Host

L'installatore pubblico configura automaticamente gli aggiornamenti per impostazione predefinita. L'host controlla il rilascio selezionato dalla pagina pubblicata dopo l'avvio e ogni 15 minuti. Questo lo mantiene sul canale di distribuzione convalidato del proprietario. Un checkout di origine non ha un'autorità di installazione automatica; deve prima essere installato tramite l'installatore pubblico.

Una nuova ruota è scaricata HTTPS e verificato contro il suo manifesto di rilascio. L'installatore viene letto da quella ruota verificata. Python runtime in atto con `exec`: il demone PID, bambino shell processi e apertura PTY i descrittori rimangono vivi. Il buffer di ripetizione limitato e terminal Le variabili di ambiente, le directory di lavoro e i comandi in esecuzione rimangono nei loro processi originali. I client ricollegano utilizzando le chiavi esistenti. Questo non richiede tmux.

L'installatore convalida il nuovo runtime prima di richiedere il handoff e smette di accettare nuove sessioni durante l'interruttore. Se la preparazione non riesce, il vecchio host riprende a servire il suo shells esistente. La modalità automatica non eredita mai gli override `jaunt_ALLOW_RESTART` o lo sviluppatore di download.

**La migrazione da parte di host più anziani:** le uscite senza il decollo di runtime non possono preservare il loro PTYs attraverso una sostituzione runtime. L'installatore rileva tale capacità e defers mentre ordinario shells la loro fine richiede ancora l'approvazione esplicita attraverso **Aggiornare e riavviare** o `jaunt update --allow-restart`. Un ordinario `jaunt update` Dopo questa migrazione una volta, gli aggiornamenti compatibili successivi utilizzano automaticamente il handoff.

Gli aggiornamenti delle applicazioni conservano shells; bloccano/riavviano esplicitamente il daemon o riavviano il computer ancora termina il normale shells. Questo meccanismo non viene recuperato dopo un crash daemon o una perdita di potenza.

L'aggiornamento distaccato utilizza una serratura privata per evitare gli aggiornamenti sovrapposti e mantiene il vecchio runtime fino a quando la sostituzione verificata è pronta. `installation.json`, `update-status.json`, `update.log` e le ruote in fase non rilasciano mai beni. I controlli non revocano dispositivi.

## Android

The APK assegni pubblici Android rilascia automaticamente, con un controllo manuale in Impostazioni. Verifica byte scaricate, identitÃ del pacchetto, una versione strettamente piÃ1 recente e lo stesso certificato di firma prima dell'apertura AndroidI dati e l'accoppiamento dell'app vengono mantenuti durante un aggiornamento. Android richiede la conferma dell'utente per APK installazione e può chiedere una volta per il permesso di installare gli aggiornamenti da jaunt. Questo è un confine del sistema operativo, non un servizio cloud mancante o account utente finale.

Vedi [Android dettagli e validazione](ANDROID.md). I controlli di aggiornamento, i controlli di firma e i test funzionali non costituiscono un controllo di sicurezza indipendente.

## Applicazione Desktop

La GUI desktop ha la sua versione di rilascio e l'aggiornamento, separato dall'host/CLI. Controlla il canale pubblicato poco dopo l'avvio e ogni 15 minuti, seleziona il pacchetto Linux/macOS per la CPU corrente e verifica SHA-256 dopo il download e di nuovo prima dell'installazione.

**Install e riopen** applica un pacchetto verificato e riapre lo stesso profilo di applicazione. Con gli aggiornamenti automatici abilitati, la chiusura dell'app applica anche un aggiornamento pronto. L'installatore GUI distaccato non arresta mai il servizio host o termina il suo servizio host. shells. Un sistema `.deb`/`.rpm` installazione o protezione macOS la posizione dell'applicazione può richiedere l'autorizzazione del sistema operativo. macOS le costruzioni rimangono non firmate e non nominate.

Un risultato di installazione viene mantenuto nel profilo desktop privato. Il guasto viene visualizzato sul prossimo lancio; non è immediatamente nascosto dal controllo di avvio. Le costruzioni desktop più vecchie hanno bisogno di un'installazione di una release che include questo aggiornamento, utilizzando il pacchetto pubblico o `jaunt gui --install-only`.

## Progressi visibili

Trasferimenti di immagini Web e desktop mantengono il loro risultato effettivo: upload verificato e inserimento del percorso quotato senza Enter, o il completamento del clipboard host plus Ctrl+V consegna. Non pretendono che un CLI i controlli ospitanti mostrano il completamento, il fallimento o il differimento esplicito per il lavoro attivo. Android utilizza le finestre di dialogo di progresso nativo per i controlli e APK downloads, seguito dalla conferma dell'installatore del sistema operativo.
