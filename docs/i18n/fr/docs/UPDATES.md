[English](../../../UPDATES.md) · [fr](UPDATES.md) · [es](../../es/docs/UPDATES.md) · [it](../../it/docs/UPDATES.md) · [pt](../../pt/docs/UPDATES.md) · [de](../../de/docs/UPDATES.md)

# Mises à jour sans perte de sessions ou d'identités

## Hôte

L'installateur public configure les mises à jour automatiques par défaut. L'hôte vérifie la version sélectionnée par la page publiée après le démarrage et toutes les 15 minutes. Cela la maintient sur le canal de déploiement validé du propriétaire. Une commande source n'a pas d'autorité d'installation automatique; elle doit d'abord être installée par l'installateur public.

Une nouvelle roue est téléchargée HTTPS et vérifié contre son manifeste de libération. L'installateur est lu à partir de cette roue vérifiée. Python runtime en place avec `exec`: le démon PID, enfant shell processus et ouvert PTY descripteurs restent en vie. Le tampon replay limité et terminal Les variables d'environnement Shell, les répertoires de travail et les commandes en cours d'exécution restent dans leurs processus d'origine. Les clients se reconnectent à l'aide de leurs clés existantes. tmux.

Les transferts de fichiers reportent l'installation jusqu'à ce qu'ils finissent. L'installateur valide le nouveau runtime avant de demander le retrait et cesse d'accepter de nouvelles sessions pendant l'interrupteur. shells. Le mode automatique n'hérite jamais `jaunt_ALLOW_RESTART` ou le téléchargement de développeur remplace.

**Migration à partir d'anciens serveurs :** les versions sans randomisation d'exécution ne peuvent pas préserver leur PTYs à travers un remplacement d'exécution. L'installateur détecte cette capacité et reporte alors que shells ordinaire est actif. Pour y mettre fin, il faut encore une approbation explicite par **Mise à jour et redémarrage** ou `jaunt update --allow-restart`. Un `jaunt update` ordinaire n'accorde jamais cette autorisation.

Les mises à jour de l'application préservent shells; arrêt/redémarrage explicite du démon ou redémarrage de l'ordinateur finit toujours shells ordinaire. Ce mécanisme n'est pas une récupération après un crash de démon ou une perte de puissance.

La mise à jour détachée utilise une serrure privée pour éviter les mises à jour qui se chevauchent et conserve l'ancien temps d'exécution jusqu'à ce que le remplacement vérifié soit prêt. `installation.json`, `update-status.json`, `update.log` et les roues étagées ne libèrent jamais les actifs. Les contrôles échoués ne révoquent pas les dispositifs.

## Android

Les APK contrôle public Android sort automatiquement, avec une vérification manuelle dans Paramètres. Il vérifie les octets téléchargés, l'identité du paquet, une version strictement plus récente et le même certificat de signature avant d'ouvrir AndroidLes données de l'application et l'appariement sont conservés lors d'une mise à jour. Android exige une confirmation de l'utilisateur pour APK installation et peut demander une fois la permission d'installer des mises à jour de jaunt. Il s'agit d'une limite OS, pas d'un service Cloud manquant ou d'un compte utilisateur final.

Voir [Android details and validation](ANDROID.md). Les vérifications de mise à jour, les vérifications de signature et les tests fonctionnels ne constituent pas un audit de sécurité indépendant.

## Application bureautique

L'interface graphique de bureau possède sa propre version de version et mise à jour, séparée de l'host/CLI. Elle vérifie le canal publié peu après le démarrage et toutes les 15 minutes, sélectionne le paquet Linux/macOS pour le processeur actuel, et vérifie SHA-256 après le téléchargement et à nouveau avant l'installation.

Une ligne d'activité visible suit la vérification, le téléchargement, la vérification, l'état de préparation et les erreurs. **Installer et rouvrir** applique un paquet vérifié et rouvre le même profil d'application. Avec les mises à jour automatiques activées, fermer l'application applique également une mise à jour prête. shells. Un système `.deb`/`.rpm` l'installation ou la protection macOS l'emplacement de la demande peut exiger l'autorisation du système d'exploitation. macOS les constructions restent non signées et non notariées.

Un résultat d'installation est conservé dans le profil de bureau privé. L'échec est affiché lors du prochain lancement; il n'est pas immédiatement caché par la vérification de démarrage. Les constructions de bureau plus anciennes ont besoin d'une installation d'une version qui inclut cette mise à jour, en utilisant le paquet public ou `jaunt gui --install-only`.

## Progrès visibles

Transferts d'images Web et de bureau conservent leur résultat réel: le téléchargement vérifié et l'insertion de chemin cité sans Enter, ou l'achèvement du presse-papiers hôte plus Ctrl+V livraison. Ils ne prétendent pas que CLI Les vérifications d'hôte montrent l'achèvement, l'échec ou le report explicite du travail actif. Android utilise des dialogues de progression natifs pour les vérifications et APK téléchargements, suivi de la confirmation de l'installateur OS.
