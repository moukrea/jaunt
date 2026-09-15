[English](../../../TROUBLESHOOTING.md) · [fr](TROUBLESHOOTING.md) · [es](../../es/docs/TROUBLESHOOTING.md) · [it](../../it/docs/TROUBLESHOOTING.md) · [pt](../../pt/docs/TROUBLESHOOTING.md) · [de](../../de/docs/TROUBLESHOOTING.md)

# Dépannage

Symptôme Diagnostic et action
|---|---|
La page contient toujours `relay:null`. Terminez le déploiement du propriétaire. Ne remplacez pas une URL fictive.
`jaunt` non trouvé après l'installation Ouvrir un nouveau shell ou utiliser `~/.local/bin/jaunt`. Ajouter `~/.local/bin` à PATH si votre configuration shell l'exclut.
| `curl (23)` lors du téléchargement de configuration, curl n'a pu écrire les données reçues. Les étapes d'installation sur le système de fichiers d'exécution au lieu de `/tmp`, ouvre les fichiers de téléchargement dans Bash, et retries boucle les échecs d'écriture à travers Python. L'épuisement réel ou le déni d'écriture sur le système de fichiers d'installation provoque toujours une erreur de stockage. Voir [ validation de l'installateur](INSTALLER_FEDORA.md). |
Consommés ou expirés QR sur un périphérique mémorisé, ouvrez la carte hôte au lieu de réutiliser l'ancien QR code. Pour un nouvel appareil, lancez `jaunt pair`. |
Rechercher `jaunt status`, connexion WSS/443, sommeil/hibernation et `jaunt doctor`. Aucun nouveau code QR n'est nécessaire.
Service utilisateur non disponible `jaunt start` Configurer un véritable service utilisateur pour le démarrage après le redémarrage. Linux, en cours d'exécution lors de la déconnectation dépend également de la durée du système, qui peut nécessiter un administrateur.
Mise à jour refusée PTYs sont actifs. Terminez-les ou utilisez-les explicitement `jaunt_ALLOW_RESTART=1` et d'accepter leur résiliation. tmux est recommandé pour les tâches à long terme.
La caméra est refusée ou manquante. Autoriser l'accès à la caméra sur HTTPS, sélectionner un fichier image QR ou coller le code complet. L'entrée manuelle ne dépend pas de la caméra.
La pâte native nécessite un presse-papier hôte et un outil CLI qui le lit. Voir README; il n'y a pas de pilote universel de fixation sans tête.
Aucun avis de poussée.Vérifiez l'enregistrement dans Paramètres, autorisation du navigateur, une connexion PWA installée si nécessaire, une connexion sortante au service de poussée, et `jaunt notify`. Les notifications ne sont pas générées automatiquement pour chaque application shell.
La limite d'hôte est de 512 MiB; les téléchargements in-memory sont limités à 128 MiB. Utilisez l'écriture directe de fichier si offert par le navigateur. Cette limite permet d'éviter de tuer un onglet mobile.
Il n'y a pas de porte arrière de récupération. Réinitialisez la chambre forte locale, joignez à nouveau, et retirez l'ancienne identité sur l'hôte.
Le démon/OS a redémarré ; un PTY ordinaire était un enfant de ce démon. Utilisez tmux pour survivre aux redémarrages de démon.
L'historique est limité : 2 MiB sur l'hôte, 10 000 lignes sur le client. Rediriger la sortie longue vers un fichier et le télécharger.
Le projet a son propre relais, mais cela ne garantit pas l'immunité contre les quotas ou les abus. Vérifiez les métriques Cloudflare, les nombres de connexions et les limites de salle.

Les journaux hôtes ne doivent pas contenir de secrets. Ne jamais joindre `host.json`, un code QR, une exportation IndexedDB ou un fichier confidentiel à un rapport public. Pour désinstaller, exécutez `jaunt service uninstall`, puis `jaunt stop`, puis supprimez les binaires d'exécution.
