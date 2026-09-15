[English](../../../INSTALLER_FEDORA.md) · [fr](INSTALLER_FEDORA.md) · [es](../../es/docs/INSTALLER_FEDORA.md) · [it](../../it/docs/INSTALLER_FEDORA.md) · [pt](../../pt/docs/INSTALLER_FEDORA.md) · [de](../../de/docs/INSTALLER_FEDORA.md)

# Corrections de l'installateur — 15 septembre 2026

Le rapport initial de l'utilisateur concerné Fedora: la commande n'a produit aucune sortie et l'exécutable est resté sur beta.2. Il n'y avait pas d'accès à distance à cette machine. Les corrections initiales du bootstrap n'ont pas établi la cause sur la machine de l'utilisateur. `curl (23) Failed writing body` pendant la période `config.json` télécharger.

## Défauts et corrections reproduits

- L'ancienne commande `curl -fsSL … | bash` retourne 0 lorsque curl échoue et Bash reçoit une entrée vide. La commande officielle utilise maintenant Bash avec `pipefail`, une progression visible, un délai de connexion de dix secondes et une limite de 120 secondes pour le téléchargement initial du script.
- Un paramètre de fichier de sortie `.curlrc` peut absorber le script de sorte que rien ne fonctionne. Ceci a été reproduit en utilisant un vrai curl et un serveur local HTTP. Le principal `-q` ignore cette configuration dans la commande officielle; les téléchargements internes utilisent `--disable`.
- Le script annonce immédiatement le démarrage et chaque téléchargement. Les erreurs inattendues identifient le code d'étape, de ligne et de sortie sans impression de secrets ou de commandes complètes.
- Les téléchargements internes de HTTPS sont limités à 120 secondes par tentative. Les erreurs de connexion/transfert sélectionnées déclenchent une réessayer IPv4 visible; les pannes de HTTP et de certificat ne sont pas contournées. Les redirections restent limitées à HTTPS.
- Un processus de boucle avec un espace de noms de système de fichiers séparé ne peut pas ouvrir le chemin temporaire de répertoire créé par Bash. Un véritable boucle de conteneur Fedora reproduit sortie 23 à `Downloading config.json`, avant toute mutation d'installation. Télécharger utiliser maintenant shell sortie redirection: Bash ouvre la destination et boucle écrit par stdout hérité. Cela fonctionne même lorsque curl ne peut pas voir le chemin de destination. Il ne contourne pas l'épuisement de stockage ou d'écriture de déni sur le système de fichiers de destination.
- Les dispositifs de protection active-shell, la vérification des roues et la préservation de l'identité restent en place.

La documentation en boucle définit [sortie 23 comme un défaut local d'écriture](https://curl.se/libcurl/c/libcurl-errors.html). Ce code seul n'identifie pas la cause exacte sur la machine de l'utilisateur; l'isolement du système de fichiers est le cas reproduit ici.

## Observations

- `pytest -q tests/test_installer_bootstrap.py`: quatre pannes par rapport aux fichiers bootstrap précédents, puis quatre passes après la première correction. Celles-ci couvrent la défaillance du réseau, la panne HTTP, l'état de sortie du pipeline, et la redirection de sortie `.curlrc`.
- `pytest -q`: 49 tests ont été approuvés localement avec Python 3.14.2 après la première correction.
- `python scripts/build_release.py`, `npm run prepare-web`, `python scripts/check_project.py`: passé.
- `python tests/installer_e2e.py`: huit contrôles passés, y compris des comptes de contrôle falsifiés, refusant de tuer un vrai shell actif, et explicitement autorisé redémarrage.
- Fedora 44, conteneur officiel frais, script public précédent via `curl … | bash`: beta.5 installation réussi. Fedora seul n'a pas reproduit le problème de l'utilisateur.
- Fedora 44, nouveau conteneur officiel, script corrigé conduit dans Bash: installé la véritable roue publique bêta.5, avec Python privé 3.12.14 installé par uv; sortie 0 et la version 01.0b5.
- Fedora 43, conteneur officiel frais: précédent installateur et roue publique beta.2, suivi de l'installateur corrigé et roue publique beta.5. Versions vérifiées avant/après ; tableau d'identité et de dispositif préservé.
- La première commande corrigée a été récupérée à partir de la page publiée et exécutée dans un nouveau conteneur Fedora 43 après [Pages deployment](https://github.com/moukrea/jaunt/actions/runs/34931947575). Les octets d'installation publics correspondent à la source examinée et la version 01.0b5 a été vérifiée.
- `python tests/installer_namespace_e2e.py`: installation de vraie roue publique avec boucle dans un conteneur Fedora 44 et Bash/Python à l'extérieur. Aucun répertoire d'hôte n'est monté dans le conteneur de Curl. Avant la correction de sortie-rédirection, le téléchargement de configuration a échoué avec la sortie 23. Après la correction, la roue installée à partir de la version publique, importée depuis l'exécution privée, et a commencé le démon avec des mises à jour automatiques activées.
- L'IC nécessaire comprend les installations réelles Fedora 43/44. L'emploi Fedora 44 exécute en outre la régression d'installation de boucle de fichier séparé.

Les tests Fedora utilisent des conteneurs isolés sans gestionnaire de service utilisateur (`jaunt_NO_SERVICE=1`) et suppriment la sortie QR (`jaunt_SKIP_PAIR=1`). Ils valident l'installation et le démarrage de l'arrière-plan, pas systemd/SELinux sur un poste de travail physique Fedora. Le service utilisateur a été préalablement validé sur Ubuntu; aucune nouvelle validation physique Fedora n'est revendiquée.

Ces corrections s'appliquent au point d'entrée et à la source d'installation de Pages. Les actifs bêta.5 publiés et APK beta.3 restent immuables. L'hôte n'a pas besoin d'un nouveau numéro de version pour utiliser l'installateur de Pages mis à jour. L'installateur intégré dans la roue bêta.5 conserve son code précédent jusqu'à une future version d'hôte.

Le protocole demeure sans vérification de sécurité indépendante.

## Suivi: sortie persistante 23 après redirection shell

L'utilisateur a par la suite signalé la même défaillance d'écriture à la ligne 65. La régression namespace avait passé, mais elle n'avait pas résolu la défaillance de l'utilisateur distant. Aucune réclamation n'est faite selon laquelle le système de fichiers distant ou la configuration de boucle a été diagnostiqué.

Un test Fedora 44 séparé avec Python 3.14.7 et un 4 KiB complet `/tmp` tmpfs ont reproduit l'erreur exacte `curl: Failed writing body` et l'échec de la ligne-65. Un répertoire et un fichier vide pourraient encore y être créés, mais l'écriture de la réponse a échoué. Ce test utilise seulement un conteneur Docker jetable; il ne remplit aucun serveur ou système de fichiers personnels.

L'installateur s'installe maintenant à côté de l'exécution sur le système de fichiers de destination, vérifie qu'il peut y écrire 1 MiB, et fournit ce répertoire temporaire privé à pip/uv pendant l'installation. Il ne modifie pas le TMPDIR des sessions de l'hôte ou du démon shell. Le répertoire de mise en scène est supprimé à la sortie. Un système de fichiers de destination complet produit toujours une erreur de stockage claire; l'installateur ne supprime pas les fichiers utilisateur pour faire place.

Quand la boucle revient 23 et Python est disponible, une bibliothèque standard HTTPS le téléchargeur récupère le fichier indépendamment. Il utilise la validation de certificat normale, rejette non-HTTPS redirige, limite la totalité du transfert à 120 secondes et 128 secondes MiB, détecte les corps incomplets, et chasse/fsyncs le résultat. La vérification de la somme de contrôle des roues se produit toujours avant le remplacement de l'exécution.HTTP défaillances en affaiblissant la validation.

Commandes de validation pour ce suivi :

- `pytest -q`: 53 tests passés localement. Quatre nouveaux contrôles exercent les limites Python et redirection de HTTPS.
- `python tests/installer_storage_e2e.py`: vraies installations Fedora avec un `/tmp` complet, et avec chaque téléchargement de boucle interne forcé d'écrire à `/dev/full`. Le deuxième scénario exerce réelle sortie de boucle 23 suivie de vrais téléchargements publics HTTPS via Python. Les deux scénarios vérifient le démon en cours, la mise en place du nettoyage, et l'absence d'un chemin de mise en scène supprimé dans l'environnement de démon.
- `python tests/installer_e2e.py`: les huit contrôles existants ont été effectués, y compris la conservation active-shell, le rejet de checksum et l'autorisation explicite de redémarrage.
- `python scripts/build_release.py`, `npm run prepare-web` et `python scripts/check_project.py`: passé.

Le travail requis Fedora CI exécute les deux nouveaux scénarios d'installation en plus du test d'espace de noms antérieur. Ce sont des observations test-environnement, pas une revendication d'exécution réussie sur la machine inaccessible Fedora de l'utilisateur.
