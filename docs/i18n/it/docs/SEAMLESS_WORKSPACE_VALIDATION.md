[English](../../../SEAMLESS_WORKSPACE_VALIDATION.md) · [fr](../../fr/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [es](../../es/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [it](SEAMLESS_WORKSPACE_VALIDATION.md) · [pt](../../pt/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [de](../../de/docs/SEAMLESS_WORKSPACE_VALIDATION.md)

# Validazione dello spazio di lavoro e dell'aggiornamento di runtime — 2026-09-15

Versioni del candidato: host `0.1.0b11`, desktop `0.1.0-beta.10`, Android `0.1.0-beta.8` / codice versione 8. La verifica della pubblicazione è in attesa mentre questo ramo è in prova. Nessun host di produzione o utente ordinario shell è stato fermato per questi test.

## Risultati osservati

| Comando | Risultato osservato |
| --- | --- |
| `.venv/bin/python -m pytest -q` | Sono passati 77 test, tra cui vere transizioni di programma PTY. |
| `npm test` | 30 test superati. |
| `npm run test:relay` | Sono passati gli scenari Miniflare/workerd WebSocket. |
| `.venv/bin/python scripts/check_project.py` | Python/JavaScript sintassi, importazioni locali, risorse di pagina e sintassi dell'installatore passato. |
| `.venv/bin/python tests/browser_e2e.py` | 23 scenari passati con reale PTYs, autenticazione, riconnette, byte confronti, clipboard fallback e revoca. |
| `jaunt_E2E_RELAY=workerd .venv/bin/python tests/browser_e2e.py` | Gli stessi 23 scenari sono passati attraverso l'implementazione effettiva del Worker.
| `.venv/bin/python tests/terminal_render_e2e.py` | Real isolato `claude` e avvio `codex`, le loro icone della scheda Meteor/pane, le dimensioni terminal, la selezione e lo scorrimento-to-latest passato.
| `DISPLAY=:179 .venv/bin/python tests/shared_workspace_e2e.py` | Electron e browser hanno condiviso uno PTY, la proprietà delle dimensioni, dei controlli di sessione e dei gruppi di divisione persistenti passati.
| `.venv/bin/python tests/feedback_e2e.py` | Handhakes/RPC interrotti, feedback contestuale limitato, controlli di progresso e commutazione tra host reali passati.
| `.venv/bin/python tests/workspace_usability_e2e.py` | Posizione della scheda stabile, riordine del puntatore, rinomina doppio clic, non rinominare a lunga pressione, stato della barra laterale salvato, Impostazioni reattive e ancora di scorrimento mobile mantenuto passato.
| `.venv/bin/python tests/i18n_e2e.py` | Sei impostazioni del browser, override salvate esplicite e sei lingue di aiuto CLI passate; argomenti di comando e dati utente letterali sono rimasti invariati.
| `.venv/bin/python tests/handoff_e2e.py` | Tempo di esecuzione effettivo `exec` daemon mantenuto/PTY PIDs, l'ambiente, cwd e l'esecuzione dei comandi del browser. shell potrebbe ancora essere terminato. |
| `.venv/bin/python scripts/build_release.py` poi `.venv/bin/python tests/installer_e2e.py` | Una ruota installata ha sostituito il suo runtime mantenendo in vita un vero shell. I record di identità e dispositivo sono rimasti intatti; nessun gestore di servizi account è stato toccato.
| `jaunt_LEGACY_RELEASE_DIR=<verified public beta.10 assets> .venv/bin/python tests/installer_e2e.py` | Il vero host di eredità pubblica ha rifiutato la migrazione con un shell attivo. Il riavvio esplicito di questo apparecchio isolato l'ha chiuso e l'identità/dispositivi conservati.
| `DISPLAY=:179 .venv/bin/python tests/client_only_e2e.py` | Attualità Electron la modalità client-only non ha reso locale CLI chiamate; accoppiato tramite il relè del proprietario distribuito ed eseguito un comando su un host remoto isolato. `jaunt` titolo di finestra passato. |
| `npm audit --omit=optional` | Nessuna vulnerabilità segnalata. |
| `.venv/bin/python -m pip_audit` | Nessuna vulnerabilità di dipendenza nota. Il progetto localmente installato non è una distribuzione PyPI-auditable. |
| Android Gradle release/debug build, test unitari e lint | Passato dopo aver sostituito un helper di stream API-33 con un loop di lettura compatibile con API minima 26.

Lo scenario nativo client-solo utilizza il relè WSS effettivo del proprietario perché un relè loopback insicuro non deve essere accettato da un'origine di applicazione confezionata. Il suo stato ospite e shell sono dispositivi di prova temporanei.

## Rimangono i confini di validazione

Installazione pubblica di rilascio, aggiornamenti delle applicazioni installate, la pagina pubblicata e la firma finale APK sono controllati dopo la pubblicazione; le loro osservazioni saranno allegate qui. Fisico Android telecamera, galleria, blocco-screen push e Wi-Fi/mobile handover non sono stati testati su un telefono fisico autorizzato. Le osservazioni dell'emulatore sono segnalate separatamente. Un launcher o browser può controllare la mascheratura dell'icona e l'approvazione del installato PWA cambia nome/icona.

Gli host senza erogazione di runtime necessitano di una migrazione protetta. L'esistente shells ordinario su quelle versioni non può essere retroattivamente conservato dal nuovo codice. Aggiornamenti compatibili mantengono i processi; un esplicito arresto daemon, crash o riavvio della macchina non è reso sopravvivivente da questo meccanismo.

Il protocollo di crittografia non ha ricevuto un controllo di sicurezza indipendente**. I test funzionali non cambiano lo stato.
