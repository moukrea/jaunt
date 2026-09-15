[English](../../../ANDROID_RELEASE_NOTES.md) · [fr](ANDROID_RELEASE_NOTES.md) · [es](../../es/docs/ANDROID_RELEASE_NOTES.md) · [it](../../it/docs/ANDROID_RELEASE_NOTES.md) · [pt](../../pt/docs/ANDROID_RELEASE_NOTES.md) · [de](../../de/docs/ANDROID_RELEASE_NOTES.md)

# jaunt Android 0,10-bêta.8

Cette mise à jour ajoute le défilement tactile avec l'élan, préserve la position de lecture à travers le redimensionnement du clavier, utilise les icônes d'interface de Lucide groupées, et utilise le logo transparent original comme icône de lancement. Il utilise l'icône originale jaunt, fournit le gestionnaire de session partagé et les thèmes, et reçoit automatiquement des notifications terminal bell/program/session-exit lorsque activé.

Cette version régule l'entrée rapide de terminal pour éviter de déborder la file d'attente d'entrée limitée de l'hôte. En attendant, l'entrée est supprimée si le canal crypté change ; les commandes ne sont jamais rejouées après la reconnexion.

Installez l'actif `.apk` signé ci-dessous sur Android 8 ou plus récent. Autorisez l'installation depuis votre navigateur lorsque Android demande, ouvrez jaunt, puis scannez le QR produit par `jaunt pair` sur votre hôte. Aucun compte Android, GitHub ou Cloudflare n'est nécessaire pour vous connecter.

Il s'agit d'un Android APK installable avec une interface WebView groupée et des intégrations natives, pas un PWA et pas une interface Android entièrement réécrite:

- Caméra native QR numérisation et sélection de galerie/fichier.
- Android accès au presse-papiers image/texte. Une image collée est téléchargée et, lorsque l'hôte a un presse-papiers OS pris en charge, copiée là avant d'envoyer Ctrl+V à la sélection shell, sans Enter. Les hôtes sans tête conservent un retour explicite sur le chemin/upload.
- Enregistrez la boîte de dialogue pour les téléchargements; les progrès de transfert vérifiés restent disponibles à partir des fichiers.
- Connexion de premier plan native optionnelle pour les notifications, y compris pendant que l'application est en arrière-plan. Activez-le dans Paramètres. Android notification comprend Stop. Notifications afficher le titre/corps émis par les programmes; tapoter un ouvre la session correspondante. Android Les paramètres de confidentialité de l'écran de verrouillage s'appliquent toujours.
- L'appariement sauvegardé survit aux mises à jour de l'application et aux changements de réseau. Les clés sont exclues de la sauvegarde; les identités de service d'arrière-plan sont cryptées avec Android Keystore.

L'hôte doit rester en marche; l'installateur public à commande unique configure son service utilisateur. Android force-stop, les restrictions de batterie, les pannes d'hôte/réseau et la planification du système d'exploitation peuvent retarder ou empêcher les notifications. Cela ne promet pas la livraison garantie pendant le ralenti profond. Le protocole n'a pas subi un audit de sécurité indépendant.

Le rapport de validation distingue les tests d'émulateur des tests de téléphone physique et de la livraison exacte du presse-papiers/Ctrl+V de la reconnaissance comme pièce jointe à une version particulière de Claude Code/Codex. Voir `docs/ANDROID.md` et `docs/VALIDATION.md` dans la source marquée.

Le APK vérifie automatiquement les mises à jour. Les paramètres offrent également une vérification immédiate. Les téléchargements sont vérifiés en fonction des montants de vérification de la mainlevée et de l'identité de signature installée avant que Android ne demande la confirmation de l'installation.

Le nouveau shell crée un répertoire terminal automatiquement nommé immédiatement. Le nouveau shell dans le dossier offre une navigation de répertoire et un nom optionnel. L'hôte peut hériter du répertoire courant actif shell. Le bureau dispose de contrôles séparés côte à côte et au-dessus/ci-dessous, d'un choix en ligne de sessions nouvelles ou existantes et d'un bouton pour déplacer chaque volet dans son propre onglet. Mobile conserve les onglets de session ordinaires. La fermeture d'une vue maintient son shell en vie; la terminaison nécessite toujours une confirmation explicite.

Les interruptions de connexion partagent maintenant une bannière d'état persistante. Les résultats de la poignée de main asynchrone tardive ne peuvent pas écraser une connexion de remplacement. Les erreurs de dialogue restent en ligne; les erreurs d'action persistent sans cascades grillées. Les transferts exposent l'attente/annulation/achèvement, l'activité terminée s'effondre dans l'historique accessible, et la disponibilité de mise à jour garde son action visible.

Cette version ajoute six langages d'interface utilisateur détectés par le système avec une préséance sauvegardée, des onglets draggables stables avec un double-clic renommage, des retours d'exploitation corrigés et des icônes locales de premier plan de Claude/OpenAI. L'application native ouvre directement l'espace de travail; la page d'accueil de la présentation est réservée au site Web.
