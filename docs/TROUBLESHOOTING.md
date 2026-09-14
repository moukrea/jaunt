# Dépannage

| Symptôme | Diagnostic et action |
|---|---|
| « Relay has not been deployed » | La Page contient encore `relay:null`. Exécuter le déploiement propriétaire. Ne pas remplacer par une URL fictive. |
| `jaunt` introuvable après installation | Ouvrir un nouveau shell ou utiliser `~/.local/bin/jaunt`. Ajouter `~/.local/bin` au PATH si votre configuration de shell l'exclut. |
| QR consommé/expiré | Sur un appareil déjà mémorisé, ouvrir sa carte, pas le vieux QR. Pour un nouvel appareil : `jaunt pair`. |
| Machine offline | Vérifier `jaunt status`, réseau sortant WSS/443, veille/hibernation et `jaunt doctor`. Aucun nouveau QR nécessaire. |
| Service utilisateur indisponible | `jaunt start` fonctionne en arrière-plan. Pour un démarrage après reboot, configurer un vrai service utilisateur ; sur Linux, le maintien hors connexion dépend aussi de systemd linger, qui peut exiger un administrateur. |
| Mise à jour refusée | Des PTYs ordinaires sont actives. Les terminer ou utiliser explicitement `JAUNT_ALLOW_RESTART=1` en acceptant leur arrêt. tmux est recommandé pour les tâches durables. |
| Caméra refusée ou absente | Autoriser la caméra sur HTTPS, sélectionner un fichier QR, ou coller le code intégral. La saisie manuelle ne dépend pas de la caméra. |
| Image pas ajoutée comme attachment agent | Upload+chemin fonctionne sans bureau graphique. Le collage natif exige un presse-papiers hôte et un outil CLI qui lit ce presse-papiers. Voir README : aucun driver universel de pièces jointes headless. |
| Pas de push | Vérifier inscription dans les réglages, permission navigateur, PWA installée si requise, sortie réseau vers le service push, `jaunt notify`. Les notifications ne sont pas créées automatiquement pour toutes les applications shell. |
| Fichier volumineux refusé | Limite hôte 512 Mio ; 128 Mio pour un téléchargement en RAM ; utiliser l'écriture directe si le navigateur la propose. Le plafond est volontaire pour éviter de tuer un onglet mobile. |
| Le PIN est perdu | Pas de backdoor de récupération. Réinitialiser le coffre local, réappairer et révoquer l'ancienne identité sur l'hôte. |
| Reconnexion mais tâche disparue | Le daemon/OS a redémarré : la PTY ordinaire était un processus de ce daemon. Utiliser tmux pour survivre au redémarrage du daemon. |
| Texte tronqué à la copie | L'historique est borné (2 Mio host, 10 000 lignes client). Rediriger les sorties longues dans un fichier puis le télécharger. |
| 429 du relais | Le projet possède son propre relais, mais ce n'est pas une garantie contre tout quota/abus. Regarder métriques Cloudflare, nombre de connexions et limites de salle. |

Les logs hôte ne doivent pas contenir de secrets. Ne jamais joindre `host.json`, un QR, l'export IndexedDB ni un fichier confidentiel à un rapport public. Pour désinstaller : `jaunt service uninstall`, `jaunt stop`, puis supprimer les binaires runtime. Ne supprimer le dossier d'état qu'après sauvegarde/révocation voulue : il contient identités et pièces jointes.
