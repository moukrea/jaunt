[English](../../../PUBLIC_DELIVERY.md) · [fr](PUBLIC_DELIVERY.md) · [es](../../es/docs/PUBLIC_DELIVERY.md) · [it](../../it/docs/PUBLIC_DELIVERY.md) · [pt](../../pt/docs/PUBLIC_DELIVERY.md) · [de](../../de/docs/PUBLIC_DELIVERY.md)

# Livraison publique — 15 septembre 2026

Pour les corrections suivantes de l'hôte bêta.9 / bureau bêta.7 / Android bêta.5 et la vérification publique, voir [résultats de régression de livraison](DELIVERY_REGRESSIONS.md). Les observations ci-dessous décrivent la version précédente.

L'application publiée est **https://moukrea.github.io/jaunt/**. Les utilisateurs finaux n'ont pas besoin d'un compte GitHub ou Cloudflare, VPN ou une configuration de serveur entrant.

- Hôte : [v0.1.0-beta.8](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.8), Python version `0.1.0b8`.
- Bureau : [0.1.0-beta.6](https://github.com/moukrea/jaunt/releases/tag/desktop-v0.1.0-beta.6), Linux x64/ARM64 tar/deb/rpm et les paquets macOS x64/ARM64 zip/dmg.
- Android: [signated beta.4 APK](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.4/jaunt-android-v0.1.0-beta.4.apk), [release and checksums](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.4).
- Relais du projet : `wss://jaunt-relay.moukrea.workers.dev`, avec `APP_ORIGIN=https://moukrea.github.io`.

## Installation validée

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

La commande exacte extraite de la page publique a installé `0.1.0b8` dans un nouveau conteneur Fedora 43. Un autre `jaunt gui --install-only` a téléchargé et vérifié l'archive de bureau et a créé son entrée application-menu. L'installateur normal effectue automatiquement cette configuration de bureau lorsqu'il détecte un hôte graphique. `jaunt gui` ouvre l'application de bureau installée; les paquets de distribution Linux sont également disponibles depuis la version de bureau.

Un autre Ubuntu 24.04.5 VM a mis à niveau la roue publique beta.5 non modifiable en beta.8 public, en conservant l'identité de l'hôte et de l'appareil et son service d'utilisateur actif activé. La mise à jour initiale a explicitement sélectionné la nouvelle version publique avant le changement de canal Pages par défaut. La recette d'acceptation publique subséquente a utilisé l'installateur par défaut publié sans remplacement de version.

Mises à jour automatiques de l'hôte conservent ordinaire shells et les transferts. L'autorisation explicite de redémarrage est nécessaire pour détruire actif shells, y compris les emplois de base qui survivent à une sortie shell. Le code final enlève également l'environnement actuel et l'environnement hérité des installations automatiques. Android contrôle des mises à jour et utilise les Android installateur du système; sa confirmation reste nécessaire.

## Contrôles observés

[PR #18]](https://github.com/moukrea/jaunt/pull/18) fusionne après que ses contrôles ont été effectués.](https://github.com/moukrea/jaunt/actions/runs/34950530292), [libération de l'hôte](https://github.com/moukrea/jaunt/actions/runs/34950562658), [Communiqué de bureau](https://github.com/moukrea/jaunt/actions/runs/34948505167), et [Android libération](https://github.com/moukrea/jaunt/actions/runs/34948504993) Passé. Communiqués précédés [Déploiement des pages](https://github.com/moukrea/jaunt/actions/runs/34951111652).

Commande ou environnement réel
|---|---|
`pytest -q`.61 passé; Linux/macOS, Python 3.11 et 3.13.
`npm test`
| `npm run test:relay` Deux vrais Miniflare/Tests d'ouvriers: origine web et native du bureau, routage authentifié et hibernation ping; origine étrangère rejetée
`npm run prepare-web`; `python scripts/check_project.py`.
| `python scripts/build_release.py` Roue, manifeste et SHA256SUMS construits
`python tests/browser_e2e.py`, avec relais de développement et `jaunt_E2E_RELAY=workerd`. 23 scénarios par moteur, avec PTYs réel et transferts.
| `python tests/shared_workspace_e2e.py` sous Xvfb. PTY en Electron/browser; dernière vue active taille il; fermer/réouvrir et la terminaison; tabs fendus persistants et aplatissement mobile
| `python tests/terminal_render_e2e.py` Scroll to latest, final row/column limits, sélection de texte, persistance du thème, sortie synchronisée; réel isolé Claude Code/Codex démarrage local
`python tests/installer_e2e.py`. 8 passé, y compris la manipulation de somme de contrôle, l'importation non-éditable, les identités conservées et le refus de redémarrer implicitement.
Fedora 43/44 CI; `installer_namespace_e2e.py`; `installer_storage_e2e.py`: Installation publique, boucle isolée, stockage temporaire complet et récupération curl-write-error passé
| Android Constructions d'unités de graduation, de linte/debug/liberté `apksigner verify` Décédés; publics APK conserve le certificat de signature établi
`python tests/android_workspace_e2e.py` émulateur Android 14 : relais public réel et shell, ouverture/redimensionnement du clavier réel, limites de la barre système, rotation et notification terminal-BEL avec écran désactivé.
Public APK beta.3 → beta.4, installé avec `adb install -r`. Le même appareil autorisé se reconnecte sans appariement; cette vérification ne revendique pas un flux d'installateur système in-app.
Public Linux `.deb` installé dans la commande Ubuntu VM. Réel shell exécuté; rendeur Seccomp=2 et NoNewPrivs=1, sans redéfinition de sandbox.
`python tests/desktop_remote_e2e.py`; bureau public installé dans VM. Le bureau natif s'authentifie en tant que client distant via le public WSS, exécute une commande éprouvée et met fin à la session.
Deux commandes éprouvées dans un seul PTY partagé; fermer/réouvrir le conserve; la terminaison à distance supprime les deux vues.
L'hôte public installé, shell est sorti avec un travail de fond entêté.Le redémarrage non approuvé a été refusé.
Trois actifs d'accueil, trois actifs Android et les dix paquets de bureau vérifiés à l'aide de somme de contrôle; chemins d'archives, signeur APK et ressources d'icônes d'origine vérifiés.
Page publique Correction de trois balises de publication; 25 ressources vérifiées sous `/jaunt/` contre des octets construits, y compris les JS et licences locales.
Relais public de la santé HTTP 200, réel WebSocket HTTP 101 et ping/pong; l'origine du navigateur étranger est rejetée avec 403
`gitleaks dir` sur la source Git exportée, la roue publique et l'application de bureau extraite.
`npm audit`; `pip-audit --local --skip-editable`. Aucune vulnérabilité connue n'a été signalée dans les environnements de dépendance vérifiés.

Le pilote d'acceptation publique a effectué **12 vérifications** contre le VM installé sur la version : appariement, sortie arbitraire de shell prouvée, éclatement d'entrée de 512 caractères, deuxième onglet et retour, comparaison d'octets de téléchargement/téléchargement, téléchargement d'images plus chemin cité sans Enter sur un hôte sans tête, recharge sans QR, véritable interruption IPv4/IPv6 avec le même shell PID après-vente, refus de mise à niveau implicite, autorisation de conservation des identités de redémarrage, révocation, et aucune erreur de navigateur non détectée. Voir [public-report.json](../../../evidence/public-report.json). Chaque exécution a utilisé un nouveau répertoire de fixation; aucun dossier personnel n'a été scanné ou supprimé.

La révision finale du relais est `698962dd-b16a-49f8-b658-a3c5953b3da9` (Wrangler 4.131.2). Elle ajoute l'origine native exacte `jaunt://app` à côté de l'origine Web configurée. Les deux origines publiques ont été vérifiées avec les mises à jour réelles WebSocket/ping-pong, et les appariements/commandes clients distants ont été vérifiés à partir du paquet de bureau installé inchangé.

Les versions d'outils et les résultats de développement sont dans [WORKSPACE_VALIDATION.md](WORKSPACE_VALIDATION.md). Les fichiers d'interface utilisateur et de paquet livrés utilisent l'œuvre d'art originale. Le candidat hôte bêta.6 a été remplacé avant qu'il ne devienne le canal par défaut; le workflow de publication bêta.7 a été annulé avant la création d'une publication.

## Limites de validation

Le protocole de sécurité personnalisé reste **indépendantement non vérifié**. Les tests automatisés et les scanners de dépendance n'établissent pas de certification de sécurité.

Aucun combiné physique Android n'était disponible. La capture de l'appareil photo QR, les variations galerie/OEM, la navigation par geste physique, le transfert Wi-Fi/mobile, le ralenti profond et la poussée à l'écran verrouillé sur un téléphone réel restent non validés.

L'exécution de bureau macOS et les instructions de confiance, le matériel ARM, la présentation de notification de bureau à travers les environnements, et la livraison de push-provider par navigateur restent des limites de validation spécifiques à la plate-forme. Les constructions de bureau macOS ne sont pas signées. Les archives Linux par utilisateur nécessitent une boîte à sable Chrome de travail; utilisez le paquet de distribution où les espaces de noms d'utilisateur sont restreints.

Les écrans de démarrage réels isolés Claude Code/Codex ont été testés sans authentification ni requêtes de modèle. Les conversations complètes d'agents et toutes les implémentations d'attaches d'images spécifiques à l'agent ne sont pas déclarées comme testées. L'insertion de chemin et de téléchargement d'images reste distincte du clipboard OS natif conditionnel plus Ctrl+V; ni l'envoi automatique de Enter. Un hôte sans tête n'acquiert pas de clipboard OS en connectant un client.

La fermeture d'une vue préserve sa shell. La terminaison explicite met fin à ses tâches de session POSIX; les processus délibérément déémonisés qui créent une session OS séparée sont en dehors de cette limite. La shells ordinaire ne peut pas survivre à un redémarrage ou un redémarrage du démon hôte; la tmux reste facultative pour cette exigence de persistance séparée.
