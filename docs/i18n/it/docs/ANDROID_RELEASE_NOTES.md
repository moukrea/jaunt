[English](../../../ANDROID_RELEASE_NOTES.md) · [fr](../../fr/docs/ANDROID_RELEASE_NOTES.md) · [es](../../es/docs/ANDROID_RELEASE_NOTES.md) · [it](ANDROID_RELEASE_NOTES.md) · [pt](../../pt/docs/ANDROID_RELEASE_NOTES.md) · [de](../../de/docs/ANDROID_RELEASE_NOTES.md)

# jaunt Android 0.1.0-beta.8

Questo aggiornamento aggiunge tocco scorrendo con slancio, preserva la posizione di lettura attraverso il ridimensionamento della tastiera, utilizza le icone dell'interfaccia Lucide in bundle, e utilizza il logo trasparente originale come icona del lanciatore. Utilizza l'icona jaunt originale, fornisce il gestore di sessione condiviso e temi, e riceve automaticamente terminal campane / program / sessione-exit notifiche quando abilitato.

Questa versione regola l'ingresso rapido terminal per evitare di traboccare la coda di ingresso delimitata dell'host. L'ingresso di attesa viene scartato se il canale crittografato cambia; i comandi non vengono mai riprodotti dopo la riconnessione.

Installare la firma `.apk` asset qui sotto Android 8 o più recente. Consentire l'installazione dal browser quando Android chiede, aperto jaunt, poi la scansione QR prodotto da `jaunt pair` sul tuo ospite. Android, GitHub o Cloudflare l'account è necessario per connettersi.

Si tratta di una Android APK installabile con un'interfaccia WebView e integrazioni native, non una PWA e non un'interfaccia Android completamente riscritta UI:

- Fotocamera nativa QR scansione e galleria / selezione file.
- Android immagine/text clipboard access. Viene caricata un'immagine incollata e, quando l'host ha un clipboard OS supportato, copiata lì prima di inviare Ctrl+V al selezionato shell, senza Enter. I padroni di casa mantengono un esplicito caricamento / percorso fallback.
- Risparmio di sistema finestra di dialogo per i download; il progresso di trasferimento verificato rimane disponibile da file.
- Collegamento di primo piano nativo opzionale per le notifiche, compreso mentre l'app è sottofondo. Abilita in Impostazioni. Android Le notifiche visualizzano il titolo/corpo emesso dai programmi; toccando uno apre la sessione corrispondente. Android si applicano ancora le impostazioni di privacy dello schermo di blocco.
- L'accoppiamento salvato sopravvive agli aggiornamenti delle app e alle modifiche della rete. Le chiavi sono escluse dal backup; le identità di servizio di sfondo sono crittografate con Android Keystore.

L'host deve rimanere in esecuzione; l'installatore pubblico a un comando configura il suo servizio utente. Android forza-stop, restrizioni della batteria, outage host/network e pianificazione del sistema operativo possono ritardare o prevenire le notifiche. Questo non promette la consegna garantita durante il blocco profondo. Il protocollo non ha subito un controllo di sicurezza indipendente.

Il rapporto di validazione distingue il test dell'emulatore dal test del telefono fisico e dal clipboard esatto/Ctrl+V consegna dal riconoscimento come allegato all'interno di un particolare Claude Code/Codex versione. Vedi `docs/ANDROID.md` e `docs/VALIDATION.md` nella fonte taggata.

The APK le impostazioni offrono anche un controllo immediato. I download vengono verificati contro i checksum di rilascio e l'identità di firma installata prima Android gli aggiornamenti conservano i dati e gli abbinamenti delle app; la disinstallazione li rimuove.

I controlli di sessione ora mantengono Open, Rename, Close view e Terminate all'interno di ogni scheda di sessione reattiva. shell crea un nome automatico terminal subito. Nuovo shell nella cartella offre la navigazione della directory e un nome opzionale. L'host può ereditare l'attiva shellLa directory corrente del desktop ha dei controlli separati lato per lato e sopra/sotto, una scelta in linea di sessioni nuove o esistenti, e un pulsante per spostare ogni riquadro nella propria scheda. shell vivo; la risoluzione richiede ancora una conferma esplicita.

Gli errori di dialogo rimangono in linea; gli errori di azione persistono senza cascate di brindisi. I trasferimenti espongono l'attesa/cancellazione/complezione, l'attività completa crolla nella storia accessibile e l'aggiornamento della disponibilità mantiene visibile la sua azione.

Questa versione aggiunge sei lingue UI cancellate dal sistema con un override salvato, schede trascinabili stabili con rinominamento a doppio clic, feedback di funzionamento corretto e icone locali in bundle Claude/OpenAI primo piano. L'applicazione nativa apre lo spazio di lavoro direttamente; la homepage di presentazione è riservata al sito web.
