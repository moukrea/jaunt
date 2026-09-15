[English](../../../DEPLOY_AGENT_PROMPT.md) · [fr](DEPLOY_AGENT_PROMPT.md) · [es](../es/DEPLOY_AGENT_PROMPT.md) · [it](../it/DEPLOY_AGENT_PROMPT.md) · [pt](../pt/DEPLOY_AGENT_PROMPT.md) · [de](../de/DEPLOY_AGENT_PROMPT.md)

# Demande de livraison — jaunt

Vous avez autorisé l'accès GitHub à `moukrea/jaunt`. Intégrez et déployez le projet dans cette archive. Ne lisez pas l'ancienne implémentation pour l'inspiration: ce projet est une réécriture. Préservez l'état précédent sur une branche de sauvegarde, puis travaillez à travers une branche et une PR. Ne forcez pas ou supprimez pas l'historique.

L'exigence non négociable est un véritable accès à shells arbitraire via une interface utilisateur mobile/desktop, pas seulement des agents Claude/Codex. Installation d'un hôte de commande unique, pas de configuration VPN/Tailscale ou serveur pour les utilisateurs finaux. Paire une fois par QR code, clés persistantes, changements de réseau sans recoupement, fichiers, images, presse-papiers, plusieurs sessions, et notifications.

## Exécution

1. Lire README.md, Security.md, docs/VALIDATION.md et docs/DEPLOYMENT.md; inspecter le code livré. Ne pas réécrire les composants de travail simplement pour les simplifier. Ne pas cacher les limitations documentées.
2. Installez les dépendances de build/test et créez et validez un vrai paquet-lock.json. Vérifiez les versions actuelles et les avis de sécurité. `npm run prepare-web` doit produire une copie locale de jsQR et sa licence. Pas d'exécution JavaScript à partir d'un CDN. Vérifiez chaque importation et ressource sous le chemin `/jaunt/` publié.
3. Exécutez pytest, les tests Node relais, les tests Miniflare réels, check_project, build_release et les tests E2E du navigateur. Lisez les échecs et corrigez leurs causes; ne supprimez jamais les assertions ou les fonctionnalités.
4. Déployez le Worker en utilisant le compte Cloudflare autorisé. Les secrets requis sont CLOUDFLARE_API_TOKEN et CLOUDFLARE_ACCOUNT_ID. Si l'autorisation Cloudflare n'est pas disponible, demandez SEULEMENT que l'autorisation manquante par le biais du mécanisme de sécurité approprié et expliquez qu'un jeton GitHub ne l'accorde pas. Ne jamais inventer une URL ou emprunter le relais public d'un autre projet.
5. Configurez APP_ORIGIN, vérifiez la santé ET le vrai WebSockets, puis définissez jaunt_RELAY_URL dans GitHub. Publiez la balise hôte/release et ses trois actifs avant Pages. Définissez jaunt_RELEASE_TAG et activez Pages via Actions. Déclenchez le flux de travail Pages et vérifiez son URL réelle.
6. Effectuez une installation réelle à partir de la version publique sur une machine propre, source non modifiable. Vérifier le somme de contrôle, le service utilisateur, le démarrage et le code QR. Vérifier les mises à jour de préservation d'identité et le refus de tuer en silence shells ordinaire actif.
7. Exécutez le flux d'acceptation de bout en bout : page publique → appariage → shell → commande avec sortie éprouvée → nouvel onglet → retour à la première shell → téléchargement image/texte → téléchargement avec comparaison d'octets → interruption relais/réseau → même session sans nouvelle QR → révocation. Sur un téléphone physique autorisé, la caméra de test QR numérisation, clavier, galerie, rotation, Wi-Fi/mobile commutation, PWA, et pousser avec l'écran verrouillé. Ne jamais prétendre avoir utilisé un téléphone si aucun n'est disponible.
8. Préservez la distinction entre le chemin upload-plus-sans Enter et la pâte native conditionnelle. Ne revendiquez pas une pièce jointe Claude/Codex lorsqu'un seul chemin a été inséré. Faites expliciter les chutes sans tête. Ne promettez jamais un presse-papiers OS qui n'existe pas.
9. Ne publiez jamais host.json, .dev-state, secrets, codes QR, exportations de coffre-fort, ou des journaux terminal privés. Inspectez le contenu et les workflows de ZIP/release avant publication. N'exécutez pas des analyses destructives sur les répertoires personnels de l'utilisateur pour les tests.
10. Livrez l'URL publiée, la commande d'installation validée, le tag/release, le rapport de test et les limitations non validées restantes. Ne remettez pas 40 tâches manuelles. Le déploiement du propriétaire se produit une fois; les utilisateurs finaux ne doivent pas avoir besoin de comptes Cloudflare/GitHub pour se connecter.

## Bloceurs de publication

Un relais non configuré, faussement revendiqué la pâte d'image, créé non fonctionnel shell, passant artificiellement des tests, manquant l'importation de JS, inventé la publication de la version/URL, ou des secrets de dépôt. La sécurité du protocole n'a pas été vérifiée: conserver cette divulgation même lorsque tous les tests passent.
