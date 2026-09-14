# Commencer avec cette archive

**Jaunt 0.1.0-beta.2 — projet complet, livraison source et wheel hôte.**

La livraison est publiée : https://moukrea.github.io/jaunt/.
L’utilisateur final installe l’hôte avec la commande du README, puis appaire sa
PWA. Le propriétaire a déjà configuré GitHub Pages et le relais Cloudflare Jaunt.
Pour maintenir ou redéployer ce projet, consulter docs/DEPLOYMENT.md.

**Pour essayer localement sans déployer :** suivre la section Développement local du README (`python scripts/dev.py`). Ce mode n'est accessible que depuis la même machine et ne remplace pas le relais de production.

## Où regarder

- `README.md` : fonctionnalités, installation et limites.
- `DEPLOY_AGENT_PROMPT.md` : prompt prêt à donner à l'agent.
- `docs/VALIDATION.md` : résultats réellement observés et périmètre non testé.
- `docs/evidence/` : preuves JSON et captures navigateur.
- `SECURITY.md` : permissions, secrets, protocole non audité et précautions GitHub Pages.
- `release/` : wheel hôte construit et ses checksums, identiques aux assets de la release publique.

L'archive ne contient aucun secret d'appairage ni aucun compte préconfiguré. L'application Android native future n'est pas incluse : l'interface livrée est une PWA mobile/PC.
