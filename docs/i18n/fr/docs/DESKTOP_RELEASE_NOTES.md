[English](../../../DESKTOP_RELEASE_NOTES.md) · [fr](DESKTOP_RELEASE_NOTES.md) · [es](../../es/docs/DESKTOP_RELEASE_NOTES.md) · [it](../../it/docs/DESKTOP_RELEASE_NOTES.md) · [pt](../../pt/docs/DESKTOP_RELEASE_NOTES.md) · [de](../../de/docs/DESKTOP_RELEASE_NOTES.md)

# Bureau jaunt 0.1.0-beta.10

Une application de bureau native partageant la même interface utilisateur réactive que le navigateur et le client Android, avec des commandes d'hôte locales. Des périphériques locaux et distants se fixent à la même shells ordinaire sans tmux. Les onglets de bureau prennent en charge des volets séparés persistants et résibilisables; les mises en page mobiles montrent ces sessions sous forme d'onglets séparés.

**Sessions** liste des sessions en cours d'exécution et sorties, ouvre existant shells, ferme seulement une vue, ou met explicitement fin à une shell et ses tâches pour tous les téléspectateurs. Cliquer ou taper sélectionne quel appareil contrôle le partage terminal taille.

L'application utilise l'œuvre d'art originale jaunt, des thèmes dark/light/system/circadian, des noms d'hôte/order/defaults, et des notifications d'OS privées optionnelles. Elle peut démarrer un service d'hôte installé et se connecter à d'autres hôtes. L'installateur officiel offre également `--client-only`, qui installe le client de bureau sans contrôle local d'hôte ou d'hôte local.

Linux: installez le `.deb` ou `.rpm`, ou utilisez `jaunt gui` pour une installation d'archive par utilisateur vérifiée. macOS: ouvrez l'image correspondante de l'archive/disque d'application du CPU, ou utilisez `jaunt gui` depuis un hôte installé. Les constructions de bureau ne sont pas signées sur macOS. Aucun lanceur ne désactive le bac à sable de Chromium.

Le protocole n'a pas reçu d'audit de sécurité indépendant. Voir `docs/WORKSPACE.md` et `docs/WORKSPACE_VALIDATION.md` pour le comportement, les tests observés et les limites de validation restantes.

Cette mise à jour remplace les pictogrammes d'interface avec Lucide, affiche le texte de notification du programme et conserve les cibles de notification par des reconnects. Les paquets Linux contiennent des tailles standard d'icônes-thèmes et des métadonnées de lanceur lisibles. Sur Ubuntu avec des espaces de noms d'utilisateur restreints, l'installateur de l'hôte sélectionne le paquet système pour configurer la prise en charge de sandbox.

Le nouveau shell crée un répertoire terminal automatiquement nommé immédiatement. Le nouveau shell dans le dossier offre une navigation de répertoire et un nom optionnel. L'hôte peut hériter du répertoire courant actif shell. Le bureau dispose de contrôles séparés côte à côte et au-dessus/ci-dessous, d'un choix en ligne de sessions nouvelles ou existantes et d'un bouton pour déplacer chaque volet dans son propre onglet. Mobile conserve les onglets de session ordinaires. La fermeture d'une vue maintient son shell en vie; la terminaison nécessite toujours une confirmation explicite.

L'application de bureau vérifie maintenant les mises à jour automatiquement, télécharge et vérifie la version correspondante, et l'installe lorsque vous fermez l'application. Paramètres offre Vérifiez la mise à jour du bureau, une mise à jour automatique, et Installez et rouvrez quand vous êtes prêt. Les installations système peuvent demander l'autorisation OS. Ceci met à jour l'interface séparément de l'hôte et n'arrête pas l'hôte shells.

Les interruptions de connexion partagent maintenant une bannière d'état persistante. Les résultats de la poignée de main asynchrone tardive ne peuvent pas écraser une connexion de remplacement. Les erreurs de dialogue restent en ligne; les erreurs d'action persistent sans cascades grillées. Les transferts exposent l'attente/annulation/achèvement, l'activité terminée s'effondre dans l'historique accessible, et la disponibilité de mise à jour garde son action visible.

Cette version corrige la disposition des paramètres, l'ordre stable des onglets, le renommage double-clic, la rétroaction de reconnect/mise à jour et l'ancrage mobile du défilement. Elle ajoute une barre latérale effondrée persistante et six langues détectées par le système avec une redéfinition explicite. Le titre de la fenêtre est simplement `jaunt`. Claude et Codex Les séances de premier plan utilisent des icônes de marque Meteor groupées localement.
