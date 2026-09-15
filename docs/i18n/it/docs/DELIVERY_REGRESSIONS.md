[English](../../../DELIVERY_REGRESSIONS.md) · [fr](../../fr/docs/DELIVERY_REGRESSIONS.md) · [es](../../es/docs/DELIVERY_REGRESSIONS.md) · [it](DELIVERY_REGRESSIONS.md) · [pt](../../pt/docs/DELIVERY_REGRESSIONS.md) · [de](../../de/docs/DELIVERY_REGRESSIONS.md)

# Correzioni di regressione di consegna — 15 settembre 2026

Il precedente superamento dei test non ha stabilito l'avvio corretto dell'utente shell, lo scorrimento del tocco utilizzabile o il percorso di avvio predefinito dell'archivio Ubuntu.

## Cause e modifiche riprodotte

- I profili di login Bash possono omettere `.bashrc`. Il servizio-lanciato shell ha quindi perso aggiunte PATH interattive e colori rapidi. Nuove sessioni caricare l'ambiente di login e quindi la configurazione di bash interattiva; SHELL mancante utilizza l'account shell.
- Aggiornamenti host non presidiati saltano l'installazione di GUI e le richieste di autorizzazione di sistema. Installazione grafica interattiva e `jaunt gui` esplicita installano ancora l'app desktop.
- L'archivio desktop pubblicato aborti sotto Ubuntu 24.04 ristretto user namespaces con un errore sandbox-helper. L'installatore ora seleziona il pacchetto di sistema verificato lì, permettendo il suo ambito AppArmor supporto per essere installato senza disabilitare Chromium sandboxing.
- Il logo nativo extraResource ha escluso la sua fonte dai beni web confezionati, rompendo il logo in-app. La risorsa nativa ora utilizza un'icona del desktop generata, mantenendo l'originale nei beni web.
- L'imballaggio dell'icona Linux ha utilizzato una directory tematica non indicizzata 547×547, che ora include otto dimensioni standard derivate dall'opera d'arte originale.
- I fotogrammi UI vengono ora da Lucide 1.46.0, in bundle localmente con la sua licenza ISC. Android utilizza un wrapper di launcher adattativo intorno all'opera d'arte fornita.
- UI di nuova sessione non offre più tmux. Le sessioni esistenti tmux e la compatibilità con gli host rimangono intatte.
- Android touch swipes non ha fatto scorrere il viewport virtuale di xterm. Un touch handler fornisce scorrimento e slancio; il ridimensionamento della tastiera mantiene l'ancora di lettura invece di saltare alla prima o all'ultima riga.
- Il testo di notifica del programma è stato scartato. OSC 9 messaggi e OSC 777 titolo / corpo ora raggiungono le notifiche native. Gli obiettivi di notifica rimangono in sospeso fino a quando non è disponibile il loro host / sessione. terminal l'uscita è raschiata.
- La vista divisa è nella barra delle schede del desktop, con la creazione diretta accanto/sotto, le divisioni di sessione esistenti, il layout perseverato, e la scheda mobile fallback.

## Validazione locale osservata

- `npm install` / `npm audit`: dipendenze pinned e file di blocco reale; vulnerabilità note zero al momento di questa esecuzione. Node 25.5.0, npm 11.8.0, Electron 44Q.3.0, electron-builder 26.15.3.
- `.venv/bin/python -m pytest -q`: 63 passato su Python 3.14.2, incluso il reale PTY login-PATH/color-prompt regressione e chunked notifica-content test.
- `node --test tests/js.test.mjs tests/relay.test.mjs`: 21 passato.
- `npm run test:relay`: 2 veri test di routing Miniflare/workerd superato.
- `npm run prepare-web` e `.venv/bin/python scripts/check_project.py`: passato; jsQR locale, xterm, Lucide e licenze.
- `.venv/bin/python scripts/build_release.py`: costruito una ruota non-editable 0.1.0b9.
- `.venv/bin/python tests/browser_e2e.py`, anche con `jaunt_E2E_RELAY=workerd`: 23 scenari passati per backend.
- `.venv/bin/python tests/terminal_render_e2e.py`: pergamena, ancora di lettura di altezza della tastiera, selezione e temi passati, più effettivo isolato Claude Code e avvio Codex.
- `DISPLAY=:179 .venv/bin/python tests/shared_workspace_e2e.py`: condiviso locale/remoto PTY, proprietà della geometria, distacco/terminazione e ripiegamento del riquadro mobile superato.
- Android/debug compilazioni, lint e attività unità passate. `tests/android_workspace_e2e.py` sull'emulatore Android 14/API 34 ha superato il vero tocco di swipe, l'ancoraggio della tastiera reale, gli insiemi di sistema, la rotazione, lo schermo-off OSC titolo / corpo e toccando la notifica nella sessione corretta.

Candidato installato `.deb` più non-editable 0.1.0b9 ruota passata su Ubuntu 24.04: reale PTY esecuzione, Seccomp=2/NoNewPrivs=1 renderr, loghi in-app decodificato, Lucide disponibile a livello locale e icone di launcher standard leggibili. Il desktop candidato autenticato anche attraverso il relè pubblico e provato un comando remoto. `scripts/check_desktop_package.mjs` ora controlla questi percorsi di risorse confezionati e Linux metadati in CI.

La scansione del binario ASAR ha prodotto due falsi positivi recensiti negli identificatori JavaScript (`FourKeyMap` e `SequencerByKey`); nessuna credenziale era presente.

## Consegna pubblica

PR [20](https://github.com/moukrea/jaunt/pull/20) fuso come `cb0cb99910978e0874cf00235a046f47ff297d72` dopo tutti i controlli passati. Backup `backup/pre-delivery-fixes-20260915` conserva lo stato precedente.

- Pagina pubblica: https://moukrea.github.io/jaunt/
- Host: [v0.1.0-beta.9](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.9), esattamente tre attività. Tutti i checksum, i percorsi di archivio e tutti i 16 file di origine Python/installer sono stati verificati contro la fonte consegnata.
- Desktop: [desktop-v0.1.0-beta.7](https://github.com/moukrea/jaunt/releases/tag/desktop-v0.1.0-beta.7), 10 Linux/macOS pacchetti più SHA256SUMS. Tutti i dieci download corrispondono ai checksum. Installato pubblico Ubuntu pacchetto: reale locale e remoto shell esecuzione, sessione browser/desktop condivisa, terminazione da entrambi i lati, logo decoded, icone standard leggibili e renderer sandboxed.
- Android[android-v0.1.0-beta.5](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.5), versioneCode 5. Il pubblico APK27 risorse web in bundle corrispondono alla fonte; l'installatore host è intenzionalmente escluso dal Android build. Il suo checksum e il certificato di firma esistente sono stati verificati. Installazione sul beta.4 pubblico APK automazione UI nativo sul rilascio APK poi creato un shell, ha dimostrato un risultato di comando sull'host, e ha terminato la sessione.

Il comando esatto estratto dalla pagina pubblica passato in un contenitore Fedora 43 fresco e un account fresco nella VM Ubuntu 24.04:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

L'installazione grafica interattiva Ubuntu ha selezionato automaticamente il pacchetto desktop del sistema pubblico. Il servizio host è stato abilitato, in esecuzione e connesso; una valida QR SVG è stata generata senza stampare o pubblicare il suo segreto.

La pagina pubblica → Cloudflare → accettazione della ruota pubblica superato 12 controlli: accoppiamento, ingresso esatto 512-character, multiplo shells, confronto di file byte, immagine/percorso/no-Enter fallback, reload, vera interruzione di rete VM IPv4/IPv6 con la stessa sessione/PID, rifiuto di distruggere attivo shells, riavvio esplicitamente autorizzato con identitÃ trattenute e revoca.](../../../evidence/public-report-beta9.json).

Questo PC del manutentore è stato aggiornato anche attraverso l'installatore pubblico per ospitare 0.1.0b9 con le sue chiavi host/dispositivi esistenti conservate. shell trovato e scappato `codex-cli 0.154.0` attraverso PATH e prodotto un prompt colorato; solo che la sessione temporanea è stata terminata. Il beta.7 desktop pubblico è stato installato e continua a funzionare Ubuntu.

Testimonianza CI: [controlli di RCP](https://github.com/moukrea/jaunt/actions/runs/34960446113), [pacchetti desktop](https://github.com/moukrea/jaunt/actions/runs/34960446067), [Android](https://github.com/moukrea/jaunt/actions/runs/34960446100). Pubblicazione: [host](https://github.com/moukrea/jaunt/actions/runs/34960988005)[desktop](https://github.com/moukrea/jaunt/actions/runs/34961170116), [Android](https://github.com/moukrea/jaunt/actions/runs/34961169894)[Pages]](https://github.com/moukrea/jaunt/actions/runs/34961981670). La pagina pubblica 28 risorse controllate corrispondono ai file consegnati sotto `/jaunt/`. La salute del relè esistente e autenticata reale WebSockets passato; nessun URL di relè o relè di terze parti è stato inventato.

![Public pacchetto desktop con il logo fornito e le icone dell'interfaccia Lucide](../../../evidence/desktop-release-beta7.png)

## Limiti di mantenimento

Fisica Android hardware, tastiere specifiche del fornitore / politiche di lotta, reale Wi-Fi/cambio mobile, macOS runtime e ARM runtime non sono convalidati da questi test. Android I test di emulatore sono identificati come tali. Claude Code/Codex le conversazioni non sono coperte da test di avvio isolati. **Il protocollo rimane indipendentemente non verificato.**
