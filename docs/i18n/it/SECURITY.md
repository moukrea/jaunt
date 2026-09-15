[English](../../../SECURITY.md) · [fr](../fr/SECURITY.md) · [es](../es/SECURITY.md) · [it](SECURITY.md) · [pt](../pt/SECURITY.md) · [de](../de/SECURITY.md)

# Modello di sicurezza — beta non verificata

jaunt fornisce un shell completo sotto l'account host. Non c'è un filesystem sandbox o un ruolo di sola lettura: un dispositivo autorizzato può agire come tale utente. Non eseguire l'host con privilegi che i dispositivi remoti non hanno bisogno.

## Ciò che è protetto

I comandi, l'output, i file e i dati del clipboard sono crittografati tra il browser e l'host. Il relè vede gli indirizzi di rete, le camere, la presenza, le dimensioni dei pacchetti e i tempi, e le chiavi pubbliche effimere. Non contiene l'accoppiamento o i segreti del dispositivo. Il canale è autenticato da un casuale segreto a 256 bit, con ECDH e AES-GCM.](docs/PROTOCOL.md).

I primitivi provengono dalla crittografia e dal Web Crypto. **La loro composizione in questo protocollo è nuova e non ha ricevuto un audit esterno.** I test di verifica/riproduzione e interoperabilità non sostituiscono un audit. Non descrivere jaunt come certificato, invulnerabile o pronto per impostazione predefinita per ambienti di produzione sensibili.

## Ciò che non è protetto

- Resta compromesso un browser, una macchina o un account di sistema.
- GitHub Pages serve il codice che può accedere ai segreti dopo lo sblocco: un aggressore che controlla il repository o la pagina può sostituire JavaScript. La crittografia end-to-end non protegge da un aggiornamento client dannoso.
- Senza una password, le chiavi vengono memorizzate non crittografate in IndexedDB, come una sessione ricordata. Una password / PIN li crittografa a riposo; un PIN corto rimane vulnerabile all'ipotesi offline.
- Bloccaggio blocca connessioni e cancella le viste attive. Non garantisce la cancellazione crittografica della RAM del browser.
- Un codice QR completo garantisce l'accesso shell per dieci minuti. Mai mettere in un problema, screenshot pubblico, registro CI o analisi.
- Le notifiche del browser vengono fornite tramite il servizio push del browser. I titoli e i corpi di notifica forniti dal programma vengono visualizzati e inviati tramite tale servizio; non includono i segreti nelle notifiche. Android segue le impostazioni di privacy del sistema lock-screen. L'uscita del terminale non viene raschiata per le notifiche.
- Un dispositivo revocato non può più autenticarsi al canale, ma conosce la precedente capacità di routing condivisa. Può ancora interrompere la disponibilità del relè fino a quando l'identità dell'host non è ruotata.

## Shared GitHub Origine delle pagine

Siti presso `moukrea.github.io/another-project/` e `moukrea.github.io/jaunt/` condividere un'origine del browser. Un altro progetto vulnerabile su quell'origine potrebbe mirare jauntI percorsi non sono un limite di sicurezza. Per uso sensibile, servire jaunt su un'origine dedicata (il suo dominio/sottodominio) e la coppia di nuovo là. Un PIN protegge le chiavi a riposo ma non sostituisce l'isolamento di origine o la fiducia nella JavaScript essere servito.

## Conservazione e autorizzazioni

`~/.local/share/jaunt/host.json` e la presa di controllo sono privati dell'account corrente. La directory utilizza la modalità 0700, lo stato utilizza 0600, e le scritture sono atomiche. `attachments/` contiene i file caricati; il blocco dell'app non li cancella.

Le chiavi persistenti non appaiono mai negli URL di richiesta: l'accoppiamento utilizza il frammento, che viene immediatamente rimosso dalla storia. Le funzionalità di relè vengono inviate nel primo frame WebSocket su TLS. Il Worker non registra i carichi di pagamento.

## Deployment

Uso HTTPS/WSS loopback esterno, limitare APP_ORIGIN all'origine esatta delle pagine, abilitare le protezioni MFA e branch, minimizzare Cloudflare/GitHub Non aggiungere script di analisi di terze parti o estensioni alla pagina. Il CSP statico blocca gli script in linea e la valutazione dinamica; le dipendenze sono locali. GitHub Le pagine non possono impostare ogni intestazione di sicurezza del server; utilizzare un dominio/proxy controllato per un ulteriore indurimento.

## Segnala una vulnerabilità

Non pubblicare mai una chiave, il codice QR, il registro confidenziale terminal, il file host.json o l'esportazione a volta. Prima della divulgazione pubblica, il manutentore deve stabilire un canale di report privato e una politica di rotazione.

## Confine desktop

Il rendering del desktop è sandboxed, con Node l'integrazione disabilitata e l'isolamento del contesto abilitato. Riceve una stretta interfaccia IPC precaricata, validata contro la cornice principale dell'applicazione. `jaunt://app/` schema; la navigazione esterna apre il browser di sistema e non riceve mai il ponte host. Il relè ammette anche l'esatta origine del renderr nativo `jaunt://app` i controlli di origine non sono autenticazione: i client nativi hanno ancora bisogno di funzionalità di routing e il handshake crittografato host-authenticated. L'accesso locale utilizza la presa di controllo Unix privata esistente e garantisce gli stessi privilegi di account come il CLI. Non è un secondo ascoltatore di rete e non bypassa l'autenticazione remota.

I checksum rilevano artefatti corrotti/mismati; non proteggono da un repository compromesso/release editore. I pacchetti desktop contengono solo file di applicazione consentiti e dipendenze di runtime, non profili di stato o utente host. I override di sandbox di rendering di prova non devono mai entrare in launcher di produzione.
