# Correctif de lancement de l’installateur — 15 septembre 2026

Le signalement utilisateur concerne Fedora : la commande reste silencieuse et le binaire reste en beta.2. La cause exacte sur cette machine n’est pas établie ; aucun accès distant à cette machine ni diagnostic supplémentaire demandé.

## Défauts reproduits et corrections

- L’ancienne commande `curl -fsSL … | bash` retourne 0 lorsque curl échoue et Bash reçoit une entrée vide. La commande officielle utilise maintenant Bash avec `pipefail`, une progression visible, un délai de connexion de 10 secondes et une durée maximale de 120 secondes pour télécharger le script.
- Une configuration `.curlrc` avec une sortie fichier absorbe le script : rien n’est exécuté. Reproduit avec le vrai curl et un serveur HTTP local. L’option `-q` en première position ignore cette configuration dans la commande officielle ; les téléchargements internes utilisent `--disable`.
- Le script annonce immédiatement son démarrage puis chaque téléchargement. Les erreurs inattendues indiquent l’étape, la ligne et le code de sortie, sans afficher de secrets ni de commande complète.
- Les téléchargements HTTPS internes sont bornés à 120 secondes par tentative. Les erreurs de connexion/transfert sélectionnées déclenchent une seconde tentative IPv4 visible ; les erreurs HTTP et de certificat ne sont pas contournées. Les redirections HTTPS restent obligatoires.
- Les gardes sur les shells actifs, la vérification du wheel et la conservation de l’identité restent en place.

## Observations

- `pytest -q tests/test_installer_bootstrap.py` : 4 échecs avec les fichiers précédents, puis 4 succès avec le correctif. Les cas portent sur l’échec réseau, l’échec HTTP, le code de sortie du pipeline et le détournement du flux par `.curlrc`.
- `pytest -q` : 49 tests réussis localement (Python 3.14.2).
- `python scripts/build_release.py`, `npm run prepare-web`, `python scripts/check_project.py` : réussis.
- `python tests/installer_e2e.py` : 8 contrôles réussis, dont checksum altéré, refus de tuer un vrai shell actif et restart explicitement autorisé.
- Fedora 44, conteneur officiel neuf, ancien script public exécuté par `curl … | bash` : installation beta.5 réussie. Le problème utilisateur n’est donc pas reproduit par le seul choix de Fedora.
- Fedora 44, conteneur officiel neuf, script corrigé transmis à Bash par un pipe : installation réelle du wheel public beta.5 réussie, Python privé 3.12.14 installé par uv ; code de sortie 0 et version 0.1.0b5.
- Fedora 43, conteneur officiel neuf : ancien installateur et wheel public beta.2, puis script corrigé et wheel public beta.5 ; version vérifiée avant/après, identité et table des appareils identiques après upgrade.
- La CI ajoute les installations réelles sur Fedora 43 et 44 au job requis `test`.

Les essais Fedora utilisent des conteneurs isolés sans gestionnaire de service utilisateur (`JAUNT_NO_SERVICE=1`) et sans afficher de QR (`JAUNT_SKIP_PAIR=1`). Ils valident l’installation et le démarrage en arrière-plan, pas systemd/SELinux sur un poste Fedora physique. Le service utilisateur avait été validé sur Ubuntu ; aucune nouvelle validation Fedora physique n’est revendiquée.

Ce correctif concerne le point d’entrée Pages et le script source. Les assets publiés beta.5 restent immuables, ainsi que l’APK beta.3 ; aucun nouveau numéro de version hôte n’est nécessaire pour utiliser le nouvel installateur Pages. La copie embarquée dans le wheel beta.5 conserve son ancien code jusqu’à une prochaine release hôte.

Le protocole demeure sans audit de sécurité indépendant.
