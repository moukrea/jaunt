[English](../../../AGENTS.md) · [fr](AGENTS.md) · [es](../es/AGENTS.md) · [it](../it/AGENTS.md) · [pt](../pt/AGENTS.md) · [de](../de/AGENTS.md)

# Lignes directrices pour la contribution jaunt

- Lire SECURITY.md et docs/PROTOCOL.md avant de modifier le transport.
- L'arbitraire shells est la fonction centrale. Ne limitez pas l'accès aux agents de l'IA.
- Ne mettez jamais de secrets dans les URLs de requête, les journaux ou les tests publiés; appairing utilise le fragment.
- Rendre le contenu DOM à distance avec textContent, jamais innerHTML. Aucun script CDN d'exécution dans l'interface utilisateur.
- Ne jamais rejouer terminal entrée après la reconnexion. Les chargements utilisent des offsets idémpotent et SHA-256 s'engage.
- N'envoyez jamais Enter automatiquement après avoir collé une image/chemin. Affichez les capacités natives réelles.
- Ne fermez pas PTYs lorsqu'un navigateur se déconnecte. Préservez l'identité à travers les mises à jour.
- Essais: pytest; node --test tests/relay.test.mjs; npm test:relay; python tests/browser_e2e.py.
- docs/VALIDATION.md enregistre les observations, pas les promesses.
- Écrire la documentation du dépôt, les directives de contribution et les notes de publication en anglais par défaut. La localisation de l'application est séparée.
