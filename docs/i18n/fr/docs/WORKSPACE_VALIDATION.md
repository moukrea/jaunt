[English](../../../WORKSPACE_VALIDATION.md) · [fr](WORKSPACE_VALIDATION.md) · [es](../../es/docs/WORKSPACE_VALIDATION.md) · [it](../../it/docs/WORKSPACE_VALIDATION.md) · [pt](../../pt/docs/WORKSPACE_VALIDATION.md) · [de](../../de/docs/WORKSPACE_VALIDATION.md)

# Validation de l'espace de travail — 2026-09-15

Ce rapport enregistre les observations, pas une certification. Le protocole personnalisé reste indépendant non vérifié. Les vérifications du déploiement public et des versions installées sont enregistrées dans [PUBLIC_DELIVERY.md](PUBLIC_DELIVERY.md); le tableau suivant enregistre les vérifications du développement et de la plate-forme.

## Observations locales

Commande / environnement
|---|---|
`.venv/bin/python -m pytest -q`.61 passé, y compris un vrai travail shell/background qui ignore la terminaison gracieuse, les emplois survivants après la sortie de shell, la propriété de géométrie partagée, l'analyse de séparation OSC, le cryptage/replay et les mises à jour sécurisées.
`npm test`.21 passé, y compris la rétention de l'arbre divisé, les thèmes, la cryptographie, le pacing/commande d'entrée et la déconnexion-sans entrée-replay.
| `npm run test:relay` Nombre réel de travailleurs/Miniflare WebSocket mise à jour, enregistrement durable des objets, routage et hibernation ping passé
| `npm run prepare-web` Ensembles épinglés localement xterm/fit et jsQR, conserve leurs licences, copie installateur, régénère l'inventaire des travailleurs-services.
`python scripts/check_project.py`= Importations locales, chemins de ressources et syntaxe passés
| `python scripts/build_release.py` Une véritable roue d'hôte non-éditable, manifeste et SHA256SUMS construit avec succès
| `python tests/browser_e2e.py` 23 scénarios passés : réel PTY commandes et rafales de 512 caractères, clients indépendants, récupération de réseau, transferts d'octets exacts, comportement image/chemin/tête, verrouillage de voûte et révocation
| `DISPLAY=:179 python tests/shared_workspace_e2e.py` Nombre effectif Electron processus et navigateur indépendant partager un PTY; redimensionnement passif ne vole pas la taille; fermeture/réouverture des réserves shell; se termine ferme toutes les vues; les onglets divisés survivent à recharger et aplatir sur mobile.
`python tests/terminal_render_e2e.py`.Scroll de roue longue sortie et retour aux dernières limites de ligne/colonne, contrôle de sélection de texte natif, thèmes persistants, montage synchronisé-output; installation des écrans de démarrage Claude Code/Codex dans des profils isolés et non authentifiés.
Android Gradle debug build/unit testes de construction et d'unité native testes réussis
`python tests/android_workspace_e2e.py`) Android 14 émulateur: installé APK → relais public appartenant au projet → hôte réel isolé → commande éprouvée; la touche d'écran réelle ouvre IME et rétrécit le port de vue; limites de barre d'état, rotation et screen-off OS notification d'un terminal BEL passé
Installé `.deb` dans Ubuntu 24.04.5 VM. L'application native ouverte, la roue candidate non modifiable a exécuté une commande PTY locale éprouvée, le rendeur avait Seccomp=2 et NoNewPrivs=1, et aucune surcharge de sandbox n'était présente.
`npm audit`= Zéro vulnérabilités rapportées dans l'arborescence de dépendance résolue=

La chaîne d'outils locale comprenait Python 3.14.2, Node 25.5.0, npm 11.8.0, Java 17, Gradle 9.5.0, Electron 44.3.0, xterm 6.0.0, FitAddon 0.11.0, et jsQR 1.4.0. CI utilise Node 22 et sa matrice Python/Linux/macOS configurée. Les vérifications de démarrage réelles de CLI ont utilisé Claude Code 2.1.272 et codex-cli 0,154.0; ils n'ont pas soumis de demandes de modèles ni inspecté les conversations/crédentielles des utilisateurs.

Les références de versions ont été vérifiées par rapport à [ElectronLe dossier officiel de la libération](https://releases.electronjs.org/release/v44.3.0) et les notes de sortie de [xterm]](https://github.com/xtermjs/xterm.js/releases/tag/6.0.0). xterm 6 comprend un support de sortie synchronisé. npml'audit ne remplace pas un chrome/Electron examen de sécurité ou audit du protocole personnalisé.

## Constatations corrigées au cours de la validation

- FitAddon a mesuré un parent rembourré, répartissant des lignes/colonnes à l'extérieur de la zone d'affichage réelle. Un montage séparé non rembourré fournit maintenant la zone mesurée; teste les deux limites visibles.
- L'implémentation Android rembourrée WebView elle-même au lieu de sa mise en page externe. Le cadre externe consomme maintenant les insets système/coupout/IME, et l'interface utilisateur partagée reçoit l'état du clavier.
- L'icône originale Android était un dessin terminal non lié. Android expédie maintenant le PNG fourni avec précision; les références de navigateur/favicon/notification/desktop utilisent la même œuvre d'art.
- Le bundle terminal fourni manquait de provenance exacte de construction. Il est maintenant reconstruit à partir des dépendances npm épinglées et des deux licences en amont.
- La fermeture d'une vue et le meurtre du shell sous-jacent ont été confondus. Ils ont maintenant des actions et des tests d'interface utilisateur distincts.
- Les permissions de paquets de bureau ont hérité d'un umask de construction privé, rendant le répertoire installé inaccessible aux utilisateurs ordinaires. Le crochet d'emballage normalise maintenant les répertoires d'applications et les permissions exécutables/data. La validation de bac à sable emballé est suivie séparément des tests de rendu de mode source. Ubuntu VM a découvert une bibliothèque manquante.

CI a en outre attrapé la compatibilité macOS Bash 3.2 dans le bootstrap environnement-alias et un vieux-roue/nouveau-installer état-répertoire. Le bootstrap compatibilité fonctionne maintenant avant l'importation d'une vieille roue, y compris les invocations CLI suivantes. Le vrai test Fedora borned-curl passe avec le beta.5 public et l'installateur candidat.

La matrice hôte est passée Linux et macOS avec Python 3.11 et 3.13. macOS, l'hôte utilise la liaison du système waitid lorsque Python omit, après Apples public [Wait.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/wait.h) et [signal.h]](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/signal.h) les définitions.shell Les deux systèmes d'exploitation font l'objet des mêmes tests réels.

Le test Electron sans tête en mode source utilise une commande sandbox seulement dans un serveur X isolé. La vérification séparée du paquet installé est passée sans cette commande sur le Ubuntu VM. Le code principal/précharge de production ne désactive jamais la commande sandbox.

## Limites de validation restantes

Aucun combiné Android physique n'était disponible. La capture de la caméra QR, les variations de galerie, le comportement d'OEM gestuel-navigation, la rotation physique, le transfert de Wi-Fi/mobile et la livraison de notification en profondeur restent non validés.

Le démarrage réel de CLI et un fixture d'entrée synchronisée sont testés; une conversation modèle authentifiée complète, le comportement redraw de chaque version de CLI, et chaque implémentation d'image-attachement spécifique à un agent ne sont pas revendiqués comme validés. Le transport de presse-papiers natif et la distinction explicitement sans tête de chargement/chemin restent séparés de la reconnaissance des pièces jointes d'un agent.

macOS exécution de bureau, invites de confiance OS, matériel ARM, présentation de notification de bureau à travers les environnements de bureau, et la livraison du navigateur push-provider nécessitent des preuves spécifiques à la plate-forme. terminalLe téléphone est promis.
