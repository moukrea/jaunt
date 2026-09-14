# Prompt de livraison — Jaunt

Tu disposes d'un accès autorisé à GitHub pour `moukrea/jaunt`. Intègre et déploie le projet présent dans cette archive. Ne lis pas l'ancien code pour t'en inspirer : ce projet est une réécriture. Préserve l'ancien état sur une branche de sauvegarde puis travaille sur une branche et une PR ; pas de force-push ni suppression de l'historique.

Le besoin NON négociable est un vrai accès à des shells arbitraires depuis une UI mobile/PC, et pas seulement aux agents Claude/Codex. Hôte installé en une commande, pas de VPN/Tailscale ni serveur à configurer par l'utilisateur final. QR une fois, clés persistantes, réseau changeant sans réappairage, fichiers, images, presse-papiers, plusieurs sessions, notifications.

## Exécution

1. Lire README.md, SECURITY.md, docs/VALIDATION.md, docs/DEPLOYMENT.md et inspecter le code livré. Ne pas réécrire des composants fonctionnels « pour simplifier ». Ne pas masquer les limitations documentées.
2. Installer les dépendances de build/test, générer puis committer le vrai package-lock.json. Vérifier les versions/avis de sécurité actuels. `npm run prepare-web` doit produire jsQR local et sa licence. Aucun JavaScript runtime chargé depuis un CDN. Vérifier tous les imports et ressources du site publié sous `/jaunt/`.
3. Exécuter pytest, tests Node du relais, tests Miniflare réels, check_project, build_release, tests navigateur E2E. Lire les échecs et corriger leur cause, jamais simplement supprimer assertions ou fonctionnalités. Produire un rapport avec commandes, versions et résultats réellement observés.
4. Déployer le Worker avec le compte Cloudflare autorisé. Les secrets nécessaires sont CLOUDFLARE_API_TOKEN et CLOUDFLARE_ACCOUNT_ID. Si aucune autorisation Cloudflare n'est disponible, demander UNIQUEMENT cette autorisation manquante via le mécanisme sécurisé adapté et expliquer qu'un token GitHub ne crée pas cette permission. Ne pas inventer d'URL et ne pas emprunter les relais publics d'un autre projet.
5. Configurer APP_ORIGIN, vérifier santé ET WebSockets réels, puis définir JAUNT_RELAY_URL dans GitHub. Publier le tag/release hôte et ses trois assets avant Pages. Définir JAUNT_RELEASE_TAG et activer Pages via Actions. Déclencher le workflow Pages et vérifier son URL réelle.
6. Faire une installation réelle depuis la release publique sur une machine propre (pas le source editable) ; vérifier checksum, service utilisateur, démarrage et QR. Vérifier l'upgrade sans perte d'identité et le refus de tuer silencieusement les shells ordinaires actifs. Une autorisation explicite de redémarrage doit rester requise pour les détruire.
7. Recette de bout en bout : Page publique → pairing → shell → commande avec résultat prouvé → nouvel onglet → retour au premier shell → upload image/texte → téléchargement avec comparaison des octets → interruption du relais/réseau → même session sans nouveau QR → révocation. Sur téléphone physique autorisé : QR caméra, clavier, galerie, rotation, changement Wi-Fi/mobile, PWA et push écran verrouillé. Ne pas prétendre avoir utilisé un téléphone si tu n'en as pas.
8. Pour les images, conserver la différence entre upload+chemin sans Enter et collage natif conditionnel. Ne pas afficher « attachment Claude/Codex » si seul un chemin a été inséré. Sur headless, rendre le fallback explicite. Ne jamais promettre l'accès à un presse-papiers OS qui n'existe pas.
9. Ne jamais publier host.json, .dev-state, secrets, QR, exports de coffre, logs de terminal privés. Vérifier les contenus du ZIP/release et des workflows avant publication. Ne pas exécuter des scans destructifs sur les dossiers personnels de l'utilisateur pour les tests.
10. Livrer à l'utilisateur : URL publiée, commande d'installation validée, tag/release, rapport de tests, limites non validées restantes. Pas une liste de 40 tâches à réaliser manuellement. Le déploiement propriétaire se fait une fois ; l'utilisateur final ne doit créer aucun compte Cloudflare/GitHub pour se connecter.

## Critères de refus de publication

Un relais non configuré, une image faussement annoncée collée, un shell créé qui ne s'exécute pas, des tests artificiellement verts, un import JS manquant, une release/URL inventée, ou des secrets présents dans le dépôt sont bloquants. La sécurité du protocole est non auditée : conserver cette mention même lorsque tous les tests passent.
