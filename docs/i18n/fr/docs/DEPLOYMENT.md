[English](../../../DEPLOYMENT.md) · [fr](DEPLOYMENT.md) · [es](../../es/docs/DEPLOYMENT.md) · [it](../../it/docs/DEPLOYMENT.md) · [pt](../../pt/docs/DEPLOYMENT.md) · [de](../../de/docs/DEPLOYMENT.md)

# Déploiement de la maintenance

Les utilisateurs finaux installent seulement l'hôte. Le propriétaire du projet ** déploie ces deux composants une fois :

1. Pages GitHub : HTML, JavaScript, CSS, logo, installateur et configuration publique.
2. Cloudflare Worker with a SQLite Durable Object: WebSocket relais. Ne le remplacez pas par un travail en boucle GitHub Actions, un tunnel personnel ou des serveurs publics d'un autre projet.

## Préparation

Préservez le dépôt existant sur une branche de sauvegarde, puis intégrez les fichiers sur une branche de travail. N'écrasez pas l'historique ou la force-poush. Installez Python et Node 22+, puis lancez `pip install -e . -r requirements-dev.txt`, `npm ci` et `npm run prepare-web`. La compilation copie jsQR 1.4.0 et sa licence localement et génère un cache PWA versionné. Commettez les licences `package-lock.json` réellement résolues et examinez ; n'inventez jamais un fichier de verrouillage.

Les outils de déploiement sont épinglés et le fichier de verrouillage résolu est engagé. Le raccourci/unici remplace les annonces connues dans la dépendance de test Miniflare 4 ; voir [VALIDATION.md](VALIDATION.md).

## Relais

- Créez ou sélectionnez un compte Cloudflare autorisé pour Workers and SQLite Durable Objects. Vérifiez les termes et quotas actuels du compte.
- Autoriser l'agent à déployer, ou définir les secrets Actions `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` via l'interface sécurisée de GitHub. Le jeton doit permettre le déploiement Worker et la migration d'objets durables dans ce compte.
- `relay.yml` exécute Wrangler avec `relay/wrangler.jsonc`: nom initial `jaunt-relay`, liaison `ROOMS`, classe `Room`, migration SQLite `v1`.
- APP_ORIGIN doit être `https://moukrea.github.io` (l'origine, sans `/jaunt/`). Ne pas utiliser `*` dans la production. `config.json` doit contenir l'URL réelle du Worker WSS, sans un chemin `/v1/room/...` annexé; le client construit ce chemin.
- Vérifier `/health`, puis **appariement réel et commande cryptée**. Une réponse santé HTTP 200 ne valide pas WebSockets.

## L'hôte, le bureau et la version Android, puis Pages

1. Passer CI. Créez la balise hôte, actuellement `v0.1.0-beta.10` (Python version `0.1.0b10`). Le flux de travail de sortie construit la roue et la publie avec `host-manifest.json` et `SHA256SUMS`. Les versions bêta sont explicitement marquées comme des pré-éditions. Ne jamais écraser les actifs d'une version existante.
2. Pour Android, publiez la balise, actuellement `android-v0.1.0-beta.7`, avec sa signature APK, `SIGNING-CERTIFICATE.txt` et `SHA256SUMS`; vérifiez les biens publics. Gardez la même clé de signature pour les mises à jour.
3. Publier `desktop-v0.1.0-beta.9`: Linux x64/ARM64 archives, paquets de deb/rpm, macOS x64/ARM64 paquets zip/dmg, et `SHA256SUMS`. Vérifier les archives publiques avant de les annoncer. Le paquet Linux doit conserver le support Chrome sandbox; les constructions macOS sont non signées.
4. Définir les variables du dépôt `jaunt_RELAY_URL` (URL réelle WSS), `jaunt_RELEASE_TAG` (`v0.1.0-beta.10`), `jaunt_ANDROID_RELEASE_TAG` (`android-v0.1.0-beta.7`), `jaunt_DESKTOP_RELEASE_TAG` (`desktop-v0.1.0-beta.9`) et éventuellement `jaunt_PAGE_URL` (par défaut à l'URL de la page du dépôt). Ne jamais mettre des jetons d'hôte ou jumeler des secrets dans des variables publiques.
5. Activer les Pages en mode Actions GitHub. `pages.yml` construit l'application web, valide la configuration, copie l'installateur et la publie.
6. N'exécutez pas Pages avec une version inexistante. L'invite de déploiement nécessite cette commande.

## Essais d'acceptation à distance requis

Sur une machine Linux sans port entrant exposé : installer à partir de la page publiée, scanner le code QR dans Chrome Android, créer un shell, exécuter une commande, télécharger et télécharger un fichier, coller une image, tester les deux modes d'image selon les capacités de l'hôte, fermer/réouvrir le PWA, commuter Wi-Fi/réseau mobile, retourner au même shell sans code QR, tester la poussée avec l'écran verrouillé, et révoquer l'appareil. Répéter le chemin minimal sur macOS et Firefox/Safari lorsque disponible.

Ne jamais marquer un test non exécuté comme validé. Le rapport local inclus ne prouve pas en soi la production de la connectivité Cloudflare ou le comportement du téléphone physique.

## Publication et fonctionnement

Conservez les journaux techniques sans charges utiles, surveillez les erreurs et les quotas, planifiez la rotation de l'identité et les sauvegardes privées de l'état hôte, et ne transformez pas le relais en stockage de fichiers.

Sources primaires : [Objet durable WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Commandes Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/), [GitHub Les flux de travail des pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [installation d'essai](https://docs.astral.sh/uv/getting-started/installation/).

## Déploiement antérieur, 14-15 septembre 2026

Voir [le rapport de livraison en cours](SESSION_CONTROLS_VALIDATION.md) pour les versions ultérieures et les résultats d'acceptation observés.

Pages : https://moukrea.github.io/jaunt/ ; relais : `wss://jaunt-relay.moukrea.workers.dev` ; version hôte : `v0.1.0-beta.9` ; APK : `android-v0.1.0-beta.5`.

Le Worker a été déployé en utilisant Wrangler OAuth autorisé par le propriétaire, stocké localement avec cryptage et une clé dans le système de clé. `CLOUDFLARE_ACCOUNT_ID` est configuré dans GitHub; un futur déploiement de relais via Actions aura besoin de son propre `CLOUDFLARE_API_TOKEN`. Aucun jeton OAuth temporaire n'a été copié dans un secret permanent de l'API. Les utilisateurs finaux n'ont pas besoin de prendre d'action Cloudflare ou GitHub. Voir [VALIDATION.md](VALIDATION.md) pour les résultats observés et leurs limitations.
