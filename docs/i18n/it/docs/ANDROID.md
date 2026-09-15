[English](../../../ANDROID.md) · [fr](../../fr/docs/ANDROID.md) · [es](../../es/docs/ANDROID.md) · [it](ANDROID.md) · [pt](../../pt/docs/ANDROID.md) · [de](../../de/docs/ANDROID.md)

# jaunt Android

The Android pacchetti client l'interfaccia funzionale esistente in un APK. Codice Java nativo implementa l'accesso clipboard, la fotocamera QR scansione, selezione dei file / salvataggio e una connessione di notifica in primo piano opt-in. L'interfaccia utente rimane HTML/JS in Android Sistema WebView. Nessun runtime JavaScript proviene da un CDN o dalla pagina pubblica: i beni sono raggruppati in APK.

## Uso

Installare il APK firmato dal rilascio Android, quindi aprire jaunt e eseguire la scansione `jaunt pair` QR dell'host. Android può chiedere di consentire l'installazione dal browser utilizzato per scaricarlo. Questa autorizzazione è solo per l'installazione; non è necessario alcun nuovo account cloud.

Aprire shell e utilizzare Incolla dopo la copia di uno screenshot. Con un clipboard host supportato l'immagine viene caricata, copiata in quel appunti e Ctrl+V viene inviato al selezionato PTY senza Enter. Altrimenti rimangono le scelte esplicite di percorso/attaccamento esistenti. Android's file/gallery picker. Immagini condivise da un'altra app richiedono una conferma che nomina la destinazione shell. Download aperti AndroidSalva la finestra di dialogo.

Abilitare Android notifiche di sfondo sotto Impostazioni per ogni host. Android richiede il permesso di notifica; una notifica persistente mostra il conteggio di connessione e offre Stop. Le notifiche visualizzano il titolo e il messaggio del programma e aprono il suo host/sessione quando viene premuto. Android controlla la visibilità dello schermo di blocco. jaunt non raschio terminal output per fabbricare il testo di notifica. `jaunt notify "Need your attention"` e `jaunt run -- command` il servizio utente dell'host deve essere attivo.

Android può limitare l'accesso alla rete in condizioni di idle profondo o sotto le politiche della batteria del fornitore. Force-stop impedisce il funzionamento automatico fino a quando l'applicazione non è aperta di nuovo. La consegna di notifica non è garantita. Un servizio di primo piano non è una VPN e non richiede le credenziali Firebase/FCM.

## Limiti di sicurezza

- `WebViewAssetLoader` serve solo beni in bundle a `https://moukrea.github.io/jaunt/`. Le attività mancanti non sono chiuse. I collegamenti esterni si aprono al di fuori del privilegiato WebView.
- Il ponte messaggi nativo accetta solo l'esatta origine HTTPS e la cornice principale. Nessun file / contenuto di caricamento URL, traffico di testo chiaro, rilascio WebView debugging o backup è abilitato.
- Android le identità di notifica utilizzano la chiave del dispositivo già accoppiata e jaunt v1 PSK-authenticated ephemeral P-256/HKDF/AES-GCM canale. I contatori autenticati rigettano la ripetizione. L'interoperabilità del protocollo nativo viene testata contro il rilascio installato Python ospite.
- Solo l'esplicita opzione di notifica di sfondo copia i campi di identità richiesti in Android Keystore-encrypted storage.Scorda/rivocazione li rimuove.Il blocco di Vault nasconde i dati terminal ma non disabilita una connessione di sfondo abilitata separatamente.
- Codici di accoppiamento, contenuti di appunti, chiavi di firma, registri terminal e identità locali non rilasciano beni.
- Il protocollo e questa nuova implementazione nativa non hanno avuto un controllo di sicurezza indipendente**.

## Costruisci e rilascia

Utilizzare JDK 17, Android SDK piattaforma 37.0, built-tools 36.0.0 e l'involucro di livello controllato. Il comportamento di destinazione è Android 16/API 36; API di installazione minima è 26. dipendenze di grado e checksum di artefatto sono generati da risoluzione reale e check-in.

```sh
npm ci
npm run prepare-web
android/gradlew -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

`android-v*` tags run `.github/workflows/android.yml`. Il tag deve corrispondere `versionName`. Signing utilizza i segreti del repository `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD` e `ANDROID_KEY_ALIAS`; la chiave è materializzata solo nella directory temporanea del corridore e rimossa in seguito. APK, SHA256SUMS e l'output di verifica certificato di firma. Un rilascio esistente non viene mai sovrascritto. Host `v*` i rilasci rimangono separati con i loro tre asset di installatore.

Il test Android APK contiene un dispositivo di blocco isolato per l'emulatore. Non viene spedito nel rilascio APK e non aggiunge alcun endpoint di debug di produzione. L'automazione Debug WebView è disabilitata nelle versioni di rilascio.

## Validazione

Vedi `docs/evidence/android-report.json` per risultati osservati. Fisico Android fotocamera, tastiera / differenze di tempo, restrizioni della batteria del fornitore, reale Wi-Fi/mobile handoff e deep-idle comportamento di notifica ancora richiedono la validazione fisica-dispositivo. Emulatore screen-off test viene segnalato separatamente. Claude Code/Codex costruire visualizzato un allegato semplicemente perché clipboard byte e Ctrl+V La consegna e' passata.

## Aggiornamenti di applicazione

Il rilascio APK controlla il canale di rilascio pubblicato automaticamente quando aperto (al massimo una volta per sei ore); una connessione di sfondo abilitata controlla anche e può avvisarti di un aggiornamento. jaunt scarica il APK solo dopo aver scelto Scaricare e installare, verifica SHA-256 contro il file checksum di rilascio, verifica l'ID dell'applicazione e firma il certificato contro l'app installata e rifiuta i downgrade della versione. AndroidIl suo installatore chiede quindi la conferma. Android può richiedere “Allow from this source” per jaunt. Una normale app sideloaded non può ignorare silenziosamente questa conferma del sistema operativo.

L'aggiornamento APK è condiviso con l'installatore di Android tramite una sovvenzione di FileProvider privata, non una directory pubblicamente leggibile.
