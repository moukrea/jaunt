[English](../../../RELEASE_NOTES.md) · [fr](RELEASE_NOTES.md) · [es](../../es/docs/RELEASE_NOTES.md) · [it](../../it/docs/RELEASE_NOTES.md) · [pt](../../pt/docs/RELEASE_NOTES.md) · [de](../../de/docs/RELEASE_NOTES.md)

# jaunt 0,1,0-bêta.11

Les mises à jour d'hôte compatibles remplacent désormais le temps d'exécution tout en préservant les processus shell ordinaires, leurs répertoires de travail, leur environnement et l'historique terminal. Les clients se reconnectent automatiquement. Les hôtes plus âgés ont besoin d'une migration protégée : leur shells actif ne peut pas être conservé rétroactivement, et l'installateur nécessite toujours une autorisation explicite avant de les terminer.

L'espace de travail partagé corrige les étiquettes de paramètres pressés, les positions des onglets instables, les sauts d'historique mobile et les messages d'erreur surdimensionnés. Codex les programmes de premier plan utilisent des icônes de marque Meteor groupées localement dans les onglets et les sous-titres du volet. terminal icône.

Web, bureau, Android et CLI système de détection de la langue et des préférences explicites en anglais, français, espagnol, italien, portugais et allemand. L'anglais reste la documentation du dépôt canonique, avec des copies traduites liées. La page d'accueil web introduit le projet et fournit des commandes d'installation copiables; les applications natives ouvrent directement l'espace de travail.

L'installateur offre `--client-only` pour un client de bureau sans installer d'hôte local ni exposer les commandes de l'hôte local. Les opérations de mise à jour et de transfert conservent les progrès visibles et les résultats finaux. Les fenêtres de bureau sont intitulées `jaunt`; l'application Web installée s'appelle `jaunt (PWA)`.

Le protocole n'a pas fait l'objet d'un audit de sécurité indépendant. La validation du téléphone physique n'est pas revendiquée. Voir [le rapport de validation](SEAMLESS_WORKSPACE_VALIDATION.md) pour les tests observés et les limites restantes de la plate-forme.
