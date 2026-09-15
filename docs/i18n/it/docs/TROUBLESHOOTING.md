[English](../../../TROUBLESHOOTING.md) · [fr](../../fr/docs/TROUBLESHOOTING.md) · [es](../../es/docs/TROUBLESHOOTING.md) · [it](TROUBLESHOOTING.md) · [pt](../../pt/docs/TROUBLESHOOTING.md) · [de](../../de/docs/TROUBLESHOOTING.md)

# Risoluzione dei problemi

| Sintomo | Diagnosi e azione |
|---|---|
| “Relay non è stato implementato” | La pagina contiene ancora `relay:null`. Completa la distribuzione del proprietario. Non sostituire un URL fittizio.
| `jaunt` non trovato dopo l'installazione | Aprire una nuova shell o utilizzare `~/.local/bin/jaunt`. Aggiungi `~/.local/bin` a PATH se la configurazione shell esclude. |
| `curl (23)` durante il download della configurazione | curl non poteva scrivere i dati ricevuti. Le fasi di installazione sul filesystem runtime invece di `/tmp`, apre i file di download in Bash, e retries curl scrivono fallimenti attraverso Python. Esaurimento effettivo o negazione di scrittura sul filesystem di installazione provoca ancora un errore di archiviazione.](INSTALLER_FEDORA.md). |
| Consumato o scaduto codice QR | Su un dispositivo ricordato, aprire la scheda host invece di riutilizzare il vecchio codice QR. Per un nuovo dispositivo, eseguire `jaunt pair`.
| Host offline | Controlla `jaunt status`, connettività WSS/443 in uscita, sonno/ibernazione e `jaunt doctor`. Non è necessario alcun nuovo codice QR. |
| Servizio Utente non disponibile `jaunt start` eseguire in background. Configurare un servizio utente reale per l'avvio dopo il riavvio. Linux, l'esecuzione durante l'accesso dipende anche da Linux systemd, che può richiedere un amministratore.
| Aggiornamento rifiutato | Ordinario PTYs sono attivi. Finiscili, o usi esplicitamente `jaunt_ALLOW_RESTART=1` e accetti la loro terminazione. tmux è consigliato per le attività di lungo periodo.
| Camera negata o mancante | Consentire l'accesso della fotocamera su HTTPS, selezionare un file di immagine QR o incollare il codice completo.
| Immagine non riconosciuta come un allegato agente | Upload-plus-path funziona senza un desktop grafico. La pasta nativa richiede un clipboard host e uno strumento CLI che lo legge.
| Nessuna notifica push | Controllare la registrazione in Impostazioni, autorizzazione del browser, un PWA installato se necessario, connettività in uscita al servizio push e `jaunt notify`. Le notifiche non vengono generate automaticamente per ogni applicazione shell. |
| Grande file respinto | Il limite host è 512 MiB; i download in-memory sono limitati a 128 MiB. Utilizzare la scrittura diretta del file se offerto dal browser. Questo limite aiuta a evitare di uccidere una scheda mobile.
| PIN perso | Non c'è backdoor di recupero. Reimpostare la volta locale, coppia di nuovo, e revocare la vecchia identità sull'host.
| Ricollegato ma il compito è scomparso | Il demone/OS riavviato; un ordinario PTY era un figlio di quel demone. tmux per sopravvivere riavviamenti di demoni. |
| Il testo copiato troncato | La storia è legata: 2 MiB sull'host, 10.000 linee sul client.
| Relay 429 risposta | Il progetto ha un proprio relè, ma questo non garantisce l'immunità da quote o abuso. Controllare metriche Cloudflare, conteggi di connessione e limiti di camera.

Non collegare mai `host.json`, un codice QR, un'esportazione IndexedDB, o un file confidenziale a un rapporto pubblico. Per disinstallare, eseguire `jaunt service uninstall`, quindi `jaunt stop`, quindi rimuovere i runtime binari.
