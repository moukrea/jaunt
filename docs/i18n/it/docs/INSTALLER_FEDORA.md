[English](../../../INSTALLER_FEDORA.md) · [fr](../../fr/docs/INSTALLER_FEDORA.md) · [es](../../es/docs/INSTALLER_FEDORA.md) · [it](INSTALLER_FEDORA.md) · [pt](../../pt/docs/INSTALLER_FEDORA.md) · [de](../../de/docs/INSTALLER_FEDORA.md)

# Correzioni dell'installatore — 15 settembre 2026

Il rapporto iniziale dell'utente interessato Fedora: il comando non ha prodotto alcun output e l'eseguibile è rimasto su beta.2. Non c'è stato alcun accesso remoto a quella macchina. Le correzioni iniziali di boottrap non hanno stabilito la causa sulla macchina dell'utente. `curl (23) Failed writing body` durante il `config.json` scarica.

## Difetti e correzioni riprodotti

- Il vecchio comando `curl -fsSL … | bash` restituisce 0 quando il curl non riesce e Bash riceve un ingresso vuoto. Il comando ufficiale ora utilizza Bash con `pipefail`, il progresso visibile, un timeout di connessione di dieci secondi e un limite di 120 secondi per il download dello script iniziale.
- L'impostazione del file di output `.curlrc` può assorbire lo script in modo da non funzionare. Questo è stato riprodotto utilizzando il curl reale e un server HTTP locale. Il principale `-q` ignora quella configurazione nel comando ufficiale; i download interni utilizzano `--disable`.
- Lo script annuncia immediatamente l'avvio e ogni download. Errori inaspettati identificano la fase, la linea e il codice di uscita senza stampare segreti o comandi completi.
- I download interni di HTTPS sono limitati a 120 secondi per tentativo. Gli errori di connessione/trasferimento selezionati attivano una retry IPv4 visibile; HTTP e gli errori di certificazione non vengono bypassati. I reindirizzamenti rimangono limitati a HTTPS.
- Un processo di curl con uno spazio di nome filesystem separato non può aprire il percorso temporaneo-direttivo creato da Bash. Fedora-container curl riprodotto uscita 23 a `Downloading config.json`, prima di qualsiasi mutazione di installazione. shell reindirizzamento di uscita: Bash apre la destinazione e curl scrive attraverso stdout ereditato. Questo funziona anche quando il curl non può vedere il percorso di destinazione.
- Le guardie Active-shell, la verifica della ruota e la conservazione dell'identità rimangono in vigore.

La documentazione del curl definisce [exit 23 come un guasto di scrittura locale](https://curl.se/libcurl/c/libcurl-errors.html). Questo codice da solo non identifica la causa esatta sulla macchina dell'utente; l'isolamento del filesystem è il caso riprodotto qui.

## Osservazioni

- `pytest -q tests/test_installer_bootstrap.py`: quattro guasti contro i file precedenti di boottrap, poi quattro passaggi dopo la prima correzione. Questi coprono il fallimento della rete, il guasto HTTP, lo stato di uscita della pipeline e la reindirizzamento di uscita `.curlrc`.
- `pytest -q`: 49 test sono passati localmente con Python 3.14.2 dopo la prima correzione.
- `python scripts/build_release.py`, `npm run prepare-web`, `python scripts/check_project.py`: passato.
- `python tests/installer_e2e.py`: sono passati otto controlli, compresi i checksum manomessi, rifiutando di uccidere un vero shell attivo, e il riavvio esplicitamente autorizzato.
- Fedora 44, contenitore ufficiale fresco, precedente script pubblico attraverso `curl … | bash`: l'installazione beta.5 è riuscita. Fedora da solo non ha riprodotto il problema dell'utente.
- Fedora 44, contenitore ufficiale fresco, script corretto piped in Bash: installato la vera ruota beta.5 pubblica, con Python 3.12.14 installato da uv; uscita 0 e versione 0.1.0b5.
- Fedora 43, contenitore ufficiale fresco: precedente installatore e ruota beta.2 pubblica, seguito dal corretto installatore e dalla ruota beta.5 pubblica. Versioni controllate prima/dopo; l'identità e la tabella dei dispositivi conservati.
- Il primo comando corretto è stato recuperato dalla pagina pubblicata ed eseguito in un contenitore Fedora 43 fresco dopo [Pages deploy](https://github.com/moukrea/jaunt/actions/runs/34931947575).
- `python tests/installer_namespace_e2e.py`: vera e propria installazione della ruota pubblica con curl in un contenitore Fedora 44 e Bash/Python al di fuori di esso. Nessuna directory host viene montata nel contenitore di curl. Prima della correzione di uscita, il download di configurazione non è riuscito con l'uscita 23. Dopo la correzione, la ruota installata dal rilascio pubblico, importata dal runtime privato, e ha avviato il daemon con aggiornamenti automatici abilitati.
- Il CI richiesto include installazioni reali Fedora 43/44. Il lavoro Fedora 44 gestisce inoltre la regressione dell'installazione curl del sistema separato.

Fedora test utilizzare contenitori isolati senza un gestore di servizi utente (`jaunt_NO_SERVICE=1`) e soppresso QR output (`jaunt_SKIP_PAIR=1`). convalidano l'installazione e l'avvio di sfondo, non systemd/SELinux su un fisico Fedora workstation. Il servizio utente è stato precedentemente convalidato su Ubuntu; nessun nuovo fisico Fedora la convalida è rivendicata.

Le correzioni si applicano al punto di entrata e alla fonte di installazione di Pages. Le attività pubblicate beta.5 e APK beta.3 rimangono immutabili. L'host non ha bisogno di un nuovo numero di versione per utilizzare l'installatore aggiornato di Pages. L'installatore incorporato nella ruota beta.5 mantiene il suo codice precedente fino a un futuro rilascio dell'host.

Il protocollo rimane senza un controllo di sicurezza indipendente.

## Seguito: uscita persistente 23 dopo la reindirizzamento shell

L'utente ha successivamente segnalato lo stesso errore di scrittura alla riga 65. La regressione namespace era passata, ma non aveva risolto il fallimento dell'utente remoto.

Un separato test Fedora 44 con Python 3.14.7 e un completo 4 KiB `/tmp` tmpfs ha riprodotto l'esatto errore `curl: Failed writing body` e il guasto linea-65. Una directory e un file vuoto potrebbero essere ancora creati lì, ma la scrittura della risposta non è riuscita.

L'installatore ora sta accanto al runtime sul filesystem di destinazione, controlla che può scrivere 1 MiB là, e fornisce che la directory temporanea privata a pip/uv durante l'installazione. Non cambia il demone host o le sessioni shell TMPDIR. La directory di staging viene rimossa in uscita. Un filesystem di destinazione completo produce ancora un chiaro errore di archiviazione; l'installatore non elimina i file dell'utente.

Quando il riccio ritorna 23 e Python è disponibile, un standard-librario HTTPS Il downloader recupera il file in modo indipendente. Utilizza la validazione del certificato normale, rifiuta il non-HTTPS reindirizza, delimita l'intero trasferimento a 120 secondi e 128 MiB, rileva i corpi incompleti e svuota/fsyncs il risultato. La verifica del checksum della ruota avviene ancora prima della sostituzione del runtime.HTTP fallimenti indebolendo la convalida.

Comandi di convalida per questo follow-up:

- `pytest -q`: 53 test superati localmente. Quattro nuovi controlli esercitano la Python Fallback HTTPS e reindirizzano i confini.
- `python tests/installer_storage_e2e.py`: installazioni reali Fedora con un completo `/tmp`, e con ogni curl interno scaricato costretto a scrivere a `/dev/full`. Il secondo scenario esercita l'uscita del curl 23 seguita da veri e propri download pubblici HTTPS attraverso Python. Entrambi gli scenari controllano il daemon in esecuzione, staging clean daup e assenza di un percorso cancellato.
- `python tests/installer_e2e.py`: sono passati tutti gli otto controlli esistenti, tra cui la conservazione attiva-shell, il rifiuto del checksum e l'autorizzazione di riavvio esplicita.
- `python scripts/build_release.py`, `npm run prepare-web`, e `python scripts/check_project.py`: passato.

Il lavoro richiesto di Fedora CI esegue entrambi i nuovi scenari di installazione, oltre al precedente test namespace, che sono osservazioni dell'ambiente di prova, non una pretesa di esecuzione di successo sulla macchina Fedora inaccessibile dell'utente.
