[English](../../../SESSION_CONTROLS_VALIDATION.md) · [fr](SESSION_CONTROLS_VALIDATION.md) · [es](../../es/docs/SESSION_CONTROLS_VALIDATION.md) · [it](../../it/docs/SESSION_CONTROLS_VALIDATION.md) · [pt](../../pt/docs/SESSION_CONTROLS_VALIDATION.md) · [de](../../de/docs/SESSION_CONTROLS_VALIDATION.md)

# Validation des contrôles de session

Le gestionnaire de session a précédemment imbriqué des boutons de menu-fichier pleine largeur à l'intérieur d'une ligne horizontale non enveloppante. Les actions ont débordé la boîte de dialogue; le nom était absent de la liste. Il utilise maintenant des cartes de session réactives et des actions explicites Open, Renommer, Fermer la vue et Terminer.

ordinaire shell création n'ouvre plus de boîte de dialogue de nommage. L'action dossier fournit la navigation répertoire avec un nom optionnel. shell's répertoire courant; les anciens hôtes utilisent le dernier répertoire initial connu. Les commandes de partage de bureau sélectionnez directement l'orientation et afficher un choixur de session nouvelle/existant en ligne. Chaque panneau de tuiles peut se déplacer dans un onglet indépendant sans créer ou terminer un PTY.

Observé localement le 2026-09-15:

- Python 3.14.2: `python -m pytest -q` — 67 passé, y compris les cadres de flux tardifs inoffensifs après la terminaison, l'héritage réel du répertoire PTY après `cd`, le remplacement explicite du répertoire et les noms automatiques non collidants.
- Node 25.5.0: `npm test` — 27 réussis; `npm run test:relay` — 2 vrais tests Miniflare/travailleurs réussis.
- `python tests/shared_workspace_e2e.py` dans Electron avec un hôte de fixation isolé — passé. Exercices local/remote partagé PTYs, les deux orientations fractionnées, la sélection de session existante, le déplacement d'un panneau vers un onglet, la persistance de rechargement, l'aplatissement mobile, les limites d'action de session à 390 et 1300 pixels, le nom/fermer/réouvrir/terminer local, la création automatique avec héritage de répertoire réel, et la navigation de répertoire.
- `python tests/browser_e2e.py` — 23 scénarios passés.
- `python tests/terminal_render_e2e.py` — la géométrie de défilement/clavier et le démarrage réel isolé Claude Code/Codex sont passés.
- Le paquet de bureau Linux construit a passé le même contrôle de session élargi E2E. `node scripts/check_desktop_package.mjs` a vérifié les importations groupées, les autorisations d'œuvres et de lanceurs.
- `python scripts/check_project.py` et `python scripts/build_release.py` sont passés pendant le développement.

Le harnais de test Electron désactive sa boîte de sable en isolation; ce n'est pas un réglage de lanceur de production. Le package beta.8 Debian installé a démarré en Ubuntu 24.04 avec le renderer Seccomp=2 et NoNewPrivs=1; un nouveau fichier local shell a écrit un nouveau fichier d'épreuves. Le APK signé a passé les tests d'émulateur Android pour le redimensionnement réel, le défilement tactile, la rotation et le contenu de notification/sélection de cible. La première tentative d'émulateur a rencontré une sortie externe du processus UIAutomator 137; le redémarrage du APK inchangé et le test a passé. L'installateur a passé les 9 contrôles, y compris le rejet de checkum, l'importation de roues non ditable, la protection active-shell et le redémarrage explicitement autorisé avec une identité préservée.

Un test d'installation a révélé un défaut supplémentaire: l'ancien installateur appelé `service stop` même avec `jaunt_NO_SERVICE=1`, arrêtant le service local réel du mainteneur. Le service a été redémarré; PTYs ordinaire ne peut pas être récupéré après un arrêt de démon. L'installateur respecte désormais le mode sans service lors de l'arrêt. Le fixture ombres à la fois systemctl et launchctl et affirme qu'aucun n'est invoqué.

CI a également reproduit une course de mise en page sur recharge immédiate après scission. La sélection de session persiste maintenant avant le rendu ou l'attente de la fixation terminal. L'affirmation de la mise en charge immédiate reste dans le test d'espace de travail partagé.

## Opérations visibles et mises à jour informatiques

La bande d'activité conserve la progression du téléchargement et le résultat final réel : insertion de fichier/chemin vérifiée sans Enter, ou achèvement du presse-papier hôte plus livraison Ctrl+V. Elle ne revendique pas la reconnaissance en tant que pièce jointe Claude Code/Codex. Elle suit également les états de mise à jour de l'hôte par la vérification, le téléchargement, la vérification, l'installation, la défaillance explicite et le report pour shells active.

La mise à jour de bureau vérifie le canal publié au démarrage et toutes les 15 minutes, télécharge uniquement l'actif de la version du projet correspondant, et vérifie SHA-256 après le téléchargement et avant l'installation. L'installation automatique s'exécute lorsque l'application du bureau se ferme. Paramètres fournit une mise à jour automatique toggle, vérification manuelle, progression visible et Installer et rouvrir. Les paquets système Linux et les emplacements d'applications macOS protégés peuvent nécessiter une autorisation OS. L'installateur détaché n'appelle pas l'hôte CLI ou un gestionnaire de services; les sessions terminal appartiennent au processus hôte séparé.

Node les tests couvrent la sélection de la version/de l'actif, les phases de progression, les résultats de la version actuelle, le rejet de la somme de contrôle, la revalidation avant l'installation, et le remplacement réel de l'extraction/application d'archives dans une maison isolée, alors qu'un processus non lié et des données d'identité enregistrées restent intacts. Electron test charge également une image à travers le pont local et vérifie l'indicateur d'achèvement persistant. Android affiche maintenant une boîte de dialogue de vérification explicite et détermine la progression du téléchargement lorsqu'une longueur de contenu est disponible.

CI a en outre rencontré un ID de périphérique de base64url généré commençant par un trait d'union. Le test de révocation du navigateur passe maintenant `--` avant l'ID positionnel, comme le test de bureau déjà fait; les affirmations de révocation et de conservation de session restent inchangées.

## Livraison publiée — 2026-09-15

Les résultats de la publication et de l'installation publique ci-dessous ont été enregistrés après publication. Ils complètent les observations locales et CI ci-dessus.

- PR: https://github.com/moukrea/jaunt/pull/22
- Page : https://moukrea.github.io/jaunt/
- Hôte : v0.1.0-beta.10 (CLI 01.0b10)
- Bureau: bureau-v0.1.0-beta.8
- Android: android-v0.1.0-beta.6 (code de version 6)

Un candidat de mise à jour privé a téléchargé et vérifié la version bêta.7 du bureau public existant, installé son paquet Debian et rouvert le même profil dans un Ubuntu 24.04 VM. Host et PTY PIDs sont restés inchangés, et les commandes exécutées avant et après la mise à jour. L'instrumentation de débogage n'exigeait le redémarrage que de l'interface graphique de fixation. Ce candidat n'est pas une revendication que l'ancien bêta.6 public comprenait un updateur. La première tentative minimale-VM a révélé une dépendance de pkexec manquante; les paquets Debian/RPM livrés déclarent maintenant la dépendance d'autorisation OS. Une installation de paquet de fixation concurrente a également produit une erreur explicite de verrouillage de paquet-manager; une réessayer subséquente a réussi.

Le README complet est en anglais et décrit maintenant l'installation, l'hôte/desktop séparé/AndroidLes mécanismes de mise à jour /web, la création de sessions et l'héritage de répertoires, à la fois les orientations fractionnées, les résultats de livraison d'images, le comportement de notification et les limites de validation. npm audit a signalé zéro vulnérabilité; pip-audit n'a signalé aucune vulnérabilité connue à la dépendance, le projet modifiable lui-même étant exclu du catalogue des paquets externes.

L'implémentation fusionnée est un commit `937fb52ea56297326ce3fd090cb66802a76a063d`. Required CI, Android validation et les deux Linux/macOS distribution builds passé avant fusion. La dernière vérification de la version du registre Node trouvé seulement une nouvelle Miniflare alpha; la stabilité testée Miniflare 4.20260730.0 a été conservée.

Les trois biens publics d'accueil ont passé un manifeste/SHA-256 une validation et un scan gitleaks de la roue extraite. Une véritable beta publique.9→beta.10 installation dans le Ubuntu VM conserve l'identité de l'hôte et de l'appareil. Avant la promotion de Pages, ce test a explicitement sélectionné la balise d'hôte déjà publiée. APK beta.5→beta.6 mise à jour a conservé l'appariement existant et reconnecté sur le propriétaire de réel Worker. APK créé un shell, a exécuté une commande prouvée par un fichier, et a terminé la session de fixation. APK n'a pas été débogable, et son bilan public et son certificat de signature ont été appariés.

Tous les dix actifs de bureau publics correspondaient à leur catalogue SHA-256 publié. Les archives Linux et macOS, pour x64 et ARM64, contenaient toutes deux les mises à jour attendues, l'interface utilisateur d'activité visible, les ressources locales jsQR et Lucide, le logo original inchangé et les liens de publication host/Android/desktop actuels.

La commande d'installation exacte de la Page publique est passée par la suite dans un nouveau compte utilisateur Ubuntu (service actif activé et sortie QR) et un nouveau conteneur Fedora 43. La Page déployée a servi les 29 ressources vérifiées sous `/jaunt/` avec égalité d'octets. La recette publique réelle s'est avérée appariée, une mise à jour de l'hôte terminée, une exécution arbitraire de shell, des onglets de commutation, l'égalité d'octets de téléchargement multipuce, l'insertion image/chemin sans Enter, le rechargement et une interruption du réseau invité réel retournant à la même shell PID, un refus de mise à niveau protégé, un redémarrage explicitement autorisé avec une identité préservée et une révocation.

Le public Android application beta.5 a également effectué sa propre mise à jour beta.6 par la découverte de canal, HTTPS téléchargement, vérification de la somme de contrôle/signature, le Android l'écran de permission et l'installateur du paquet OS. L'appariement existant a survécu. Sa vérification explicite subséquente a affiché un résultat à jour. AndroidLes étiquettes des boutons majuscules, la vue d'autorisation contrôlable et le bouton installateur Open; il s'agissait de corrections de navigation d'essai, et non de dépassements des résultats de l'application.

## Suivi: rétroaction asynchrone cohérente

Le suivi supprime les cascades de toasts connection-error, maintient les erreurs de dialogue/pairing à côté de leur action, et limite les petits toasts de confirmation. Les contrôles d'activité maintiennent des nœuds DOM stables pendant les changements de progression; les résultats complétés s'effondrent dans l'historique accessible et les progrès tardifs ne peuvent pas écraser l'achèvement.

La génération tardive de clés asynchrones et les réponses d'accueil décryptées sont rejetées lorsqu'une connexion de remplacement a commencé. Les interruptions de transport réessayent; la vérification de l'hôte échouée arrête toujours la connexion. Le pont de bureau natif ignore les démarrages annulés et récupère les défaillances de connexion locale. Android fusionne les contrôles/téléchargements simultanés et remplace la boîte de dialogue des résultats au lieu de les empiler.

Observé localement : 29 Node tests réussis, y compris deux régressions de connexion statique. La rétroaction dédiée E2E passé avec trois vraies interruptions de poignées de main, cinq RPC interrompus, aucune cascade d'erreur-toast, reconnection à la même PTY, erreurs contextuelles, contrôles de progression cliquables stables, historique compact conservé et mobile terminal limites. Le navigateur E2E a passé les 23 scénarios; partagé Electron et réel isolé Claude Code/Codex terminal- test de rendu passé. Le fixture hôte/navigateur utilise désormais ses propres répertoires de données HOME et XDG, de sorte que la navigation initiale des fichiers ne peut pas énumérer les répertoires personnels.


La régression des paramètres de l'hôte sélectionné est également couverte : changer la barre latérale alors que les paramètres sont ouverts reconstruisent maintenant les contrôles liés à l'hôte immédiatement, rafraîchit l'état de mise à jour de l'hôte sélectionné et ignore les réponses statiques de la sélection précédente. Les contrôles du service local du bureau apparaissent uniquement pour l'hôte local; les mises à jour des applications du bureau et les notifications restent des paramètres de périphérique.

Validation observée : `python tests/feedback_e2e.py` a jumelé deux hôtes réels isolés, commuté entre eux sans quitter Settings, renommé Y, oublié X et vérifié que shell PID était inchangé. `DISPLAY=:179 python tests/desktop_remote_e2e.py` a utilisé la vraie connexion locale de Electron et le relais public du propriétaire WSS, vérifié que les commandes du service local disparaissent lors de la sélection à distance et retournent sur la sélection locale, puis exécuté et terminé un fixture shell. `python scripts/check_project.py` est passé.
