[English](../../../README.md) · [fr](README.md) · [es](../es/README.md) · [it](../it/README.md) · [pt](../pt/README.md) · [de](../de/README.md)

# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

**Vos machines, vos shells, vos fichiers. Sur tous vos écrans.**

jaunt relie les appareils que vous transportez aux machines sur lesquelles vous travaillez. Installez un petit hôte sur chaque machine Linux ou macOS, appairez une seule fois votre téléphone, votre portable ou votre poste de travail, et chacun d'eux affiche le même espace de travail : de vrais shells dans de vrais PTY, les fichiers qui les accompagnent et les sessions que vous avez laissées tourner. Ouvrez, renommez, scindez, réordonnez, fermez ou terminez des shells sur n'importe quel hôte depuis n'importe quel appareil ; avec les *sessions ouvertes partagées* activées, les mêmes onglets, volets et shell actif vous suivent d'un écran à l'autre. Claude Code et Codex s'y exécutent comme n'importe quel autre programme et, lorsque les deux sont installés sur un hôte, un simple interrupteur permet à leurs sessions sur un même projet de se connaître et d'échanger des messages. Côté clients : un navigateur (installable aussi en PWA), une application Android native et une application de bureau native ; les trois embarquent la même interface. Les connexions partent de l'hôte vers un relais, chiffrées de bout en bout, sans port ouvert, sans VPN et sans compte.

**Hôte : 0.1.0-beta.29 · Bureau : 0.1.0-beta.23 · Android : 0.1.0-beta.21.** [Ouvrir jaunt](https://moukrea.github.io/jaunt/). La publication et la validation des versions sont suivies dans le rapport de validation. Le protocole **n'a pas fait l'objet d'un audit de sécurité indépendant**. Consultez le [dernier rapport de validation](docs/SEAMLESS_WORKSPACE_VALIDATION.md) pour les résultats de tests observés et les limitations non validées.

## Installer l'hôte

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Compatible Linux, macOS et WSL. Nécessite `curl`. L'installateur utilise un environnement Python 3.11–3.14 compatible ou installe un environnement Python privé via uv. L'hôte s'installe sans privilèges d'administrateur. Sur Ubuntu, lorsque les espaces de noms utilisateur sont restreints, l'application de bureau optionnelle passe par l'installateur de paquets du système et peut demander un mot de passe administrateur pour configurer son bac à sable. L'installateur vérifie le SHA-256 de la version, crée un environnement privé et démarre un service utilisateur lorsque c'est possible. Les mises à jour automatiques sont activées. Les hôtes compatibles conservent leurs processus shell pendant le remplacement de l'environnement d'exécution et attendent la fin des transferts en cours.

Sur Android, [installez l'APK signé](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.21/jaunt-android-v0.1.0-beta.21.apk), puis scannez le code QR affiché par l'hôte. Sur un ordinateur ou dans un navigateur, ouvrez **https://moukrea.github.io/jaunt/**. Vous pouvez aussi coller la chaîne d'appairage `jaunt1.…`. Le code QR expire au bout de dix minutes et ne peut servir qu'une seule fois. Chaque appareil mémorisé utilise ensuite sa propre clé : changer de réseau Wi-Fi ou mobile ne nécessite pas de nouvel appairage. Gardez l'onglet ouvert pour bénéficier de la reconnexion automatique ; rouvrez l'application si le système mobile la suspend ou la ferme.

```sh
jaunt gui                        # Open/install the native desktop workspace
jaunt pair                       # Pair another device
jaunt service install            # Install and enable the user service
jaunt status                     # Host and shell status
jaunt update                     # Check for an update without closing shells
jaunt doctor                     # Diagnostics without exposing secrets
jaunt devices                    # List authorized devices
jaunt revoke -- DEVICE_ID           # Revoke a lost device
jaunt notify "Build finished"     # Notify connected devices
jaunt run -- make test            # Notify when a command finishes
jaunt clipboard < notes.txt      # Make text available to the client
jaunt stop                       # Stop the host AND its non-tmux shells
```

L'appairage donne accès au **compte système qui exécute l'hôte**, avec l'ensemble des permissions de ce compte. N'exécutez pas l'hôte en tant que root pour un usage courant. Un code QR donne un accès shell : ne le publiez jamais.

## Fonctionnalités

| Domaine | Comportement |
|---|---|
| Hôtes | Appairez autant de machines Linux/macOS que vous le souhaitez ; chacune conserve ses sessions, ses fichiers, ses réglages et son nom convivial ; passez de l'une à l'autre depuis une seule barre latérale ; hôte par défaut et ordre d'affichage |
| Terminaux | Vrais PTY avec votre propre shell, clavier interactif, onglets, créer/renommer/ouvrir/détacher/terminer, glisser pour réordonner, volets scindés (côte à côte ou empilés), dimensionnement partagé, touches Ctrl/Alt/Échap/Tab/flèches sur mobile, zone de composition pour les saisies longues |
| Sessions ouvertes partagées | Par hôte : chaque client et l'hôte lui-même affichent les mêmes onglets, volets, ordre et shell actif ; mode optionnel « seules les sessions affichées existent » |
| Reconnexion | Historique borné, reconnexion automatique, état mémorisé ; une déconnexion du navigateur ne ferme pas le shell ; les shells survivent aux mises à jour en place de l'hôte |
| Sessions tmux existantes | Les sessions tmux héritées restent prises en charge ; les nouvelles sessions créées dans l'interface sont des shells partagés ordinaires |
| Fichiers | Navigation, fichiers cachés, pagination, création de répertoires, renommage, suppression non récursive, envoi/téléchargement, aperçus texte et image |
| Transferts | Progression visible et résultats de réussite/erreur conservés ; suivi détaillé dans Fichiers → Activité de transfert ; blocs de 48 KiB, reprise sur coupure réseau, SHA-256 des envois, finalisation atomique, annulation |
| Images | Galerie, sélecteur de fichiers, collage et glisser-déposer ; conversion en PNG des formats décodables par le navigateur ; insertion du chemin ou collage natif conditionnel |
| Presse-papiers | Sélection, copie de l'historique conservé, lecture/écriture du presse-papiers de l'hôte lorsque disponible, tampon texte en mode headless, OSC 52 en copie seule |
| Claude Code ↔ Codex | Un interrupteur par hôte : les sessions sur un même projet se découvrent via leurs hooks et peuvent s'envoyer des messages dans leur conversation ouverte ; désactivé, il retire tout ce que jaunt avait ajouté |
| Protection | Codes QR à usage unique, clés par appareil, révocation, coffre de navigateur protégé par PIN/mot de passe en option et verrouillage automatique |
| Notifications | Service Android natif optionnel ou Web Push du navigateur ; cloches du terminal, événements de programme, fin de session, test depuis les Paramètres et CLI `notify`/`run` |
| Interface | Applications natives de bureau et Android partageant la même interface embarquée ; client navigateur et PWA ; six langues ; thèmes sombre, clair, système et circadien |
| Mises à jour | L'hôte se remplace en place sans terminer les shells ; l'application de bureau et l'APK vérifient, contrôlent et installent leurs propres mises à jour |

## Client de bureau seul

Pour vous connecter à d'autres hôtes sans installer de service hôte local ni la CLI jaunt :

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash -s -- --client-only'
```

Cette commande installe la même application de bureau et le même lanceur, avec l'appairage distant, les sessions, les fichiers, les notifications et les mises à jour automatiques de l'application. Elle ne démarre aucun démon et n'affiche pas les commandes de l'hôte local. Elle ne désinstalle pas un hôte déjà en place. Exécutez la commande d'installation normale de l'hôte pour activer plus tard l'intégration de l'hôte local.

L'application de navigateur installée s'appelle **jaunt (PWA)** afin de la distinguer de l'application native **jaunt**. Les deux utilisent le logo transparent d'origine. Android natif reprend le même visuel sans fond sombre intégré ; certains lanceurs peuvent appliquer leur propre habillage d'icône.

## Espace de travail de bureau partagé

Ouvrez **jaunt** depuis le menu des applications de l'hôte ou lancez `jaunt gui`. L'hôte et les clients distants partagent les mêmes shells ordinaires, sans tmux. **Nouveau shell** ouvre immédiatement un shell nommé automatiquement, qui hérite du répertoire courant du shell actif précédent. Le bouton dossier permet de parcourir les répertoires de l'hôte et, si vous le souhaitez, de nommer le nouveau shell. **Sessions** liste les sessions en cours et terminées : ouvrir, renommer, fermer uniquement votre vue, ou terminer explicitement un shell pour tout le monde. Vous pouvez aussi renommer un onglet en double-cliquant sur son titre, ou double-cliquer sur le titre d'un volet. Faites glisser les onglets pour les réordonner ; sélectionner un onglet ne change jamais sa position. L'appareil avec lequel vous interagissez contrôle la taille du terminal partagé.

Les deux **icônes de scission** disposent les volets côte à côte ou l'un au-dessus de l'autre sur le bureau, à partir d'une session nouvelle ou existante. Chaque volet peut être déplacé dans son propre onglet. Les dispositions survivent à la réouverture ; sur mobile, leurs sessions apparaissent comme des onglets classiques. La barre latérale du bureau peut se replier, et cette préférence est conservée. Les Paramètres regroupent les noms conviviaux des hôtes, leur ordre et l'hôte par défaut, les thèmes sombre/clair/système/circadien et les commandes de notification. Les réglages d'hôte suivent immédiatement la machine sélectionnée, y compris son identité et ses commandes de mise à jour. L'application de bureau native gère aussi le service hôte local et s'appaire à d'autres hôtes ; les commandes du service local n'apparaissent que pour l'hôte local, tandis que les mises à jour de l'application de bureau restent distinctes. Consultez le [guide de l'espace de travail](docs/WORKSPACE.md) et le [rapport de validation](docs/WORKSPACE_VALIDATION.md).

**Pont Claude Code ↔ Codex.** Lorsque `claude` et `codex` sont tous deux installés sur un hôte, les Paramètres affichent un interrupteur. Une fois activé, les vraies sessions Claude Code et Codex ouvertes dans des shells jaunt sur un même projet se connaissent automatiquement (sous forme de contexte de hook ordinaire) et peuvent s'envoyer des messages dans leur conversation ouverte, à votre demande ou de leur propre initiative. Désactivé par défaut ; le désactiver retire tout ce que jaunt avait ajouté aux deux environnements. Consultez le [guide du pont](../../../docs/BRIDGE.md).

## Gestion des images

La progression reste visible pendant l'envoi et la livraison vers le presse-papiers ou sous forme de chemin. Les opérations terminées se replient en un résultat compact ; **Afficher l'historique** en conserve le détail. L'annulation d'un transfert est affichée comme telle, et les erreurs restent attachées à leur opération. Le résultat final indique exactement ce qui s'est passé ; les erreurs restent visibles avec une action de nouvelle tentative. Une insertion de chemin réussie ou une livraison par Ctrl+V ne prouve pas que Claude Code ou Codex a reconnu une pièce jointe.

**Coller :** lorsqu'un backend natif est disponible, l'image est envoyée dans le presse-papiers de l'hôte puis collée dans la session sélectionnée avec Ctrl+V. Si le navigateur renvoie un presse-papiers vide, l'interface propose une zone de collage enrichie et un sélecteur d'images. Joindre conserve les deux modes explicites. Aucune touche Entrée n'est envoyée.

**Repli avec une connexion active :** sélectionnez ou collez une image, envoyez-la sur l'hôte, et son chemin correctement échappé est inséré dans le terminal. Rien ne soumet la commande automatiquement. Claude, Codex ou un autre outil peut lire le fichier si son propre mode le permet.

**Collage natif conditionnel :** lorsque l'hôte dispose d'un presse-papiers graphique accessible (macOS, Wayland avec `wl-clipboard`, ou X11 avec `xclip`), jaunt y dépose le PNG et envoie Ctrl+V au terminal. Cela dépend aussi du raccourci et du comportement de l'outil en ligne de commande. **Sur un hôte headless, jaunt ne peut pas fabriquer une pièce jointe native Claude/Codex : il se rabat sur un fichier et son chemin.** Le HEIC et les autres formats que le navigateur ne sait pas décoder peuvent toujours être transférés comme fichiers, mais ne sont pas convertis en PNG.

## Mises à jour automatiques

| Composant | Comportement de mise à jour |
|---|---|
| Hôte / CLI | Même installation. Interroge le canal publié toutes les 15 minutes, vérifie les téléchargements et remplace les environnements d'exécution compatibles sans terminer les processus shell. Les transferts se terminent d'abord. Les Paramètres ou `jaunt update` déclenchent une vérification immédiate. Les hôtes plus anciens, sans passation d'environnement d'exécution, diffèrent la mise à jour tant que des shells ordinaires sont actifs ; terminer ces shells exige toujours une confirmation explicite. |
| Application de bureau | Version distincte de celle de l'hôte. Vérifie, télécharge et contrôle automatiquement une mise à jour ; l'installe à la fermeture de l'application. Les Paramètres proposent une vérification manuelle, un interrupteur de mise à jour automatique et **Installer et rouvrir**. Mettre à jour l'interface graphique n'arrête ni l'hôte ni ses shells. Les paquets système peuvent demander une autorisation du système d'exploitation. |
| APK Android | Vérifie automatiquement la disponibilité d'un nouvel APK. Une boîte de dialogue de vérification/téléchargement visible mène à la confirmation d'installation d'Android. La somme de contrôle et le certificat de signature de l'APK sont vérifiés ; Android n'autorise pas l'auto-installation silencieuse. |
| Client web | Utilise la version publiée sur Pages. Rouvrez ou rechargez la page pour activer une mise à jour du service worker déjà téléchargée. |

Les installations existantes doivent d'abord recevoir la version qui contient leur mécanisme de mise à jour avant que celui-ci puisse s'exécuter. Relancer la commande officielle d'installation de l'hôte met l'hôte à jour et installe l'application de bureau annoncée ; elle refuse de fermer silencieusement des shells ordinaires actifs. Les clés d'appairage sont conservées. Consultez [mises à jour et protection au redémarrage](docs/UPDATES.md).

## Retour sur la connexion et les opérations

Une coupure réseau se traduit par une seule bannière de connexion persistante avec une action de nouvelle tentative. jaunt se reconnecte avec la clé d'appareil enregistrée ; il ne rejoue pas les saisies terminal non envoyées. Une révocation ou un échec de vérification de l'hôte interrompent la connexion et expliquent l'étape suivante. Les erreurs survenues dans une boîte de dialogue y restent ; les autres erreurs d'action restent visibles jusqu'à ce que vous les fermiez. Les courtes notifications de confirmation sont dédupliquées et limitées à deux.

Les envois, téléchargements, installations de service et vérifications de mise à jour affichent leur progression et un résultat final dans Activité. Les pauses réseau sont explicites, l'annulation d'un transfert est possible et l'historique des opérations terminées peut être déplié. Une mise à jour disponible propose une action directe plutôt qu'une notification éphémère.

## Notifications

Activez les notifications dans les **Paramètres** et utilisez leur action de test. Le titre et le texte des notifications émises par un programme sont conservés lorsqu'ils sont fournis ; une simple cloche de terminal n'a pas de corps de message à restituer. Cliquer sur une notification sélectionne l'hôte et la session correspondants. Les notifications de bureau exigent que l'application soit en cours d'exécution ; Android utilise son service de connexion en premier plan optionnel ; le client web utilise le Web Push du navigateur. Le contenu d'une notification peut apparaître sur l'écran de verrouillage selon les réglages du système.

## Limitations connues

- Jusqu'à 16 shells actifs, 32 vues conservées, 2 MiB de relecture brute par PTY et 10 000 lignes d'historique xterm. Tout copier couvre l'historique conservé, pas un journal illimité.
- Limite de taille de fichier sur l'hôte : 512 MiB. Les téléchargements en mémoire sont limités à 128 MiB dans les navigateurs sans écriture directe de fichiers ; les aperçus sont limités à 16 MiB. Jusqu'à huit envois simultanés et 1 GiB de taille totale déclarée.
- Les envois reprennent après une coupure réseau tant que l'hôte et la page conservent le transfert. Relancez l'envoi après un redémarrage de l'hôte ou un rechargement complet de la page ; jaunt n'obtient aucun accès persistant non autorisé aux fichiers locaux du téléphone.
- Les shells ordinaires survivent à une déconnexion et aux mises à jour compatibles de l'environnement d'exécution, **mais pas à un arrêt/redémarrage explicite du démon ni à un redémarrage de la machine**. tmux peut survivre à un redémarrage du démon, mais pas à un redémarrage du système.
- Un seul onglet d'application jaunt par profil de navigateur peut détenir le coffre à la fois. Plusieurs onglets de terminal dans jaunt et plusieurs appareils sont pris en charge.
- Les notifications du navigateur exigent une autorisation et la prise en charge du Web Push. Dans l'APK, activez les notifications Android en arrière-plan dans les Paramètres ; les restrictions de batterie d'Android peuvent en retarder la livraison. Sur iOS, utilisez la PWA installée. La livraison dépend du réseau et du fournisseur de push ; elle n'est pas garantie en temps réel.
- Un hôte en veille ou éteint est injoignable. Il n'existe ni réveil à distance, ni tunnel TCP arbitraire, ni bureau graphique, ni prise en charge d'un shell Windows natif.
- Les paquets de bureau Linux sont disponibles pour x64 et ARM64 ; les archives macOS ne sont ni signées ni notarisées. Aucun paquet de bureau Windows natif n'est fourni. Le comportement sur un téléphone Android physique et l'autorisation protégée du mécanisme de mise à jour macOS n'ont pas été validés ; les résultats sur émulateur sont documentés séparément.
- Les coûts, quotas et disponibilité du relais de production dépendent du compte Cloudflare. Les protections de base du relais ne constituent pas un service commercial garanti de protection contre les abus.

## Développement local

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm ci
npm run prepare-web
python scripts/dev.py
```

Le lanceur n'écoute que sur `127.0.0.1`, démarre un hôte et un relais local, et affiche un code QR de test. **Cela n'expose pas l'hôte à Internet.** Sur un téléphone physique, utilisez le déploiement HTTPS : `localhost` désigne le téléphone, pas le PC.

```sh
pytest -q                        # Python tests and Node interoperability tests
npm test                         # Relay model, protocol/UI helpers and desktop updater
npm run test:relay               # Real Miniflare runtime; npm dependencies required
python scripts/check_project.py  # Resource consistency and syntax
python scripts/build_release.py  # Wheel, manifest, and SHA256SUMS
python tests/browser_e2e.py       # Real browser and host in temporary isolation
python tests/shared_workspace_e2e.py # Electron + browser sharing real PTYs; needs a display
python tests/terminal_render_e2e.py  # Scroll, selection and terminal geometry
python tests/installer_e2e.py        # Real wheel install and protected upgrade
python tests/client_update_e2e.py    # Browser-driven host self-update, pushed progress, refusal of a broken release
python tests/bridge_e2e.py           # Real Claude Code and Codex sessions discover and message each other through the bridge (uses your real accounts)
python tests/workspace_sync_e2e.py   # Shared open sessions between two clients, close-or-terminate choice, displayed-only mode
```

Définissez `jaunt_BROWSER_EXECUTABLE=/path/to/chromium` pour utiliser un navigateur du système. Sinon, exécutez `python -m playwright install chromium`. Les tests ne modifient jamais les politiques de sécurité de votre navigateur.

## Déploiement initial — une seule fois, par le propriétaire du projet

Confiez [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md) à un agent disposant d'un accès GitHub. Il configure GitHub Pages, une version de l'hôte et **un seul relais Cloudflare pour l'ensemble du projet**. Une autorisation Cloudflare est nécessaire ; un jeton GitHub ne la fournit pas. Les utilisateurs finaux ne créent aucune infrastructure.

jaunt n'emprunte aucun relais à sshx, Happy ou Zedra. Il ne dépend ni de leurs serveurs, ni de Tailscale, ni d'un compte utilisateur jaunt. Le compte Cloudflare du propriétaire peut être soumis à des quotas ou engendrer des coûts ; aucun relais gratuit ou illimité n'est promis.

## Documentation

[Déploiement](docs/DEPLOYMENT.md) · [Sécurité](SECURITY.md) · [Protocole](docs/PROTOCOL.md) · [Dépannage](docs/TROUBLESHOOTING.md) · [Validation](docs/VALIDATION.md) · [Mentions tierces](../../../THIRD_PARTY_NOTICES.md)

L'anglais est la langue de référence de la documentation. Traductions : [Français](README.md), [Español](../es/README.md), [Italiano](../it/README.md), [Português](../pt/README.md), [Deutsch](../de/README.md). Chaque arborescence traduite comprend les guides de sécurité, de déploiement et de validation.

Les clients web, Android et de bureau sélectionnent automatiquement la langue du système. Vous pouvez la forcer dans **Paramètres → Langue**. La CLI utilise la locale du système ; `jaunt --language fr --help` force la langue pour une seule invocation et `jaunt language fr` enregistre la préférence. Utilisez `system` pour revenir à la sélection automatique. Les noms de commandes, les arguments, la sortie du terminal et le contenu utilisateur ne sont jamais traduits.

L'adresse web publique présente le projet ; **Ouvrir l'espace de travail** ouvre le client. Les applications natives ouvrent directement l'espace de travail.

## Application Android

Le client Android est un APK avec une interface WebView embarquée et des intégrations natives pour le presse-papiers, l'appareil photo, les fichiers et les notifications en arrière-plan. Consultez [Installation, architecture et validation Android](docs/ANDROID.md). La page annonce l'APK une fois ses ressources publiques vérifiées.

L'APK est un paquet Android natif avec une WebView embarquée, pas une installation PWA. L'interface et la typographie sont partagées avec les applications web et de bureau ; l'intégration native fournit l'appareil photo, le presse-papiers, la sélection de fichiers et les notifications. Consultez le tableau des mises à jour ci-dessus pour les exigences de confirmation d'installation.
