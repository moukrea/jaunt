[English](../../../README.md) · [fr](README.md) · [es](../es/README.md) · [it](../it/README.md) · [pt](../pt/README.md) · [de](../de/README.md)

# jaunt

<img src="web/assets/jaunt.png" width="96" alt="jaunt logo">

**Votre shells, vos fichiers, votre machine.

jaunt fournit des applications de bureau natives et Android, un client web mobile/desktop et un hôte POSIX. Il vous connecte à des terminaux réels, y compris des shells arbitraires, Claude Code et Codex. L'application web statique utilise un relais partagé pour effectuer des connexions cryptées à partir de l'hôte et du client.

**Host: 0.10.0-beta.11 · Desktop: 0.10.0-beta.10 · Android: 0.10.0-beta.8.** [Ouvrir jaunt](https://moukrea.github.io/jaunt/). La publication et la validation de la version sont suivies dans le rapport de validation. Le protocole n'a pas reçu d'audit de sécurité indépendant**. Voir le [dernier rapport de validation](docs/SEAMLESS_WORKSPACE_VALIDATION.md) pour les résultats d'essais observés et les limitations non validées.

## Installez l'hôte

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

Requiert Linux, macOS et WSL. Nécessite `curl`. L'installateur utilise un Python 3.11–3.14 compatible ou installe un Python privé via uv. L'hôte installe sans privilèges d'administrateur. Sur Ubuntu avec des espaces de noms d'utilisateur restreints, l'application de bureau optionnelle utilise l'installateur du paquet système et peut demander un mot de passe d'administrateur pour configurer sa sandbox. Il vérifie la version SHA-256, crée un environnement privé et démarre un service d'utilisateur lorsque disponible. Des mises à jour automatiques sont activées. Les hôtes compatibles conservent leurs processus shell pendant le remplacement de l'exécution et attendent que les transferts soient terminés.

À Android, [installer la signature APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.8/jaunt-android-v0.1.0-beta.8.apk), puis scanner la QR code affiché par l'hôte. Sur un bureau ou dans un navigateur, ouvrir **https://moukrea.github.io/jaunt/**. Vous pouvez aussi coller la `jaunt1.…` La ficelle d'appariement. QR le code expire après dix minutes et ne peut être utilisé qu'une seule fois. Wi-Fi ou les réseaux mobiles ne nécessitent pas de recoupement. Gardez l'onglet ouvert pour la reconnection automatique ; rouvrez l'application si le système d'exploitation mobile le suspend ou le tue.

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

L'appariement accorde l'accès en tant que compte **system exécutant l'hôte**, avec toutes les permissions de ce compte. Ne pas exécuter en tant que racine pour une utilisation ordinaire. Un code QR accorde l'accès shell : ne jamais le publier.

## Caractéristiques

Région Comportement
|---|---|
Terminaux Réel PTYs, clavier interactif, onglets multiples, créer/renommer/ouvrir/détache/terminer, dimensionnement partagé, mobile Ctrl/Alt/Esc/Tab/arrow keys
Réconnexion Réconnexion, réconnection automatique, état mémorisé ; une déconnexion du navigateur ne ferme pas le shell
Existence tmux L ' héritage tmux les sessions restent soutenues; les nouvelles sessions de l'assurance-chômage sont partagées shells |
Fichiers, fichiers cachés, pagination, créer des répertoires, renommer, suppression non-récursive, téléchargement/téléchargement, prévisualisations de texte/image
Transferts de données Progrès visibles et résultats de réussite/erreur conservés; suivi détaillé dans les fichiers → Activité de transfert; 48 morceaux KiB, offset de reprise de réseau, téléchargement de SHA-256, finalisation atomique, annulation
Images: Galerie, sélection de fichiers, coller et glisser-déposer; conversion PNG pour les formats décodables par navigateur; insertion de chemin ou de pâte native conditionnelle.
Clipboard de sélection, copie de défilement conservée, lecture/écriture du presse-papier hôte lorsque disponible, tampon texte sans tête, copie seulement OSC 52.
Protection des données Codes QR à usage unique, clés par appareil, révocation, coffre-fort de navigateur PIN/password protégé en option et verrouillage automatique
Notifications en option service ou navigateur Web Push Android; cloches terminal, événements de programme, sortie de session, test de configuration et CLI `notify`/`run`
Interface de bureau natif et applications Android avec une interface groupée partagée; client du navigateur; local JavaScript

## Client de bureau seulement

Pour se connecter à d'autres hôtes sans installer un service hôte local ou jaunt CLI :

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash -s -- --client-only'
```

Cela installe la même application de bureau et le même lanceur, avec appariement distant, sessions, fichiers, notifications et mises à jour d'application automatique. Il ne démarre pas un démon ou afficher les commandes d'hôte local. Il ne désinstalle pas un hôte précédemment installé. Exécutez la commande d'installation d'hôte normale pour permettre l'intégration d'hôte local plus tard.

L'application de navigateur installée s'appelle **jaunt (PWA)** afin qu'elle puisse être distinguée de l'application native **jaunt**. Les deux utilisent le logo original transparent. Native Android utilise la même œuvre sans un fond sombre groupé; les lanceurs individuels peuvent appliquer leur propre traitement d'icônes.

## Espace de travail partagé

Ouverture **jaunt** depuis le menu d'applications de l'hôte `jaunt gui`. Les clients hôtes et distants partagent la même ordinaire shells sans tmux** Nouveau shell** ouvre automatiquement un nom shell immédiatement, héritant du précédent actif shellLe bouton de dossier vous permet de parcourir les répertoires hosts et, en option, de nommer le nouveau shell. **Sessions** liste les sessions en cours d'exécution et sorties : ouvrir, renommer, fermer seulement votre vue, ou mettre fin explicitement à une shell Vous pouvez également renommer un onglet en double-cliquant sur son titre, ou en double-cliquant sur un titre de panneau. Faites glisser les onglets pour les réorganiser, en sélectionnant un onglet ne change jamais sa position. Le périphérique avec lequel vous interagissez contrôle le partage terminal taille.

Chaque volet peut se déplacer dans son propre onglet. Les mises en page survivent à la réouverture; le mobile affiche leurs sessions sous forme d'onglets normaux. La barre latérale du bureau peut s'effondrer, la préférence étant retenue. Les paramètres comprennent les noms d'hôte amicals, la commande et les thèmes hôtes par défaut, les thèmes sombres/lumière/système/circadiens et les commandes de notification. Les paramètres d'hôte suivent immédiatement la machine sélectionnée, y compris son identité et ses contrôles de mise à jour. L'application du bureau natif gère également le service hôte local et se paire à d'autres hôtes; les contrôles de service local apparaissent uniquement pour l'hôte local, tandis que les mises à jour des applications du bureau restent séparées. Voir le [guide de l'espace de travail](docs/WORKSPACE.md) et [rapport de validation](docs/WORKSPACE_VALIDATION.md)].

## Gestion de l'image

Les opérations terminées s'effondrent dans un résultat compact; **Afficher l'historique** conserve les détails. L'annulation d'un transfert s'affiche comme une annulation, et les erreurs restent avec leur fonctionnement. Le résultat final indique exactement ce qui s'est passé; les erreurs restent visibles avec une action de réessayer. Une insertion de chemin réussie ou une livraison Ctrl+V ne prouve pas que Claude Code ou Codex ont reconnu une pièce jointe.

**Paste:** quand un moteur natif est disponible, une image est téléchargée dans le presse-papiers hôte et collée dans la session sélectionnée avec Ctrl+V. Si le navigateur retourne un presse-papiers vide, l'interface utilisateur offre une zone de pâte riche et un sélectionneur d'images. Enter La clé est envoyée.

**Fallback avec une connexion active :** sélectionnez ou collez une image, téléchargez-la sur l'hôte, et insérez son chemin correctement échappé dans le terminal. Rien ne soumet la commande automatiquement. Claude, Codex, ou un autre outil peut lire le fichier si son propre mode le supporte.

**Pâte native conditionnelle :** lorsque l'hôte dispose d'un presse-papiers graphique accessible (macOS, Wayland avec `wl-clipboard` ou X11 avec `xclip`), jaunt y met le PNG et envoie Ctrl+V au terminal. Cela dépend également du raccourci et du comportement de l'outil CLI. **Sur un hôte sans tête, jaunt ne peut pas fabriquer une pièce native Claude/Codex : elle revient à un fichier et à son chemin.** HEIC et autres formats que le navigateur ne peut pas décoder peuvent toujours être transférés en tant que fichiers, mais ne sont pas convertis en PNG.

## Mises à jour automatiques

Composante Mettre à jour le comportement
|---|---|
Hôte / CLI Même installation. Vérifie le canal publié toutes les 15 minutes, vérifie les téléchargements et remplace les runtimes compatibles sans fin shell processus. Les transferts finissent en premier. `jaunt update` vérifier immédiatement. Les hôtes plus âgés sans délai d'exécution différé pendant ordinaire shells sont actifs; shells demande toujours une confirmation explicite.
L'application de bureau se sépare de l'hôte. Vérifie automatiquement, télécharge et vérifie une mise à jour; installe lorsque vous fermez l'application. Paramètres fournit une vérification manuelle, une mise à jour automatique toggle et **Installer et rouvrir**. Mettre à jour l'interface graphique n'arrête pas l'hôte ou ses paquets système shells.
Android APK=Vérifie automatiquement un nouveau APK. Une boîte de dialogue de contrôle/téléchargement visible mène à la confirmation d'installation de Android=. Le somme de contrôle et le certificat de signature de APK=S sont vérifiés; Android ne permet pas l'auto-installation silencieuse.
Utiliser la version publiée sur les pages. Réouvrir/recharger pour activer une mise à jour de service-travailleur téléchargée.

Les installations existantes ont besoin de la version contenant leur mise à jour avant que cette mise à jour ne puisse fonctionner. Réexécution de la commande hôte officielle met à jour l'hôte et installe l'application de bureau annoncée; il refuse de fermer silencieusement l'ordinaire actif shells. Les touches d'appariement sont conservées. Voir [mises à jour et protection de redémarrage](docs/UPDATES.md).

## Feedback de connexion et d'exploitation

Une interruption réseau a une bannière de connexion persistante avec une action de réessayer. jaunt se reconnecte à l'aide de la clé de périphérique sauvegardée ; il ne rejoue pas une entrée terminal non envoyée. La révocation et la vérification de l'hôte échouée arrêtent la connexion et expliquent l'étape suivante. Les erreurs dans une boîte de dialogue restent dans cette boîte de dialogue ; d'autres erreurs d'action restent visibles jusqu'à ce qu'elles soient rejetées.

Les téléchargements, l'installation de service et les vérifications de mise à jour montrent les progrès et un résultat final dans Activité. Les pauses réseau sont explicites, l'annulation de transfert est disponible, et l'historique complété peut être élargi.

## Notifications

Activer les notifications dans **Paramètres** et utiliser son action d'essai. Les titres et le texte des notifications du programme sont conservés lorsqu'ils sont fournis. terminal bell n'a pas de corps de message à récupérer. Cliquer sur une notification sélectionne l'hôte et la session correspondants. Android utilise son service optionnel de connexion de premier plan; le client Web utilise le navigateur Web Push. Le contenu de notification peut apparaître sur l'écran de verrouillage selon les paramètres de l'OS.

## Limites connues

- Jusqu'à 16 shells actifs, 32 vues conservées, 2 MiB de replay brut par PTY, et 10 000 lignes de défilement xterm. Copier-tout couvre l'historique conservé, pas un log illimité.
- Limite du fichier hôte : 512 MiB. Les téléchargements en mémoire sont limités à 128 MiB dans les navigateurs sans écriture directe de fichier; les prévisualisations sont limitées à 16 MiB. Jusqu'à huit téléchargements simultanés et 1 GiB de taille totale déclarée.
- Redémarrer le téléchargement après un redémarrage de l'hôte ou un rechargement complet de la page; jaunt n'obtient pas un accès persistant non autorisé aux fichiers locaux du téléphone.
- shells ordinaire survivra à la déconnexion et aux mises à jour d'exécution compatibles, **pas d'arrêt/redémarrage de démon explicite ou de redémarrage de machine**. tmux peut survivre à un redémarrage de démon, mais pas à un redémarrage d'OS.
- Un seul onglet d'application jaunt par profil de navigateur peut posséder la voûte à la fois. Plusieurs onglets terminal à l'intérieur de jaunt et plusieurs appareils sont pris en charge.
- Dans le APK, activez les notifications d'arrière-plan Android dans Paramètres; les restrictions de la batterie Android peuvent retarder la livraison. Sur iOS, utilisez le PWA installé. La livraison dépend du réseau et du fournisseur de push; elle n'est pas garantie en temps réel.
- Un hôte endormi ou éteint est inaccessible. Il n'y a pas de wake-up à distance, tunnel TCP arbitraire, bureau graphique ou natif Windows shell.
- Les paquets de bureau Linux sont disponibles pour x64 et ARM64; les archives macOS sont non signées et non notariées. Aucun paquet de bureau natif Windows n'est fourni. Le comportement physique du téléphone Android et l'autorisation de mise à jour macOS protégée n'ont pas été validés; les résultats de l'émulateur sont documentés séparément.
- Les coûts, les quotas et la disponibilité des relais de production dépendent du compte Cloudflare. Les garanties de base ne sont pas un service commercial de protection des abus garanti.

## Développement local

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm ci
npm run prepare-web
python scripts/dev.py
```

Le coureur n'écoute que sur `127.0.0.1`, démarre un relais local et affiche un code de test QR. **Cela n'expose pas l'hôte à Internet.** Utilisez le déploiement HTTPS sur un téléphone physique : `localhost` se réfère au téléphone, pas au PC.

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
```

Définissez `jaunt_BROWSER_EXECUTABLE=/path/to/chromium` pour utiliser un navigateur système. Sinon, exécutez `python -m playwright install chromium`. Les tests ne changent jamais les politiques de sécurité de votre navigateur.

## Déploiement initial — une fois, par le propriétaire du projet

Donner [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md) à un agent avec accès GitHub. Il configure GitHub Pages, une version hôte et **one Cloudflare relais pour l'ensemble du projet**. L'autorisation Cloudflare est requise; un jeton GitHub ne le fournit pas. Les utilisateurs finaux ne créent pas d'infrastructure.

jaunt n'emprunte pas de relais à partir de sshx, Happy ou Zedra. Il ne dépend pas de leurs serveurs, de Tailscale ou d'un compte utilisateur jaunt. Le compte du propriétaire Cloudflare peut encourir des quotas ou des coûts; aucun relais gratuit ou illimité n'est promis.

## Documentation

[Deployment](docs/DEPLOYMENT.md) · [Security](SECURITY.md) · [Protocol](docs/PROTOCOL.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Validation](docs/VALIDATION.md) · [Avis de tiers](../../../THIRD_PARTY_NOTICES.md)]

L'anglais est la langue de documentation canonique. Traductions: [Français](README.md), [Español](../es/README.md), [Italiano](../it/README.md), [Português](../pt/README.md), [Deutsch](../de/README.md). Chaque arbre traduit comprend les guides de sécurité, de déploiement et de validation.

Web, Android et bureau sélectionnez la langue du système automatiquement. Surpasser dans **Paramètres → Langue**. Le CLI utilise la locale du système; `jaunt --language fr --help` outrepasse une invocation et `jaunt language fr` sauve la préférence. Utilisez `system` pour restaurer la sélection automatique. Les noms de commande, les arguments, la sortie terminal et le contenu utilisateur ne sont jamais traduits.

L'adresse Web publique présente le projet; **Open workspace** entre dans le client. Les applications autochtones ouvrent directement l'espace de travail.

## Application Android

Les Android client est un APK avec un faisceau WebView l'interface et les intégrations de presse-papiers, de caméras, de fichiers et de notifications de fond natives. Voir [Android installation, architecture et validation](docs/ANDROID.md). La page annonce APK après vérification de ses biens publics.

Le APK est un paquet natif Android avec un ensemble WebView, pas une installation PWA. L'interface et la typographie sont partagées avec les applications web et de bureau; intégration native fournit caméra, presse-papier, sélection de fichiers et notifications. Voir le tableau de mise à jour ci-dessus pour les exigences de confirmation d'installation.
