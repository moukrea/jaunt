# Modèle de sécurité — bêta non auditée

Jaunt donne un shell complet sous le compte de l'hôte. Il n'y a pas de sandbox filesystem ni de rôles lecture seule : un appareil autorisé peut agir comme cet utilisateur. Ne pas lancer l'hôte avec des privilèges dont les appareils distants n'ont pas besoin.

## Ce qui est protégé

Les commandes, sorties, fichiers et presse-papiers sont chiffrés entre navigateur et hôte. Le relais voit les adresses réseau, les salles, la présence, les tailles et horaires des paquets, ainsi que les clés publiques éphémères. Il ne possède pas les secrets d'appairage ou des appareils. Le canal est authentifié par un secret aléatoire de 256 bits, avec ECDH éphémère et AES-GCM. Voir PROTOCOL.md.

Les primitives viennent de cryptography et Web Crypto. **L'assemblage du protocole est nouveau et n'a pas reçu d'audit externe.** Des tests de tamper/replay et d'interopérabilité ne remplacent pas un audit. Ne pas l'annoncer comme certifié, invulnérable ou adapté d'emblée à des environnements de production sensibles.

## Ce qui n'est pas protégé

- Un navigateur, une machine ou un compte système compromis reste compromis.
- GitHub Pages sert du code exécuté avec accès aux secrets après déverrouillage : un attaquant contrôlant le dépôt/Page peut remplacer le JavaScript. E2E ne protège pas contre une mise à jour malveillante du client lui-même.
- Sans mot de passe, les clés sont conservées en clair dans IndexedDB, comme une session mémorisée. Avec mot de passe/PIN, elles sont chiffrées au repos ; un PIN court reste attaquable hors ligne. Préférer une longue phrase secrète.
- Le verrouillage arrête les connexions et efface les vues actives. Il ne garantit pas une purge cryptographique de la RAM du navigateur.
- Le QR complet est une capacité d'accès au shell pendant dix minutes ; ne jamais le mettre dans une issue, capture publique, log de CI ou analytics.
- Les notifications sont délivrées par le service push du navigateur. Jaunt masque par défaut le contenu de la commande, mais le nom de machine et la temporalité restent sensibles.
- Un appareil révoqué ne peut plus s'authentifier au canal, mais connaît l'ancienne capacité de routage partagée. Il peut encore perturber la disponibilité du relais jusqu'à rotation de l'identité de l'hôte. Les secrets de routage ne sont pas un système complet de quota/anti-DDoS.

## Origine GitHub Pages partagée

Les sites `moukrea.github.io/autre-projet/` et `moukrea.github.io/jaunt/` partagent la même origine navigateur. Un autre projet vulnérable sur cette origine peut donc viser le stockage de Jaunt. Les chemins ne sont pas une frontière de sécurité. Pour un service sensible, servir Jaunt sur une origine dédiée (domaine/sous-domaine propre) et y refaire l'appairage. Le PIN protège les clés au repos, mais ne remplace pas cette isolation ni la confiance dans le JavaScript servi.

## Stockage et permissions

`~/.local/share/jaunt/host.json` et le socket de contrôle sont privés au compte courant. Dossier 0700, état 0600, écriture atomique. `attachments/` contient les fichiers réellement envoyés : ils ne disparaissent pas quand l'utilisateur verrouille l'app. Supprimer les pièces jointes devenues inutiles depuis le navigateur de fichiers.

Les clés persistantes ne sont jamais inscrites dans une URL de requête : le pairing utilise le fragment, aussitôt retiré de l'historique. Les capacités du relais sont transmises dans la première trame WebSocket sous TLS. Aucun payload n'est logué par le Worker.

## Déploiement

Utiliser HTTPS/WSS hors loopback, restreindre APP_ORIGIN au domaine Pages exact, activer MFA et protections de branche, réduire les droits Cloudflare/GitHub, surveiller quotas et coûts. Ne pas utiliser de scripts analytics/extensions tierces dans la page. La CSP statique interdit les scripts inline et évaluation dynamique ; les dépendances sont locales. GitHub Pages ne permet pas de définir tous les headers de sécurité serveur : utiliser un domaine/proxy maîtrisé pour un durcissement supplémentaire.

## Signaler un problème

Créer un signalement de sécurité privé du dépôt quand disponible. Ne pas publier de clé, QR, log de terminal confidentiel, fichier host.json ou export de coffre. Avant ouverture publique, le mainteneur doit définir un canal privé et une politique de rotation.
