[English](../../../WORKSPACE_VALIDATION.md) · [fr](../../fr/docs/WORKSPACE_VALIDATION.md) · [es](../../es/docs/WORKSPACE_VALIDATION.md) · [it](WORKSPACE_VALIDATION.md) · [pt](../../pt/docs/WORKSPACE_VALIDATION.md) · [de](../../de/docs/WORKSPACE_VALIDATION.md)

# Validazione dello spazio di lavoro — 2026-09-15

Questo rapporto registra osservazioni, non una certificazione. Il protocollo personalizzato rimane indipendentemente non verificato. I controlli di distribuzione e di rilascio installati sono registrati in [PUBLIC_DELIVERY.md](PUBLIC_DELIVERY.md); la tabella seguente registra i controlli di sviluppo e piattaforma.

## Osservazioni locali

| Comando / ambiente | Risultato osservato |
|---|---|
| `.venv/bin/python -m pytest -q` | 61 è passato, tra cui un vero e proprio lavoro shell/background che ignora la fine aggraziata, i lavori superstiti dopo l'uscita shell, la proprietà della geometria condivisa, la divisione OSC parsing, la crittografia/replay e gli aggiornamenti sicuri |
| `npm test` | 21 passato, tra cui la ritenzione di split-tree, temi, crittografia, input pacing/order e disconnessione-senza-input-replay |
| `npm run test:relay` | Real workerd/Miniflare WebSocket upgrade, registrazione oggetti durevoli, routing e ibernazione ping superato |
| `npm run prepare-web` | Bundles pinned xterm/fit e jsQR localmente, conserva le loro licenze, copie installer, rigenera il servizio-worker inventario |
| `python scripts/check_project.py` | Importazioni locali, percorsi di risorse e sintassi superati |
| `python scripts/build_release.py` | Una vera ruota host non-editable, manifesta e SHA256SUMS costruita con successo |
| `python tests/browser_e2e.py` | 23 scenari passati: veri comandi PTY e 512-character esplosioni, client indipendenti, recupero di rete, trasferimenti di byte esatti, comportamento di immagine/path/headless, serratura a volta e revoca |
| `DISPLAY=:179 python tests/shared_workspace_e2e.py` | Processo Electron effettivo e browser indipendente condividono uno PTY; ridimensionamento passivo non ruba dimensioni; close/reopen mantiene shell; termina tutte le visualizzazioni; le schede divise sopravvivono a ricarica e flatten sul cellulare |
| `python tests/terminal_render_e2e.py` | Pergamena a lunga uscita e ritorno ai più recenti, limiti di riga/colonna finale, controllo di selezione del testo nativo, temi perseguiti, fixture di uscita sincronizzata; installato Claude Code/Codex schermi di avvio in profili isolati e non autenticati |
| Android Gradle debug build/unit test | Processo e test unità nativo superati |
| `python tests/android_workspace_e2e.py` | Android 14 emulatore: installato APK → relè pubblico di proprietà del progetto → host reale isolato → comando collaudato; il rubinetto dello schermo effettivo apre IME e riduce il viewport; i limiti dello stato-bar, la rotazione e la notifica del sistema di screen-off da un terminal BEL passato |
| Installato `.deb` in Ubuntu 24.04.5 VM | Aperta l'app nativa, la ruota non-editable del candidato eseguito un collaudato comando locale PTY, il renderr aveva Seccomp=2 e NoNewPrivs=1, e nessun override sandbox era presente |
| `npm audit` | Zero ha segnalato vulnerabilità nell'albero di dipendenza risolto |

Il toolchain locale incluso Python 3.14.2, Node 25.5.0, npm 11.8.0, Java 17, grado 9.5.0, Electron 44.3.0, xterm 6.0.0, FitAddon 0.11.0 e jsQR 1.4.0. Node 22 e la sua configurazione Python/Linux/macOS matrice. L'effettivo installato CLI controlli di avvio utilizzati Claude Code 2.1.272 e codex-cli 0.154.0; non hanno presentato richieste di modello o ispezionano conversazioni/credentials degli utenti.

I riferimenti di versione sono stati controllati contro [ElectronE' il record ufficiale di rilascio](https://releases.electronjs.org/release/v44.3.0) e [le note di rilascio di xterm](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0). xterm 6 include il supporto di output sincronizzato. npmL'audit non sostituisce un Chromium/Electron verifica della sicurezza o verifica il protocollo personalizzato.

## I risultati corretti durante la validazione

- FitAddon misurava un genitore imbottito, assegnando file/colonne al di fuori dell'area di visualizzazione effettiva. Un supporto non imbottito separato ora fornisce l'area misurata; i test controllano entrambi i confini visibili.
- L'implementazione Android ha riempito WebView al posto del suo layout esterno. La struttura esterna ora consuma insiemi di sistema/cutout/IME e l'interfaccia utente condivisa riceve lo stato della tastiera.
- L'icona Android originale era un disegno terminal non correlato. Android ora spedisce l'esatto PNG fornito; il browser/favicon/notification/desktop riferimenti utilizzano la stessa opera d'arte.
- Il pacchetto terminal fornito non ha avuto la prova esatta di costruzione. È ora ricostruito dalle dipendenze npm pinned e entrambe le licenze a monte.
- Concludendo solo una vista e uccidendo il sottostante shell sono stati conflati, ora hanno azioni e test dell'interfaccia utente distinti.
- Le autorizzazioni del pacchetto desktop hanno ereditato un umask di costruzione privata, rendendo la directory installata inaccessibile agli utenti ordinari. Il gancio di confezionamento ora normalizza le directory delle applicazioni e le autorizzazioni eseguibili/dati. La validazione della sandbox confezionata viene tracciata separatamente dai test di rendering sorgente-mode. Ubuntu La VM ha esposto una libreria scomparsa.

CI ha inoltre catturato la compatibilità di macOS Bash 3.2 nell'ambiente-alias bootstrap e un vecchio-ruota / nuovo-installer State-directory mismatch. La compatibilità boottrap ora funziona prima di importare una vecchia ruota, comprese le successive invocazioni CLI. Il reale Fedora limitato-curl test passa con il beta.5 ruota pubblica e l'installatore candidato.

La matrice ospite passò Linux e macOS con Python 3.11 e 3.13. Su macOS, l'host utilizza il sistema di fissaggio cameriera quando Python omette, seguendo il pubblico di Apple [wait.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/wait.h) e [signal.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/signal.h) definizioni, sia in esecuzione che in uscitashell la cessazione del lavoro di fondo sono esercitate dagli stessi test di processo reale su entrambi i sistemi operativi.

Il test Electron utilizza un override sandbox solo per test in un server X isolato. Il controllo separato del pacchetto installato è passato senza che il override sulla VM Ubuntu. Il codice principale/precarico di produzione non disabilita mai la sandbox.

## Rimangono i confini di validazione

Non è stato disponibile alcun ricevitore fisico Android. Fotocamera reale QR cattura, variazioni di galleria, comportamento di gesto-navigazione OEM, rotazione fisica, Wi-Fi/mobile handover, e la consegna di notifica deep-idle rimangono non validati.

L'avvio effettivo di CLI e un dispositivo di uscita sincronizzato sono testati; una conversazione di modello autenticata completa, il comportamento redraw di ogni release CLI, e ogni applicazione dell'attacco dell'immagine specifica dell'agente non sono rivendicati come convalidati.

macOS esecuzione del desktop, richieste di fiducia del sistema operativo, hardware ARM, presentazione della notifica del desktop in ambienti desktop, e la consegna push-provider del browser richiedono prove specifiche della piattaforma. terminal/phone è promesso.
