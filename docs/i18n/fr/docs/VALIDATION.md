[English](../../../VALIDATION.md) · [fr](VALIDATION.md) · [es](../../es/docs/VALIDATION.md) · [it](../../it/docs/VALIDATION.md) · [pt](../../pt/docs/VALIDATION.md) · [de](../../de/docs/VALIDATION.md)

# jaunt — livraison validée le 14 septembre 2026

Livraison actuelle : [contrôles de session, rétroaction du client, tests de diffusion publique et limitations](SESSION_CONTROLS_VALIDATION.md). Hôte antérieur bêta.5 / Android bêta.3 livraison : [rapport de synthèse historique](PUBLIC_DELIVERY.md). Les sections ci-dessous conservent des observations historiques ; les rapports ultérieurs remplacent leurs nombres de tests et leur statut spécifique à la version.

**Page : https://moukrea.github.io/jaunt/**

**Relais: wss://jaunt-relay.moucrea.workers.dev**

**Sortie: [v0.1.0-beta.2](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.2)**

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

La forme précédente de cette commande (`curl -fsSL … | bash`) a été exécutée dans un Ubuntu VM propre sans source modifiable. Voir [corrections bootstrap et Fedora testing](INSTALLER_FEDORA.md) pour la commande courante.Les utilisateurs finaux ne créent pas de compte GitHub/Cloudflare et ne configurent ni serveur public ni VPN. **Le protocole et le produit restent sans audit de sécurité indépendant.** Les limitations SECURITY.md, y compris l'origine des pages partagées, s'appliquent toujours.

## Historique et publication

L'archive a été intégrée sans lire l'ancienne implémentation pour l'inspiration. Le commit original `eb71cfe9b80749d3c53f11e428f027b0d64fb372` est conservé sur `backup/pre-rewrite-20260914`. PRs [8](https://github.com/moukrea/jaunt/pull/8) et [9](https://github.com/moukrea/jaunt/pull/9) ont été fusionnés après les vérifications requises, sans contourner les protections, forcer ou supprimer l'historique. Beta.1 reste immuable; les corrections d'hôte ont été publiées en bêta.2.

Le propriétaire a accordé Wrangler OAuth par l'intermédiaire du navigateur. jaunt Version Worker `00dd364c-c69c-4e89-8878-00ebd38ca414` Utilisations `ROOMS` / `Room`, Migration SQLite `v1`, et APP_ORIGINE `https://moukrea.github.io`. Aucun autre relais de projet n'a été utilisé. HTTP la santé, WebSocket l'authentification, le routage bidirectionnel, le ping/pong et le rejet d'une origine non autorisée ont été vérifiés. shell L'opération a ensuite été testée publiquement.

[Beta.2 release](https://github.com/moukrea/jaunt/actions/runs/34855623613): trois actifs publics (roue, host-manifest.json, SHA256SUMS) téléchargés et vérifiés avant [Pages](https://github.com/moukrea/jaunt/actions/runs/34855764137). GitHub variables jaunt_RELAY_URL, jaunt_RELEASE_TAG et jaunt_PAGE_URL ont été définis. Les 25 demandes de ressources de la page, y compris les modules JS, les images, les licences jsQR/xterm, l'installateur et le travailleur de service, ont été comparés avec des octets livrés sous `/jaunt/`.

CLOUDFLARE_ACCOUNT_ID est défini dans GitHub; un futur déploiement de relais Actions nécessite toujours son propre CLOUDFLARE_API_TOKEN. Le déploiement observé utilisé local OAuth, pas un jeton GitHub ou un jeton OAuth copié en tant que secret permanent de l'API. Cela ne concerne pas les utilisateurs finaux.

## Commandes et résultats observés

Configuration de développement : `python3 -m venv .venv`, puis `pip install -e . -r requirements-dev.txt pip-audit` et `npm ci`. L'installation de développement modifiable est séparée des essais sur roues.

Commande Résultat
|---|---|
`npm install`, puis `npm ci`= Real package-lock.json résolu et engagé; installation reproductible
| `npm run prepare-web` 20 ressources ; jsQR 1.4.0 et licence Apache copiées localement
| `pytest -q` **36 passé**; réel PTY, Web Crypto interopérabilité, upgrade atomique, interrompt send
| `npm test` **17 passé**
| `npm run test:relay` **1 travailleur réeldMiniflare intégration passée**, SQLite et WebSockets |
| `python scripts/check_project.py` Dépassé sans le `--source` Exemption
| `python scripts/build_release.py` Beta.2 roues, manifestes et somme de contrôle construits
| `python -m playwright install chromium` Chrome réellement installé
| `python tests/browser_e2e.py` **20 scénarios passés** en IC avec le Python relais
| `jaunt_E2E_RELAY=workerd python tests/browser_e2e.py` **20 scénarios passés**, locaux et en CI
| `python tests/installer_e2e.py` **8 contrôles effectués** sur la bêta.2, localement et dans le CI
| `jaunt_INSTALLER_ONLINE=1 python tests/installer_e2e.py` **8 contrôles passés** sur beta.1, en utilisant un miroir loopback et des dépendances PyPI dans des environnements frais
`npm audit`. **0 vulnérabilités connues** dans le graphique résolu.
| `pip-audit` **0 vulnérabilités connues**; jaunt l'emballage est absent de PyPI et donc non couvert

[Bêta.2 CI](https://github.com/moukrea/jaunt/actions/runs/34855112550): sept emplois réussis, dont 36 tests d'hôte Linux/macOS × Python 3.11/3.13 et les deux ensembles de 20 scénarios de navigateurs. `lint` et `test` exécuter des contrôles réels; ces derniers dépendent de toutes les suites complètes réussies.

Version locale : Python 3.14.2, Node 25.5.0, npm 11.8.0, pytest 9.1.1, Playwright 1.62.0, Chromium 151.0.7922.34. CI : Node 22, Python 3.11/3.13. Hôte : websockets 16.0, cryptographie 50.0.1, qrcode 8.2, pywebpush 2.5.0. Construction : setuptools 84.0.0, pip 26.2.1, Wrangler 4.131.2, direct Miniflare 4.20260730.0; Wrangler utilise également Miniflare 5.20260911.1-alpha. Miniflare remplace : pointu 0,35.4 et undici 7.19.0.

Crypographie initiale/pip et MiniflareLes avis /sharp/undici ont été traités avec des mises à jour et des dépassements, puis retestés. Sources: [cryptographie](https://github.com/pyca/cryptography/security/advisories), [précis](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [unici](https://github.com/advisories/GHSA-4cwx-7wf7-3272). La provenance/version exacte du paquet xterm fourni reste limitée comme décrit dans THIRD_PARTY_NOTICES.md; npm l'audit ne couvre pas ce groupe.

## Essai d'acceptation publique sur une machine propre

QEMU/KVM Ubuntu 24.04 VM, Python 3.12.3, image officielle vérifiée par SHA-256 `612b2c0cc1bc413a6cb8c38fd611794caf0f2b436c50013d8b3794db12ad7354`. Aucun code source ni temps d'exécution modifiable n'y a été installé. L'installation publique beta.1 a produit un code QR et a activé le service utilisateur système; un véritable redémarrage automatique confirmé, la connectivité relais et l'identité conservée.

Un script d'acceptation privé a conduit SSH et Chrome contre la page publique. Il a exécuté la commande d'installation alors en cours, `jaunt status`, `jaunt pair --json`, `systemctl --user` et les interactions UI. Les codes QR et la sortie privée restent en dehors du dépôt.

- Appariement public et un canal crypté authentifié via Cloudflare.
- shell arbitraire, `printf`/`cat` et `PUBLIC_jaunt_PROVED` vérifiés dans le terminal et un fichier; deuxième onglet et retour au premier.
- Multi-chunk Unicode/binary téléchargements et téléchargements comparés octet pour octet.
- Image transférée et le chemin cité inséré sans Enter; un fichier sentinelle a vérifié que rien n'était exécuté automatiquement. La pâte native a été désactivée sur ce VM sans tête.
- Recharger la page avec l'identité mémorisée et aucun nouveau code QR.
- Interruption réelle du réseau VM par une règle temporaire limitée à cette VM et retirée dans un bloc `finally` : même shell PID et même session, avec une commande `RESUMED` éprouvée après une reconnexion sans appariement.
- Mise à jour publique refusée avec deux shells ordinaire actif; démon conservé.
- Mise à jour avec `jaunt_ALLOW_RESTART=1`: redémarrage explicite, shells terminé, service actif, identités hôtes/appareils conservées, navigateur réconnecté.
- La révocation a déconnecté le navigateur et désactivé la création de shell.
- Pas d'exception de navigateur inconnu.

Les onze vérifications ont été enregistrées dans `docs/evidence/public-report.json`, aux côtés des preuves d'installateurs workerd et beta.2. À ce moment-là, `browser-report.json` a conservé la première série locale de 18 scenarios comme preuve historique; l'IC référencée a prouvé la suite de 20 scenarios. Les fichiers de preuves ont depuis été mis à jour pour la livraison ultérieure décrite dans PUBLIC_DELIVERY.md.

## Défauts corrigés sans enlever les caractéristiques ou les assertions

- Une réponse tardive à la liste des répertoires a dépassé le chemin dactylographié : les brouillons par hôte et la demande de révisions l'ont corrigé ; le test retarde les réponses chiffrées réelles.
- Assertions lire le terminal avant la livraison asynchrone : les attentes limitées vérifient maintenant la sortie réelle, l'insertion ou la pièce jointe complétée.
- Un contrôle Bash séparé de l'arrêt de course avec la création shell : l'arrêt de mise à niveau du démon atomique ferme l'entrée.
- Relay pongs masqued host loss: les messages d'hôte authentifiés sont surveillés séparément et déclenchent la reconnexion. Le test suspend l'hôte réel tout en laissant le relais en marche.
- Une exception WebSocket pendant l'envoi a terminé la tâche de sortie PTY : les envois interrompus deviennent ConnectionError et ferment le canal. Deux régressions réelles-PTY échouent avec l'ancien transport et passent après la correction, y compris le replay et la nouvelle sortie sur le même PID.
- Les tests sans tête ont hérité de l'environnement de bureau et des profils personnels : les variables graphiques sont supprimées et testent shells sans profils dans des répertoires temporaires.
- Tuer uniquement le parent gauche de Miniflare connecté : le harnais interrompt maintenant son propre groupe de processus isolé.

## Limites et rapports qui doivent demeurer visibles

Ces observations décrivent la mise en œuvre initiale de la bêta.2; la validation ultérieure ci-dessous et dans Public_DELIVERY.md enregistre les progrès ultérieurs.

- L'agent n'a pas utilisé de téléphone physique. L'utilisateur a signalé avoir réussi l'appariement mobile après avoir oublié une entrée mémorisée; qui ne valide pas caméra, clavier/IME, galerie, rotation, Wi-Fi/décollage mobile, suspendu PWA, ou la poussée à l'écran verrouillé. L'utilisateur a également signalé une défaillance Android screenshot coller dans Claude Code; ce flux spécifique était encore à l'étude à ce stade.
- La livraison Web Push et la pâte native à l'intérieur de Claude/Codex n'ont pas été validées. Un chemin inséré n'est pas une pièce jointe native; aucun presse-papiers OS n'est promis sur un hôte sans tête.
- lancé, installation macOS/WSL, bootstrap sans Python, Safari/Firefox, réel tmux, charge soutenue, quotas relais/coûts, et SLA n'ont pas été validés lors de cette première exécution.
- Le protocole, l'hôte, la façade et le relais n'ont pas d'audit indépendant.

## Artéfacts et vie privée

Gitleaks 8.30.1 n'a trouvé aucune fuite dans les roues. L'instantané initial a donné lieu à un faux résultat positif : l'initialisation de JavaScript FourKeyMap/TwoKeyMap de xterm. Les vérifications couvrent le projet et ses appareils, jamais des analyses destructrices des répertoires personnels. Aucun host.json, état de développement, code QR, coffre-fort, secret, ou contenu terminal privé est publié. Les flux de travail ont été examinés et utilisent npm ci; Pages vérifie les trois actifs avant le déploiement. Le ZIP est construit à partir d'une liste d'autorisation, avec des vérifications CRC, des comparaisons par octets et des contrôles par fichier. La licence jsQR est préservée intacte, y compris sa nouvelle ligne finale.

## Corrections de la facilité d'utilisation suite à la rétroaction de l'utilisateur

Le collage pourrait traiter le texte vide comme une pâte réussie. Il ouvre maintenant une zone de collage riche lorsque l'API ne fournit pas de contenu utile, accepte les images FileList/DataTransfer et les données PNG intégrées à partir de HTML, et n'insère ni HTML ni ne télécharge les URL externes. Une image unique est automatiquement envoyée au presse-papier hôte, puis Ctrl+V dans la session capturée lorsqu'un moteur natif est disponible.

Le flux de travail local a atteint **22 scénarios**, y compris la lecture d'une image réelle à travers l'API Clipboard de Chrome et la simulation d'un résultat texte vide suivi d'une pâte riche à un hôte réel. Ce dernier simule seulement l'entrée du presse-papiers; il ne revendique pas l'interaction Android.

Un Xvfb/X11 VM séparé a également reçu l'image du navigateur par l'intermédiaire du Worker public et a installé la roue bêta.2. Le xclip PNG correspond exactement au fichier téléchargé, et le PTY n'a reçu que l'octet `16` (Ctrl+V), sans Enter. Ce test de prépublication a injecté les fichiers UI de branche dans Chromium à l'origine de la page; voir `native-clipboard-report.json`. Il ne prouve pas l'affichage de fixation à l'intérieur du Claude Code/Codex réel. L'utilisateur a signalé que les deux modes Attach fonctionnaient sur leur appareil; la confirmation de correction spécifique au paste était toujours attendue sur leur téléphone.

Les transferts ne sont plus un onglet permanent. Le suivi, l'annulation et les chemins restent disponibles sous Fichiers → Activité de transfert après un transfert; le navigateur enregistre les téléchargements.

macOS CI a révélé un autre cas de fermeture: le drapeau vivant de la moissonneuse pourrait rester vrai après la sortie du processus. Fermeture vérifie maintenant Popen.poll avant de signaler le groupe de processus. EPERM est toléré seulement si le processus a depuis quitté; défaillance sur un enfant vivant reste une erreur. Une régression vérifie qu'un PID déjà sorti n'est jamais signalé. Cela a amené la suite locale à 37 tests et beta.3.

## Client Android et suivi bêta.3 — 2026-09-14

PR #10 a réussi tous les emplois d'IC, y compris 37 Python essais sur Linux/macOS et les deux relais de navigateur backends, puis fusionné comme `f85b9cb`. Accueil public `v0.1.0-beta.3` a été publié par `34859426583`; les trois biens publics, le contenu des roues et les comptes de contrôle ont été vérifiés, et le scan secret des roues n'a trouvé aucune fuite. `34859891960` a réussi; sa configuration beta.3 et ses ressources d'interface modifiées ont été comparées à la source fusionnée. Ubuntu VM mis à jour de l'installateur public avec son identité préservée et son service d'utilisateur actif.

Observations de construction locale de Android :

- JDK 17; Gradle 9.5.0 avec distribution officielle SHA-256; AGP 9.3.2; compiler SDK 37.0 / cible 36 / minimum 26.
- `android/gradlew -p android :app:assembleRelease :app:lintRelease :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug --write-locks --write-verification-metadata sha256 --no-daemon` : succès. Deux tests d'unité de protocole natif ont été passés (cryptage bidirectionnel, replay/tamper rejet et reliure de preuve). Le canal natif s'est également authentifié contre l'hôte public réel Python, indépendamment de ces appareils.
- Android lint: pas d'erreur. Les autres avertissements concernent l'API 36 de la cible délibérément conservée, la version Gradle compatible, JavaScript étant activée pour l'interface groupée et l'analyse de la fonction-garde; ceux-ci sont des limites revues, et non des assertions supprimées.
- OSV a demandé toutes les 21 solutions Android release runtime Maven artefacts: no reported adverties on 2026-09-14. Il s'agit d'une couverture de base de données, pas d'un audit de sécurité. WebKit a été mis à jour à 1.17.0 et la bibliothèque de test JVM JSON à 20260814 après avoir vérifié les versions disponibles.
- `apksigner verify --verbose --print-certs`: la version signée APK vérifie avec APK Signature Scheme v2, RSA 4096, certificat SHA-256 `0c94f35fe68a30eb155c4aa5b9003f633b5b4884f191c54f84bdeeec956348fe`. L'installation et le lancement de APK signés localement ont réussi dans l'émulateur. Le débogage de la version est désactivé; l'automatisation de bout en bout ci-dessous a utilisé le débogage de la construction de débogage WebView, et non un paramètre de débogage de production.
- Android 14/API 34 x86_64 émulateur: installé APK → public relais Cloudflare → public version-installé beta.3 host → réel fichier de commande et sortie shell; natif Android clipboard texte tour-trip; natif Java crypted notification canal; réel Android notification avec l'écran d'arrière-plan de l'application et émulateur hors; natif Android clipboard image → téléchargement → isolé X11 clipboard → PTY octet `16` (Ctrl+V), aucun Enter, PNG octets égal; rotation et bascule réseau conservent le même shell ID/PID; Android Enregistrer la boîte de dialogue écrit des octets binaires exacts.
- Android est un appareil d'instrumentation séparé APK. Il n'est pas dans l'application signée. Tous les tests d'hôte/clipboard/image utilisé des données synthétiques dans le VM/émulateur isolé, jamais le presse-papiers de l'utilisateur ou les dossiers personnels.
- Après l'intégration d'interface partagée: `npm test` et `npm run test:relay` passé; `python tests/browser_e2e.py` passé les 22 scénarios de navigateur; `python scripts/check_project.py` passé. GitHub CI répète les deux relais de navigateur avant de fusionner.

Preuves: `docs/evidence/android-report.json` et `android-dependency-audit.json`. Physical Android scanning camera, real keyboard/IME behavior, gallery variants, real Wi-Fi/mobile handoff, deep fleep/OEM batty behavior and attachement reconnaissance inside an real Claude Code/Codex version ne sont pas revendiqués. La livraison de notification d'émulateur Screen-off n'est pas la preuve d'une poussée garantie en profondeur. Le protocole et l'implémentation native restent indépendants non audités.

Le conteneur natif conserve maintenant un écran d'ouverture/réessayer explicite jusqu'à ce que l'application groupée confirme l'état de préparation et demande un redraw. Trois démarrages consécutifs à froid de la version signée non débogable ont ensuite affiché l'espace de travail. L'IC initial propre a également rejeté deux contrôles de métadonnées Gradle manquants; une nouvelle résolution de dépendance-cache a généré les contrôles POM/module manquants sans désactiver la vérification.

## Mises à jour automatiques — validation de la mise en œuvre

La mise à jour de l'hôte demandée ajoute six tests de défaillance/sécurité : une mise à jour téléchargée se reporte avec un état de session active réel même lorsque l'autorisation de redémarrage est héritée ; les octets de roue altérés ne peuvent pas atteindre l'arrêt de l'hôte ; le redémarrage automatique des bandes d'installation et les remplacements du développeur ; le redémarrage explicite est géré séparément ; les étiquettes de libération anciennes/invalides sont rejetées ; la désactivation des mises à jour automatiques empêche l'accès au réseau. `pytest -q`: **43 passé**. La vraie suite d'installateurs passe toujours tous **8 contrôles**, y compris actif PTY refus et redémarrage explicite. Installation publique automatique de version à version et AndroidL'installateur de mise à jour réelle est suivi séparément de ces tests et doit être enregistré après publication.

Le détecteur de documents/gallery signé (non débogable) APK a été jumelé avec succès par le biais de Android à l'aide d'une image QR, contre l'hôte public bêta.3 et le relais Cloudflare. La boîte de dialogue de l'autorisation de la caméra réelle de Android et le lancement du scanner ZXing natif ont également été exercés; une caméra physique réelle décodage d'un QR n'est toujours pas revendiquée. Le APK contourne délibérément l'ancien BarcodeDetector de WebView pour la galerie QR décodage: cette API s'est écrasée dans l'émulateur lorsque Google Play Services était absent; jsQR décodé la même appariage avec succès.

Un téléchargement temporaire réel reste enregistrable après un redémarrage refusé et se termine avec des octets identiques avant l'arrêt. La suite Python complète maintenant les rapports **45 passés**. La découverte de la publication Android utilise le canal Page public vérifié au lieu d'exiger que chaque appareil consomme le quota API GitHub. Native JVM tests: **3 passés**. La APK signée a également exécuté une commande via son entrée Compose/keyboard Android; le fichier hôte résultant contenait les octets exacts attendus.

## Sortie d'espace de travail partagé

Voir [validation de l'espace de travail](WORKSPACE_VALIDATION.md) pour le bureau/session partagée, géométrie terminal, insets Android et modifications de notification. Les observations bêta antérieures ci-dessus restent historiques et n'impliquent pas que chaque nouvelle combinaison de plate-forme ait été testée.

## Régression ultérieure de la livraison

Voir [delivery regression fixations](DELIVERY_REGRESSIONS.md) pour l'environnement shell déclaré par l'utilisateur, le démarrage Ubuntu, le lanceur/icône, le défilement Android et les défauts de notification découverts après la livraison précédente.
