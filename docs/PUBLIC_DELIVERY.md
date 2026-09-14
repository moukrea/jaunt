# Livraison publique — 15 septembre 2026

- Application : https://moukrea.github.io/jaunt/
- Hôte : [v0.1.0-beta.5](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.5).
- Android : [APK signé 0.1.0-beta.3](https://github.com/moukrea/jaunt/releases/download/android-v0.1.0-beta.3/jaunt-android-v0.1.0-beta.3.apk), [release et checksums](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.3).
- Relais propriétaire déployé : `wss://jaunt-relay.moukrea.workers.dev`, `APP_ORIGIN=https://moukrea.github.io`.

```sh
curl -fsSL https://moukrea.github.io/jaunt/install.sh | bash
```

Cette commande a été utilisée depuis la Page publique dans une VM Ubuntu 24.04 isolée. Le wheel est installé dans un environnement privé, sans source editable ; son checksum est vérifié et le service utilisateur est activé. Le poste utilisateur a également reçu beta.4 depuis la release publique, sans fermeture de shell actif, avec conservation de ses identités et activation effective du service. Son contrôle périodique a ensuite installé beta.5 automatiquement, sans déclenchement manuel ; version 0.1.0b5 et service actif vérifiés.

L’APK embarque l’interface WebView et utilise des intégrations Android natives pour la caméra, le presse-papiers, les fichiers et les notifications. Il ne nécessite aucun compte Cloudflare/GitHub pour se connecter. Il conserve une confirmation Android pour installer une mise à jour.

## Contrôles exécutés

La [CI de la release](https://github.com/moukrea/jaunt/actions/runs/34904297741) et le [build Android](https://github.com/moukrea/jaunt/actions/runs/34904297775) ont réussi avant fusion de la PR #13. Les releases ont été publiées avant Pages : [hôte](https://github.com/moukrea/jaunt/actions/runs/34902465073), [APK signé](https://github.com/moukrea/jaunt/actions/runs/34904737541), puis [Pages](https://github.com/moukrea/jaunt/actions/runs/34905023100).

| Commande / contrôle | Résultat observé |
|---|---|
| `pytest -q` | 45 tests, Linux/macOS, Python 3.11 et 3.13 |
| `npm test` | 19 tests Node |
| `npm run test:relay` | 1 intégration réelle Miniflare/workerd, Durable Object et WebSockets |
| `python scripts/check_project.py` | Imports, ressources et syntaxe valides |
| `python scripts/build_release.py` | Wheel, manifeste et SHA256SUMS produits |
| `python tests/browser_e2e.py` | 23 scénarios par backend : relais Python puis vrai Worker local |
| `python tests/installer_e2e.py` | 8 contrôles, dont checksum altéré, véritable PTY, refus de restart implicite et upgrade autorisé |
| `android/gradlew -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest` | 3 tests JVM, lint et builds réussis |
| `:app:assembleRelease :app:lintRelease`, `apksigner verify --verbose --print-certs` | APK public signé, non debuggable, signature vérifiée |
| Téléchargement des releases publiques | Les trois assets hôte et les trois assets Android vérifiés ; checksums, nom/version et certificat conformes |
| Page publiée | Configuration hôte/APK correcte, 26 ressources sous `/jaunt/` comparées aux fichiers construits ; lien APK visible en viewport mobile, aucune exception JS observée |
| Relais public | `/health` 200 avec curl, authentification et routage bidirectionnel sur de vraies WebSockets ; origine étrangère refusée 403 |

Versions locales observées : Python 3.14.2, Node 25.5.0, npm 11.8.0 ; Python de la VM publique 3.12.3. Android : JDK 17, Gradle 9.5.0, AGP 9.3.2, SDK compile 37.0 / target 36 / minimum 26 ; émulateur Android 14/API 34, WebView 113.0.5672.136. CI Node 22. Dépendances épinglées et verrous générés par les outils réels.

`npm audit` : aucun avis connu. `pip-audit --local --skip-editable` : aucun avis connu. OSV : 21 dépendances Maven runtime résolues, aucun avis connu au contrôle. Ces résultats dépendent de la couverture des bases et ne constituent pas un audit de sécurité.

## Recette finale des fichiers publiés

La recette finale a utilisé la Page et les releases publiques sans substitution de module : **12 contrôles réussis**. Appairage, shell et commande prouvée, saisie rapide de 512 caractères, second onglet et retour au premier, upload/download avec comparaison des octets, image + chemin sans Enter sur hôte headless, rechargement sans QR, véritable coupure IPv4/IPv6 puis même PID de shell, refus d’upgrade implicite, upgrade explicitement autorisé avec identités conservées, révocation et absence d’exception navigateur. Voir [public-report.json](evidence/public-report.json).

## Mises à jour réellement installées

Sur les installations publiques beta.4 du poste utilisateur et de la VM, le contrôle automatique initial s’est déclenché seul. Pour ne pas attendre chaque intervalle de quinze minutes pendant la recette, le processus exact installé `python -m jaunt.updates --automatic` a ensuite été déclenché manuellement dans la VM :

1. Téléchargement du wheel public beta.5 et comparaison avec son manifeste public.
2. Avec un shell ordinaire actif : report de l’installation, même PID hôte, même PID de shell et mêmes clés. Une variable héritée `JAUNT_ALLOW_RESTART=1` n’a pas autorisé l’auto-update à tuer le shell.
3. Fermeture du shell par la confirmation explicite de l’UI, puis nouvelle exécution du processus automatique : installation de beta.5, service actif et activé, import depuis `site-packages`, identités hôte/appareils inchangées.

L’APK public beta.1 a détecté beta.2 depuis le canal public, téléchargé les assets, vérifié le checksum et le certificat existant, puis ouvert les réglages Android « Allow from this source » et le véritable installateur système. Après confirmation et ouverture, `versionCode=2`, mode non debuggable, même appairage et même PID de shell ; une commande a créé le fichier attendu sur l’hôte. Aucun `adb install` n’a remplacé ce parcours de mise à jour. Le contrôle de découverte a été demandé via Settings ; aucune attente réelle de six heures n’est revendiquée. Après l’upgrade automatique de l’hôte, l’APK a également reconnecté sans QR.

Le même parcours a ensuite installé l’APK public beta.3 depuis beta.2. VersionCode 3, mode non debuggable, appairage conservé et nouvelle commande shell vérifiée après installation. L’APK téléchargé contient exactement le module de régulation d’entrée revu.

Preuves synthétiques : [update-report.json](evidence/update-report.json).

## Android et images

Le premier APK signé public a exécuté une commande shell vérifiée sur la VM. Un PNG synthétique du presse-papiers Android a été transféré jusque dans le presse-papiers X11 de l’hôte : comparaison exacte des octets, et lecture PTY égale à `16` (Ctrl+V), sans Enter. Le même shell est resté vivant. L’APK public a aussi reçu une notification native avec l’écran de l’émulateur éteint.

Les essais Android précédents comprennent le dialogue système Save avec comparaison binaire, rotation et coupure/rétablissement réseau avec même session, trois démarrages à froid du build signé, appairage par QR choisi dans la galerie, demande de permission caméra et lancement du scanner. Les tests de clipboard utilisent une instrumentation séparée, absente de l’APK public. Le presse-papiers et les dossiers personnels de l’utilisateur n’ont pas servi aux essais.

Un premier tap de recette a rencontré l’aperçu presse-papiers d’Android superposé à l’application ; après sa disparition, le vrai bouton Paste a été exercé et les octets vérifiés. Le contrôle après ouverture de l’APK attend le retour de l’état Encrypted, au lieu de supposer un démarrage instantané. Une sonde urllib avec son User-Agent par défaut a reçu 403 ; la même sonde avec un User-Agent Jaunt et curl ont reçu 200, et les WebSockets réelles ont réussi. La première coupure réseau de la dernière recette ne bloquait qu’IPv4, alors que le socket de la VM utilisait IPv6 (confirmé avec `ss`). Le test a été corrigé pour interrompre les deux familles, avec restauration des règles dans un bloc finally. Aucun contrôle fonctionnel n’a été supprimé pour obtenir un résultat vert.

## Correction de saisie rapide

La recette publique a aussi révélé une entrée partiellement reçue pendant une rafale de petites trames. La file par client de l’hôte est bornée à 64 messages ; le client web ne régulait pas ces rafales. La fermeture observée venait de l’hôte, et les commandes suivantes restaient exécutables après reconnexion. La régulation d’envoi du client suit maintenant celle du transport hôte ; une génération de canal différente annule toujours les entrées en attente. Deux tests de régression échouaient avant cette correction (débordement de file et changement de canal pendant la rafale), puis ont réussi. Le navigateur exerce également une saisie rapide de 512 caractères avec comparaison exacte du fichier produit.

## Limites conservées

- Aucun téléphone physique n’a été utilisé par l’agent. Caméra réelle, IME/claviers constructeurs, variantes de galerie, rotation physique et passage réel Wi-Fi/mobile restent à confirmer sur appareil.
- Une notification sur émulateur écran éteint ne prouve pas la livraison en Doze profond, après force-stop ou sous restrictions de batterie constructeur. Aucune garantie de push instantané.
- Les octets de clipboard et Ctrl+V sont prouvés ; la reconnaissance visuelle d’un attachment par une version réelle de Claude Code/Codex n’a pas été validée par l’agent. Upload + chemin reste distinct, sans Enter. Sur headless, aucun presse-papiers graphique inexistant n’est promis.
- Le protocole personnalisé et le client Android restent **sans audit de sécurité indépendant**.

## Historique et archive

L’ancien état est conservé sur la branche `backup/pre-rewrite-20260914` (`eb71cfe9b80749d3c53f11e428f027b0d64fb372`). Les changements ont été intégrés par branches et PR, sans force-push ni suppression d’historique. Le dossier `release/` contient les trois assets hôte téléchargés de la release publique ; l’APK reste un asset de release séparé. Les workflows de publication et les contenus des archives ont été inspectés.

L’archive source contient 132 fichiers, chacun couvert par CHECKSUMS.sha256 ; le ZIP a passé la vérification CRC et la relecture complète. Le scan du snapshot extrait ne signale qu’un faux positif revu dans xterm (`FourKeyMap`/`TwoKeyMap`). Aucun état hôte, QR, export de coffre, clé de signature ou log privé n’est inclus. Les wheels publics ont également passé le scan sans détection.
