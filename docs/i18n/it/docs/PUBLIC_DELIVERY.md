[English](../../../PUBLIC_DELIVERY.md) · [fr](../../fr/docs/PUBLIC_DELIVERY.md) · [es](../../es/docs/PUBLIC_DELIVERY.md) · [it](PUBLIC_DELIVERY.md) · [pt](../../pt/docs/PUBLIC_DELIVERY.md) · [de](../../de/docs/PUBLIC_DELIVERY.md)

# Consegna pubblica — 15 settembre 2026

Per le successive correzioni host beta.9 / desktop beta.7 / Android beta.5 e la verifica pubblica, vedere [i risultati di regressione di consegna](DELIVERY_REGRESSIONS.md). Le osservazioni qui sotto descrivono il rilascio precedente.

L'applicazione pubblicata è **https://moukrea.github.io/jaunt/**. Gli utenti finali non hanno bisogno di un account GitHub o Cloudflare, VPN o di una configurazione server in entrata.

- Host: [v0.1.0-beta.8](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.8), Python versione `0.1.0b8`.
- Desktop: [0.1.0-beta.6](https://github.com/moukrea/jaunt/releases/tag/desktop-v0.1.0-beta.6), Linux x64/ARM64 tar/deb/rpm e pacchetti macOS x64/ARM64 zip/dmg.
- Android: [signed beta.4 APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.4/jaunt-android-v0.1.0-beta.4.apk), [release e checksums](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.4).
- Relè del progetto: `wss://jaunt-relay.moukrea.workers.dev`, con `APP_ORIGIN=https://moukrea.github.io`.

## Installazione valida

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

L'esatto comando estratto dalla pagina pubblica installato `0.1.0b8` in un contenitore Fedora 43 fresco. Un successivo `jaunt gui --install-only` ha scaricato e verificato l'archivio desktop e ha creato la sua entrata di applicazione-menu. L'installatore normale esegue automaticamente questa configurazione desktop quando rileva un host grafico. `jaunt gui` apre l'app desktop installato; i pacchetti di distribuzione Linux sono disponibili anche da

Una VM Ubuntu 24.04.5 separata ha aggiornato la ruota non-editable beta pubblica.5 a beta pubblica.8, mantenendo le identità di host e dispositivi e il suo servizio utente attivo abilitato. L'aggiornamento iniziale ha selezionato esplicitamente la nuova versione pubblica prima del passaggio del canale di default Pages. La successiva ricetta di accettazione pubblica ha usato l'installatore predefinito pubblicato senza un override versione.

Aggiornamenti host automatici mantenere ordinario shells e trasferimenti. L'autorizzazione all'avvio esplicita è necessaria per distruggere attivo shells, compresi i lavori di base che sopravvivono ad un'uscita shell. Il codice finale rimuove anche l'ambiente corrente e legacy sovrascrive da installazioni automatiche. Android controlli per aggiornamenti e utilizza Android installatore di sistema; la sua conferma rimane necessaria.

## Controlli osservati

[PR #18](https://github.com/moukrea/jaunt/pull/18) si è fusa dopo i suoi controlli passati. Il [final CI](https://github.com/moukrea/jaunt/actions/runs/34950530292), [host release](https://github.com/moukrea/jaunt/actions/runs/34950562658), [desktop release](https://github.com/moukrea/jaunt/actions/runs/34948505167), e [Android rilascio](https://github.com/moukrea/jaunt/actions/runs/34948504993) passato. Rilascia precedenti [Pages deploy](https://github.com/moukrea/jaunt/actions/runs/34951111652).

| Comando o ambiente reale | Risultato |
|---|---|
| `pytest -q` | 61 superato; Linux/macOS, Python 3.11 e 3.13 |
| `npm test` | 21 superato |
| `npm run test:relay` | Due veri test Miniflare/workerd: origini web e desktop native, instradamento autenticato e ibernazione ping; origini estere rifiutate |
| `npm run prepare-web`; `python scripts/check_project.py` | Valori e licenze locali di jsQR/xterm generati; controlli delle risorse/import/syntax passati |
| `python scripts/build_release.py` | Ruota, manifesto e SHA256SUMS costruito |
| `python tests/browser_e2e.py`, con relè di sviluppo e `jaunt_E2E_RELAY=workerd` | 23 scenari per backend, con reale PTYs e trasferimenti |
| `python tests/shared_workspace_e2e.py` sotto Xvfb | Stesso PTY in Electron/browser; ultima vista attiva dimensioni esso; chiusura / riapertura e terminazione; schede di divisione persistenti e flattenzione mobile |
| `python tests/terminal_render_e2e.py` | Scorrere verso i limiti più recenti, riga finale/colonna, selezione del testo, persistenza del tema, uscita sincronizzata; effettivo isolato Claude Code/Codex startup localmente |
| `python tests/installer_e2e.py` | 8 passato, tra cui manomissione di checksum, importazione non modificabile, identità conservate e rifiuto di riavvio implicito |
| Fedora 43/44 CI; `installer_namespace_e2e.py`; `installer_storage_e2e.py` | Installazione pubblica, curl isolato, archiviazione completa temporanea e recupero curl-write-error passato |
| Android Gradle unit/lint/debug/release builds e `apksigner verify` | Passed; public APK mantiene il certificato di firma stabilito |
| `python tests/android_workspace_e2e.py` | Android 14 emulatore: relè pubblico reale e shell, apertura/ridimensionamento della tastiera effettiva, limiti della barra di sistema, rotazione e notifica terminal-BEL con schermo spento |
| Public APK beta.3 → beta.4, installato con `adb install -r` | Stesso dispositivo autorizzato ricollega senza accoppiamento; questo controllo non richiede un flusso di installazione del sistema in-app |
| Public Linux `.deb` installato in Ubuntu VM | Comando reale shell eseguito; renderr Seccomp=2 e NoNewPrivs=1, senza override sandbox |
| `python tests/desktop_remote_e2e.py`; installato desktop pubblico in VM | Il desktop nativo autentica come client remoto tramite WSS pubblico, esegue un comando collaudato e termina la sessione |
| Desktop pubblico + pubblica Pagina + ruota pubblica | Due comandi provati in uno PTY condiviso; chiusura / riapertura lo mantiene; terminazione remota rimuove entrambe le visualizzazioni |
| Host installato pubblico, shell è uscito con un lavoro di sfondo testardo | Riavvio non approvato rifiutato; desktop Terminate uccide il lavoro rimanente e rimuove la sessione |
| Attività pubbliche | Tre asset host, tre asset Android e tutti i dieci pacchetti desktop verificati contro i checksum; percorsi di archivio, segnore APK e risorse icone originali controllate |
| Public Page | Correggere tre tag di rilascio; 25 risorse controllate sotto `/jaunt/` contro byte costruite, tra cui JS locale e licenze |
| Relay pubblico | Health HTTP 200, reale WebSocket HTTP 101 e ping/pong; origine del browser straniera rifiutata con 403 |
| `gitleaks dir` sulla sorgente di Git esportata, la ruota pubblica e l'applicazione desktop estratta | Nessuna perdita rilevata |
| `npm audit`; `pip-audit --local --skip-editable` | Nessuna vulnerabilità nota riportata negli ambienti di dipendenza controllati |

Il driver di accettazione pubblica ha eseguito **12 controlli** contro la VM installata sul rilascio: accoppiamento, comprovato arbitrario-shell output, a 512-character esplosione di input, seconda scheda e ritorno, upload/download byte confronti, upload immagine più percorso citato senza Enter su un ospite senza testa, ricaricare senza QR, reale interruzione IPv4/IPv6 con la stessa shell PID in seguito, rifiuto di aggiornamento implicito, riavvio autorizzato mantenendo identitÃ, revoca e nessun errore del browser non catturato.](../../../evidence/public-report.json). Ogni esecuzione ha usato una directory di fissazione fresca; nessuna cartella personale è stata scansionata o cancellata.

La revisione finale del relè è `698962dd-b16a-49f8-b658-a3c5953b3da9` (Wrangler 4.131.2). Aggiunge l'esatta origine del renderr nativo `jaunt://app` a fianco dell'origine web configurata. Entrambe le origini pubbliche sono state controllate con aggiornamenti/ping-pong reali WebSocket e accoppiamento/comandi a distanza sono stati verificati dal pacchetto desktop invariato.

Le versioni degli strumenti e i risultati dello sviluppo sono in [WORKSPACE_VALIDATION.md](WORKSPACE_VALIDATION.md). I file consegnati UI e pacchetto utilizzano l'opera originale. Il candidato ospite beta.6 è stato sostituito prima che diventasse il canale predefinito; il flusso di lavoro di pubblicazione beta.7 è stato cancellato prima che venisse creata una release.

## Confini di convalida

Il protocollo di sicurezza personalizzato rimane **indipendentemente non verificato**. I test automatizzati e gli scanner di dipendenza non stabiliscono una certificazione di sicurezza.

Non è stato disponibile alcun ricevitore fisico Android. Fotocamera QR cattura, galleria/OEM variazioni, navigazione del gesto fisico, Wi-Fi/mobile handover, profondo idle e bloccato-screen spinta su un telefono reale rimangono non validati.

macOS l'esecuzione del desktop e i prompt di fiducia, l'hardware ARM, la presentazione della notifica del desktop in ambienti, e la consegna push-provider del browser rimangono limiti di convalida specifici della piattaforma. macOS le costruzioni del desktop sono non firmate. Linux Gli archivi per utente richiedono una sandbox Chromium funzionante; utilizzare il pacchetto di distribuzione in cui gli spazi dei nomi degli utenti sono limitati.

Gli schermi di avvio Claude Code/Codex sono stati testati senza richieste di autenticazione o di modello. Le conversazioni di agente completo e ogni applicazione dell'attacco dell'immagine specifica dell'agente non vengono rivendicate come provate. L'inserimento del percorso dell'immagine più il caricamento rimane diverso da quello del sistema operativo nativo condizionale più Ctrl+V; né invia automaticamente Enter.

Chiusura di una vista conserva la sua shell. La risoluzione esplicita termina i suoi lavori di sessione POSIX; processi deliberatamente daemonizzati che creano una sessione del sistema operativo separata sono al di fuori di quel confine. shells non può sopravvivere un reboot host o un riavvio daemon; tmux rimane facoltativo per quel requisito di persistenza separata.
