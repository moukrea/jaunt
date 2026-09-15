[English](../../../PROTOCOL.md) · [fr](../../fr/docs/PROTOCOL.md) · [es](../../es/docs/PROTOCOL.md) · [it](PROTOCOL.md) · [pt](../../pt/docs/PROTOCOL.md) · [de](../../de/docs/PROTOCOL.md)

# Protocollo jaunt v1

Questo documento descrive l'implementazione, non una garanzia di sicurezza o standard.

## Trasporti e identità

Endpoint: `wss://RELAY/v1/room/ROOM`. ROOM è di 18 byte casuali, codificate come base non imbottita64url (24 caratteri). Le funzionalità di routing sono 32 byte (43 caratteri). I registri host con `hostToken` e `clientToken`. L'Oggetto durevole memorizza i propri hash SHA-256 in una transazione iniziale atomica; un altro host non può sostituirli.

I relè negozi che routing hashes e lo stato di attaccamento necessario per l'ibernazione, mai terminal storia. Le chiavi di crittografia rimangono agli endpoint. Entrambe le connessioni sono in uscita; l'host non ha bisogno di porta in arrivo. WebSockets deve usare il configurato `APP_ORIGIN`; il desktop confezionato utilizza il permesso separatamente `jaunt://app` origine. Ospite nativo senza origine/Android Le connessioni rimangono supportate. Tutti i clienti ancora autenticano le capacità di routing e il canale end-to-end.

## Abbinamento

`jaunt1.` seguito da base64url JSON contenenti: `v` (versione) `r` (relè) `h` (stanza) `t` (ClientToken), `p` (ID pair), `s` (pair secret), e `n` (nome host). L'host memorizza e fa rispettare la scadenza; il browser non tratta il proprio valore di scadenza come autorevole. QR codice punti alla pagina con questo codice nel frammento. Durata: 600 secondi, uso singolo.

Il browser crea il suo ID dispositivo e il segreto di 32 byte e li salva PRIMA di consumare il codice QR, quindi li trasmette solo dopo l'autenticazione e la crittografia. Se il messaggio di benvenuto finale viene perso, prima prova l'identità del dispositivo persistito, quindi l'accoppiamento se ancora valido.

## Paramano

Il client e il server creano ciascuna una chiave P-256 effimera. Le chiavi pubbliche utilizzano la codifica SEC1 non compressa e la base64url. La trascrizione è un array compatto ASCII JSON in questo preciso ordine:

```
["jaunt-v1", room, auth, id, pair-or-"", clientNonce, clientPublic, serverNonce, serverPublic]
```

Le prove sono HMAC-SHA256 (segreto, `server:` || transcript) e HMAC-SHA256 (segreto, `client:` || transcript), controllato prima di aprire il canale. `auth` distingue l'accoppiamento da un dispositivo ricordato. Ogni connessione utilizza nonze casuali.

Condividere = P-256 ECDH. AAD = SHA256(transcript). HKDF-SHA256, lunghezza 32, sale SHA256(secret), info AAD | `jaunt-c2h` o AAD || `jaunt-h2c`. Due chiavi indipendenti AES-256-GCM seguiti, una per direzione.

Cornice di applicazione: `{type:"box", n:counter, ct:base64url(ciphertext+tag)}`. I messaggi decifrati sono JSON; i blocchi binari utilizzano base64url. Bilancio di trasporto: 132.000 caratteri. Ingresso, uscita e file sono bloccati prima della crittografia.

## RPC e flussi

Richieste: `{type:"rpc", id, method, params}`. Risposte: `{type:"reply", id, ok:true, result}`, o il modulo di errore definito in daemon.py. `Peer.dispatch` e `Host.rpc` sono la fonte di verità per i metodi e gli eventi; non inventare un secondo schema, diverging.

Dopo la riconnessione, `session.attach(after)` riproduce solo l'output che non è stato ricevuto. Se il buffer è stato troncato, viene inviato un evento di reset esplicito. Le dimensioni sono condivise: l'ultimo client attivo ridimensiona il comune PTY.

I carichi usano gli ID per-transfer, la proprietà del dispositivo, l'offset previsto e una risposta di offset per i pezzi duplicati. SHA-256 I file temporanei sono nella stessa directory con la modalità 0600. I trasferimenti scadono dopo un'ora di inattività. Non c'è ripresa on-disk dopo un riavvio dell'host. KiB Quei pezzi.

## Evoluzione

Un nativo Android il client deve implementare questo protocollo e la stessa semantica di archiviazione di identità; non deve copiare il browser WebSocket sessione. Versione ogni cambiamento incompatibile. Python/Web Crypto interoperabilità e replay test devono rimanere necessari in CI.

## Viste condivise e trasporto desktop locale

Un benvenuto facoltativamente include `peer`, l'identificatore di vista corrente. Le informazioni di sessione includono `viewers` e `activeView`. `terminal.geometry` porta il PTYLe colonne, le righe, la vista di controllo e l'elenco del visualizzatore. Un ingresso attivo esplicito o ridimensiona la geometria delle richieste; semplicemente il collegamento non lo fa. L'output mantenuto registra le sue dimensioni e riemette modifiche di geometria in ordine. terminal La coda di scrittura asincrona del parser.

`session.detach` rimuove una vista senza chiudere la PTY. `session.terminate` termina esplicitamente la sessione sottostante, incluso un nome tmux sessione quando applicabile. L'eredità `session.close` il comportamento rimane compatibile con i clienti più anziani.

Il ponte desktop invia gli stessi messaggi RPC/stream attraverso la presa di controllo 0600 Unix dopo `ui.connect`. La directory madre del socket 0700 limita l'accesso all'account host. Nessun segreto di accoppiamento viene generato per questo canale dello stesso account; le connessioni remote mantengono il handshake crittografico esistente. L'input non viene mai riprodotto quando entrambi i canali si riconnette.

Il nuovo testo di accoppiamento utilizza il prefisso `jaunt1.`. I client aggiornati accettano anche il prefisso originale della maiuscola; l'accoppiamento dei frammenti dell'URL e delle etichette della trascrizione crittografica sono invariate. I sovrascritti delle variabili dell'ambiente esistenti sono accettati come alias di compatibilità mentre la nuova documentazione utilizza i prefissi del prodotto minuscolo.

Pubblicità degli host `sessionDirectory: true` accetta di accettare `session.directory(id)` e l'opzionale `sourceSession` su `session.create`. Un'esplicita nonvuota `cwd` l'ospite legge il shell directory corrente di processo su Linux/macOS e rientra nella sua directory iniziale se il processo è uscito o il sistema operativo non può fornirlo, questo non introduce alcun nuovo limite di trasporto o di autorizzazione.

I client possono distinguere il risultato del check richiesto da un controllo completato precedente. Gli stati includono il controllo, il download, la verifica, l'installazione, l'installazione, l'installazione, la corrente, il differimento e l'errore. Un errore di installazione non viene segnalato come in attesa a meno che shells/trasferimenti attivi abbia bloccato una riparte non autorizzata.
