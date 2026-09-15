[English](../../../WORKSPACE.md) · [fr](WORKSPACE.md) · [es](../../es/docs/WORKSPACE.md) · [it](../../it/docs/WORKSPACE.md) · [pt](../../pt/docs/WORKSPACE.md) · [de](../../de/docs/WORKSPACE.md)

# Espace de travail partagé terminal

Chaque shell appartient au démon hôte, et non à la fenêtre qui l'a créé. L'application de bureau, l'application Android et les navigateurs autorisés peuvent en même temps se connecter au même PTY ordinaire. tmux est facultatif. Les terminaux existants créés en dehors de jaunt ne sont pas adoptés rétroactivement; créer un jaunt shell ou joindre explicitement une session tmux existante.

## Sessions et vues

**Le nouveau shell** crée immédiatement un terminal avec un nom automatique, tel que `bash 1`. Son répertoire suit le shell précédemment actif, y compris les modifications de `cd` sur les hôtes supportés. L'icône du dossier s'ouvre **Le nouveau shell dans le dossier**, avec la navigation du répertoire et un nom optionnel. Si le système d'exploitation ne peut pas lire le répertoire actuel de shell, l'hôte utilise le répertoire initial de shell.

Utilisez **Sessions** à côté des onglets pour voir chaque session conservée sur l'hôte sélectionné, y compris les sessions sans vue ouverte. La liste montre si chaque shell est en cours d'exécution et quels appareils l'ont ouvert.

- **Renommer** change le nom de la session partagée. Double-cliquez sur un nom d'onglet ou double-cliquez sur un titre de volet pour le renommer aussi.
- **Open** attache ce périphérique au shell existant et à son historique conservé.
- L'onglet **×** ou **Fermer la vue** ne détache que cette vue. La shell et d'autres clients restent connectés.
- **Terminate** demande confirmation, puis termine le shell et ses travaux pour tous les téléspectateurs. Pour tmux il tue explicitement que la session tmux, y compris les pièces jointes en dehors de jaunt.

La terminaison ordinaire couvre les processus de la session POSIX terminal de shell, y compris les groupes de contrôle de travail de fond. Un processus délibérément démonisé dans une session distincte du système d'exploitation est à l'extérieur de cette limite. La terminaison de session n'est pas un sandbox de processus/container général.

Après avoir quitté shells, conservez leur statut d'attente jusqu'à ce que la session soit retirée, en réservant le leader PID afin que les emplois de fond survivants puissent toujours être résiliés en toute sécurité.

Fermeture de l'application, perte d'une connexion réseau, ou verrouillage de son coffre-fort ne se termine pas shells. Les mises à jour d'hôte compatibles conservent ordinaire shell processus et leur historique à travers un remplacement d'exécution en place. Un arrêt/redémarrage ou redémarrage de démon explicite les termine toujours. shells sont actifs à moins que le redémarrage ne soit explicitement autorisé. tmux reste disponible lorsque la persistance indépendante du redémarrage est nécessaire.

Les onglets conservent leur ordre lors de la sélection. Faites-les glisser pour réorganiser; sur un clavier, utilisez Alt+Shift+Left/Right. Double-cliquez sur les renommer; tenir un onglet n'ouvre pas le renom. Les groupes fractionnés de bureau et l'ordre des onglets mobiles sont conservés à travers les reconnections.

## Dimensions partagées et défilement

Chaque session a une taille PTY. Cliquer/toucher ou taper dans une vue permet à l'appareil de contrôler sa taille. Redimensionner une fenêtre passive ne vole pas la commande. Les vues passives conservent la géométrie partagée et peuvent défiler horizontalement ou verticalement lorsque le terminal de l'autre appareil est plus grand. Cliquez à l'intérieur pour l'adapter à votre écran.

Les terminalL'élément intérieur mesuré n'a pas de rembourrage; les marges d'UI environnantes sont exclues de son nombre de rangées/colonnes. Android Le dernier** bouton retourne à la sortie récente; faire défiler vers le haut reste possible pendant que la sortie continue. **Select** ouvre un contrôle de texte natif pour les poignées de sélection mobile et la copie conservée terminal text. Sélection de la souris de bureau et Ctrl/Commande+Shift+C reste disponible.

xterm 6 prend en charge la sortie synchronisée (mode DEC 2026). Le comportement d'écran alternatif spécifique à l'application s'applique toujours : l'écran alternatif n'est pas un tampon de défilement illimité. terminal programme peut intentionnellement effacer son propre écran ou choisir de désactiver son propre historique. jaunt ne réécrit pas les séquences d'échappement de ce programme en sortie fabriquée.

## Tambours carrelés

Sur le bureau, les deux icônes scindées choisissent le placement côte à côte ou au-dessus/dessous. Leur sélectionneur en ligne offre un nouveau shell ou n'importe quelle session en dehors du groupe scindé actuel. Faites glisser le diviseur, ou concentrez-le et utilisez des touches fléchées. Chaque onglet peut contenir un arbre scindé; sélectionnez un autre onglet préserve les groupes précédents.

Les mises en page, les ratios, les vues ouvertes, l'ordre des hôtes, les noms amis et l'hôte par défaut sont stockés dans le coffre-fort de cet appareil. Ils survivent à la reconnexion et à la réouverture de l'application. Sur mobile, chaque session d'un groupe scindé apparaît comme un onglet ordinaire; le retour à la largeur du bureau restaure l'arrangement scindé.

## Installation de bureau et contrôles de l'hôte

Les hôtes existants peuvent utiliser `jaunt gui` pour installer/ouvrir, ou `jaunt gui --install-only` pour ajouter le lanceur d'application sans ouvrir de fenêtre. Les paquets Linux et les applications macOS sont également fournis dans la version de bureau. L'application s'appelle **jaunt** et utilise l'œuvre d'art fournie.

L'interface de bureau est la même interface groupée que le client Web, avec un groupe de paramètres supplémentaires **Ce groupe de paramètres d'ordinateur** : installer/mettre à jour l'hôte, le démarrer, installer son service de connexion, coupler un autre périphérique et autoriser explicitement une mise à jour/redémarrage. shells sont accessibles par une prise Unix privée sans besoin de connexion relais; les clients distants s'authentifient encore par le relais chiffré.

Linux user-space archives comptent sur le système permettant Chromium user-namespace sandbox. On Ubuntu restreindre ce mécanisme, `jaunt gui` et l'installateur graphique automatiquement sélectionner le `.deb` paquet et demander l'autorisation du système si nécessaire. Le paquet configure son profil AppArmor scoped. `--no-sandbox`. macOS les artefacts de bureau ne sont pas signés; les instructions de confiance OS peuvent s'appliquer. shells Les notifications de bureau nécessitent l'application de bureau pour rester en cours d'exécution.

## Préférences et notifications

Paramètres utilise une icône de vitesse. Dark est la valeur par défaut. Light, System et Circadian sont également disponibles; Circadian utilise la lumière de 07:00 jusqu'à 19:00 dans le fuseau horaire local de l'appareil. Les préférences de police de terminal restent partagées dans les vitres de ce client.

Chaque hôte expose les commutateurs d'événement pour terminal les cloches, les notifications de programme (OSC 9 et OSC 777) et la sortie de session. Ces commutateurs affectent la génération d'événements de cet hôte. Activer la livraison séparément sur chaque client : natif Android les notifications de fond, navigateur Web Push, ou les notifications de bureau OS. `jaunt notify` et `jaunt run -- command` rester disponible pour les notifications explicites et l'achèvement de la commande individuelle. shell ne peut pas déduire de manière fiable la notion de pensée finie de chaque application.

Les notifications omettent la sortie terminal par défaut. Les permissions du navigateur/OS, les politiques force-stop, les batteries, la disponibilité du réseau, et l'hôte étant en ligne affectent la livraison de l'arrière-plan.

Les notifications de programme préservent le texte du message OSC 9 et le titre/corps OSC 777. Cliquer sur une notification native sélectionne son hôte et sa session, y compris après la reconnexion ou le déverrouillage. Android suit les paramètres de confidentialité de l'écran de verrouillage d'OS.

Les pictogrammes d'interface utilisent des icônes de Lucide (licence de l'ISC) épinglées localement. L'œuvre d'art jaunt fournie reste le logo de l'application; les paquets Linux incluent des tailles d'icône standard et Android utilise un enveloppeur de lanceur adaptatif autour de cette œuvre.

## Mises à jour et progrès visibles

Hôte/CLI et les versions de bureau sont séparées. L'hôte vérifie automatiquement et attend l'ordinaire shells et les transferts pour terminer avant le redémarrage. Le bureau vérifie au démarrage et toutes les 15 minutes, vérifie les téléchargements, et installe quand sa fenêtre se ferme. shells; les paquets système peuvent nécessiter une prompte autorisation du système d'exploitation. Android vérifie sa APK et signature de l'identité avant la remise de l'installation à Android.

L'achèvement distingue un chemin inséré sans Enter d'un PNG placé dans le presse-papier hôte avec Ctrl+V envoyé. Il ne promet jamais qu'un CLI spécifique a reconnu une pièce jointe. La mise à jour vérifie le rapport courant, installé, en attente d'une shells active, ou a échoué; les résultats complétés/erreur restent jusqu'à ce qu'ils soient rejetés.

### Icônes du programme de premier plan

Les onglets et les sous-titres du panneau utilisent les icones Meteor Claude et OpenAI groupés localement, tandis que le programme PTY appartenant au premier plan est `claude` ou `codex`. La détection se rafraîchit une fois par seconde et n'envoie que les arguments de la catégorie de programme, jamais les commandes. Le retour à l'icône shell restaure l'icône terminal. Les noms de session acceptés n'affectent pas la détection. Les sessions tmux existantes et les enveloppes non reconnues conservent l'icône terminal.
