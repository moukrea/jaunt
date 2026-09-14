# Commencer avec cette archive

**Jaunt 0.1.0-beta.1 — projet complet, livraison source et wheel hôte.**

1. Placer le contenu du dossier `jaunt/` à la racine du dépôt `moukrea/jaunt`, en conservant son historique et une sauvegarde de l'état précédent.
2. Donner `DEPLOY_AGENT_PROMPT.md` à l'agent disposant de l'accès GitHub. Il réalise la configuration du relais partagé, des releases et de GitHub Pages. La seule permission externe nécessaire est l'accès au compte Cloudflare du propriétaire du projet.
3. Après la recette de déploiement, l'utilisateur final installe l'hôte avec la commande indiquée dans README.md et appaire sa PWA une seule fois.

Il ne faut pas publier `web/config.json` avec `relay: null` : c'est un garde-fou volontaire tant que l'URL réelle n'est pas connue. Les workflows remplissent cette configuration après le déploiement.

**Pour essayer localement sans déployer :** suivre la section Développement local du README (`python scripts/dev.py`). Ce mode n'est accessible que depuis la même machine et ne remplace pas le relais de production.

## Où regarder

- `README.md` : fonctionnalités, installation et limites.
- `DEPLOY_AGENT_PROMPT.md` : prompt prêt à donner à l'agent.
- `docs/VALIDATION.md` : résultats réellement observés et périmètre non testé.
- `docs/evidence/` : preuves JSON et captures navigateur.
- `SECURITY.md` : permissions, secrets, protocole non audité et précautions GitHub Pages.
- `release/` : wheel hôte construit et ses checksums, prêt à être publié par l'agent après sa CI.

L'archive ne contient aucun secret d'appairage ni aucun compte préconfiguré. L'application Android native future n'est pas incluse : l'interface livrée est une PWA mobile/PC.
