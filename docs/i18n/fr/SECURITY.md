[English](../../../SECURITY.md) · [fr](SECURITY.md) · [es](../es/SECURITY.md) · [it](../it/SECURITY.md) · [pt](../pt/SECURITY.md) · [de](../de/SECURITY.md)

# Modèle de sécurité — bêta non vérifié

jaunt fournit un shell complet sous le compte hôte. Il n'y a pas de sandbox de système de fichiers ou de rôle en lecture seule: un périphérique autorisé peut agir en tant qu'utilisateur. Ne pas exécuter l'hôte avec des privilèges que les périphériques distants n'ont pas besoin.

## Ce qui est protégé

Les commandes, la sortie, les fichiers et les données du presse-papiers sont cryptés entre le navigateur et l'hôte. Le relais voit les adresses réseau, les salles, la présence, les tailles de paquets et le timing, ainsi que les clés publiques éphémères. Il ne tient pas d'appariement ou de secret d'appareil. Le canal est authentifié par un secret aléatoire de 256 bits, avec ECDH éphémère et AES-GCM. Voir [la spécification du protocole](docs/PROTOCOL.md).

Les primitives proviennent de la cryptographie et du Web Crypto. **Leur composition dans ce protocole est nouvelle et n'a pas reçu d'audit externe.** Les tests Tamper/replay et d'interopérabilité ne remplacent pas un audit. Ne pas décrire jaunt comme certifié, invulnérable ou prêt par défaut pour les environnements de production sensibles.

## Ce qui n'est pas protégé

- Un navigateur, une machine ou un compte système compromis reste compromis.
- GitHub Pages sert de code qui peut accéder aux secrets après le déverrouillage: un attaquant contrôlant le dépôt ou la page peut remplacer le JavaScript. Le chiffrement de bout en bout ne protège pas contre une mise à jour malveillante du client.
- Sans mot de passe, les clés sont stockées non chiffrées dans IndexedDB, comme une session rappelée. Un mot de passe/PIN les chiffre au repos; un PIN court reste vulnérable à la conjecture hors ligne. Préférez une longue phrase de passe.
- Verrouillage stoppe les connexions et efface les vues actives. Il ne garantit pas l'effacement cryptographique de la RAM du navigateur.
- Un code QR complet accorde l'accès shell pendant dix minutes. Ne jamais le mettre dans un problème, une capture d'écran publique, un journal CI ou des analyses.
- Les notifications de navigateur sont transmises par le service push du navigateur. Les titres de notification fournis par le programme et les corps sont affichés et envoyés par le biais de ce service; n'incluent pas de secrets dans les notifications. Android suit les paramètres de confidentialité de l'écran de verrouillage du système.
- Un appareil révoqué ne peut plus authentifier le canal, mais connaît la capacité de routage partagée précédente. Il peut encore perturber la disponibilité du relais jusqu'à ce que l'identité de l'hôte soit tournée.

## Origine des pages partagées GitHub

Sites `moukrea.github.io/another-project/` et `moukrea.github.io/jaunt/` partager une origine du navigateur. Un autre projet vulnérable sur cette origine pourrait cibler jauntLes chemins ne sont pas une limite de sécurité. Pour une utilisation sensible, servir jaunt sur une origine dédiée (son propre domaine/sous-domaine) et pair à nouveau là. Un NIP protège les clés au repos mais ne remplace pas l'isolement d'origine ou la confiance dans le JavaScript être servi.

## Stockage et autorisations

`~/.local/share/jaunt/host.json` et la prise de commande sont privées du compte courant. Le répertoire utilise le mode 0700, l'état utilise 0600, et les écritures sont atomiques. `attachments/` contient des fichiers téléchargés; verrouiller l'application ne les supprime pas. Supprimer les pièces jointes inutiles via le navigateur de fichiers.

Les touches persistantes n'apparaissent jamais dans les URLs de requête : l'appariement utilise le fragment, qui est immédiatement retiré de l'historique. Les capacités de relais sont envoyées dans le premier cadre WebSocket sur TLS.

## Déploiement

Utilisez HTTPS/WSS en loopback externe, limitez APP_ORIGIN à l'origine exacte des Pages, activez les protections MFA et branches, minimisez les permissions Cloudflare/GitHub et surveillez les quotas et les coûts. N'ajoutez pas de scripts ou d'extensions d'analyses tiers à la page. Les scripts statiques CSP en ligne et l'évaluation dynamique ; les dépendances sont locales. GitHub Pages ne peuvent pas définir chaque en-tête de sécurité du serveur ; utilisez un domaine/proxy contrôlé pour le durcissement.

## Signaler une vulnérabilité

N'éditez jamais de clé, de code QR, de journal confidentiel terminal, de fichier host.json ou d'exportation de coffre-fort. Avant la divulgation publique, le responsable doit établir un canal de reporting privé et une politique de rotation.

## Limite du bureau

Le rendeur de bureau est sandboxé, avec Node l'intégration désactivée et l'isolement du contexte activé. Il reçoit une interface étroite précharge IPC, validée par rapport au cadre principal de l'application. `jaunt://app/` scheme; navigation externe ouvre le navigateur système et ne reçoit jamais le pont hôte. Le relais admet également l'origine exacte du rendu natif `jaunt://app` pour les connexions de bureau à distance; les origines arbitraires du navigateur restent rejetées. Les vérifications d'origine ne sont pas des authentifications: les clients natifs ont encore besoin de capacités de routage et la poignée de main cryptée host-authentifiée. CLI. Ce n'est pas un second auditeur réseau et ne contourne pas l'authentification à distance.

Les commandes détectent les artefacts corrompus/comparés; elles ne protègent pas contre un éditeur de dépôt/release compromis. Les paquets de bureau ne contiennent que les fichiers d'applications listés et les dépendances d'exécution, pas l'état d'hôte ou les profils d'utilisateur.
