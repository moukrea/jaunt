# Déploiement mainteneur

Le produit final demande uniquement une installation de l'hôte à ses utilisateurs. Le **propriétaire du projet** doit mettre en ligne les deux composants suivants une fois :

1. GitHub Pages : HTML, JS, CSS, logo, installateur et configuration publique.
2. Cloudflare Worker + SQLite Durable Object : relais WebSocket. Ne pas remplacer cela par GitHub Actions en boucle, un tunnel personnel ou les serveurs publics d'un autre projet.

## Préparation

Préserver le dépôt existant sur une branche de sauvegarde, puis intégrer ces fichiers sur une branche de travail. Ne pas écraser l'historique ni force-push. Installer Python, Node 22+, `pip install -e . -r requirements-dev.txt`, `npm ci`, `npm run prepare-web`. Le build copie jsQR 1.4.0 localement, sa licence, et génère un cache PWA versionné. Committer le `package-lock.json` réellement résolu et vérifier les licences ; ne pas inventer un lockfile.

Les versions des outils de déploiement sont épinglées et le lockfile réellement résolu est committé. Les overrides sharp/undici corrigent les avis connus du Miniflare 4 utilisé pour les tests ; voir VALIDATION.md.

## Relais

- Créer/choisir un compte Cloudflare autorisé à exécuter Workers et Durable Objects SQLite. Vérifier les conditions/quotas actuels dans ce compte.
- Donner à l'agent l'autorisation de déployer, ou renseigner les secrets Actions `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` via l'interface sécurisée GitHub. Le token doit permettre les déploiements Workers et la migration Durable Object du compte concerné.
- Le workflow `relay.yml` lance Wrangler avec `relay/wrangler.jsonc`. Nom initial `jaunt-relay`, binding `ROOMS`, classe `Room`, migration SQLite `v1`.
- APP_ORIGIN doit être `https://moukrea.github.io` (origin sans `/jaunt/`). Ne pas ouvrir `*` en production. `config.json` doit utiliser l'URL WSS réelle du Worker, sans `/v1/room/...` ajouté : le client construit ce chemin.
- Vérifier `/health`, puis **un vrai appairage et une commande chiffrée**. Un HTTP 200 de health ne valide pas les WebSockets.

## Release hôte puis Pages

1. Passer la CI. Créer le tag `v0.1.0-beta.2` (version Python correspondante `0.1.0b2`). Le workflow release construit le wheel et publie `host-manifest.json`, `SHA256SUMS` et le wheel. La release bêta est explicitement marquée prerelease.
2. Définir les variables repository `JAUNT_RELAY_URL` (WSS réel), `JAUNT_RELEASE_TAG` (`v0.1.0-beta.2`) et éventuellement `JAUNT_PAGE_URL` (défaut URL du repo). Ni token hôte ni secret de pairing dans les variables publiques.
3. Activer Pages en mode GitHub Actions. `pages.yml` construit le web, valide la configuration, copie l'installateur et publie.
4. Le workflow Pages ne doit pas être lancé avec une release inexistante. Le prompt agent impose cet ordre.

## Recette distante obligatoire

Sur une machine Linux non exposée : installer depuis la Page publiée, scanner le QR sur Chrome Android, créer un shell, exécuter une commande, uploader et télécharger un fichier, coller une image, tester les deux modes d'image selon capacités hôte, fermer/rouvrir la PWA, changer Wi-Fi↔mobile, retrouver le même shell sans QR, tester push écran verrouillé, révoquer l'appareil. Recommencer le chemin minimal sur macOS et Firefox/Safari lorsque disponibles.

Ne jamais appeler « validé » un test non exécuté. Le rapport local inclus ne prouve ni la connectivité Cloudflare en production ni le comportement d'un vrai téléphone.

## Publication et exploitation

Conserver logs techniques sans payloads, surveiller erreurs/quotas, prévoir rotation des identités et sauvegarde privée de l'état hôte, ne pas transformer le relais en dépôt de fichiers. Une mise à jour Worker peut rompre les connexions ; les hôtes et clients doivent se reconnecter sans réappairage. Les migrations DO ne sont pas annulées en supprimant seulement le code.

Sources primaires : https://developers.cloudflare.com/durable-objects/best-practices/websockets/ ; https://developers.cloudflare.com/workers/wrangler/commands/ ; https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages ; https://docs.astral.sh/uv/getting-started/installation/ .

## Déploiement observé du 14 septembre 2026

Pages : https://moukrea.github.io/jaunt/ ; relais :
`wss://jaunt-relay.moukrea.workers.dev` ; release : `v0.1.0-beta.2`.
Le Worker a été déployé avec l’OAuth Wrangler autorisé par le propriétaire,
stocké chiffré localement avec une clé dans le trousseau système.
`CLOUDFLARE_ACCOUNT_ID` est renseigné dans GitHub ; le workflow relais Actions
nécessitera son propre `CLOUDFLARE_API_TOKEN` pour un futur déploiement depuis CI.
Aucun token OAuth temporaire n’a été copié comme secret API permanent.
Cela ne demande aucune démarche Cloudflare ou GitHub aux utilisateurs finaux.
Voir VALIDATION.md pour les résultats réellement observés et leurs limites.
