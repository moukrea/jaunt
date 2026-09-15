[English](../../../AGENTS.md) · [fr](../fr/AGENTS.md) · [es](../es/AGENTS.md) · [it](AGENTS.md) · [pt](../pt/AGENTS.md) · [de](../de/AGENTS.md)

# Linee guida del contributo di jaunt

- Leggere SECURITY.md e docs/PROTOCOL.md prima di modificare il trasporto.
- Arbitrario shells sono la caratteristica principale. Non limitare l'accesso agli agenti dell'IA.
- Non mettere mai segreti in URL di richiesta, registri o test pubblicati; l'accoppiamento utilizza il frammento.
- Render il contenuto DOM remoto con textContent, mai internoHTML. Nessun script CDN runtime nell'interfaccia utente.
- Non riprodurre mai l'ingresso terminal dopo il ricollegamento. I carichi utilizzano gli offset idempotent e gli impegni SHA-256.
- Non inviare mai Enter automaticamente dopo aver incollato un'immagine / percorso.
- Non chiudere PTYs quando un browser si disconnette. Conservare l'identità tra gli aggiornamenti.
- Test: pytest; test nodo --test/relay.test.mjs; test di esecuzione npm: relè; test di pitone/browser_e2e.py.
- docs/VALIDATION.md registra osservazioni, non promesse. Aggiornalo con precisione.
- Scrivere la documentazione del repository, la guida dei contributi e le note di rilascio in inglese per impostazione predefinita.
