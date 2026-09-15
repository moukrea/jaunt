[English](../../../RELEASE_NOTES.md) · [fr](../../fr/docs/RELEASE_NOTES.md) · [es](../../es/docs/RELEASE_NOTES.md) · [it](RELEASE_NOTES.md) · [pt](../../pt/docs/RELEASE_NOTES.md) · [de](../../de/docs/RELEASE_NOTES.md)

# jaunt 0.1.0-beta.11

Gli aggiornamenti host compatibili ora sostituiscono il runtime mantenendo i processi shell ordinari, le loro directory di lavoro, l'ambiente e la cronologia terminal. I clienti si riconnettono automaticamente. Gli host più vecchi hanno bisogno di una migrazione protetta: il loro shells attivo non può essere conservato retroattivamente, e l'installatore richiede ancora un'autorizzazione esplicita prima di terminarli.

Lo spazio di lavoro condiviso corregge le etichette delle impostazioni spremute, le posizioni della scheda instabile, i salti della storia mobile e i messaggi di errore di grandi dimensioni. Codex i programmi di primo piano utilizzano localmente in bundle le icone del marchio Meteor nelle schede e nelle didascalie del pannello. terminal icona.

Web, desktop, Android e CLI supportano il rilevamento della lingua del sistema e le preferenze esplicite di inglese, francese, spagnolo, italiano, portoghese e tedesco. L'inglese rimane la documentazione del repository canonico, con copie tradotte collegate. La pagina web introduce il progetto e fornisce comandi di installazione copiabili; le applicazioni native aprono direttamente lo spazio di lavoro.

L'installatore offre `--client-only` per un client desktop senza installare un host locale o esporre i controlli degli host locali. Le operazioni di aggiornamento e trasferimento conservano i progressi visibili e i risultati finali. Le finestre desktop sono intitolate `jaunt`; l'applicazione web installata è denominata `jaunt (PWA)`. Le icone di lancio e web utilizzano l'opera d'arte trasparente fornita.

Il protocollo non è stato sottoposto ad un controllo di sicurezza indipendente. La convalida del telefono fisico non è richiesta. Vedi [il rapporto di convalida](SEAMLESS_WORKSPACE_VALIDATION.md) per i test osservati e i limiti della piattaforma rimanenti.
