# Jaunt — livraison validée le 14 septembre 2026

**Page : https://moukrea.github.io/jaunt/**

**Relais : wss://jaunt-relay.moukrea.workers.dev**

**Release : [v0.1.0-beta.2](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.2)**

```sh
curl -fsSL https://moukrea.github.io/jaunt/install.sh | bash
```

Cette commande a été exécutée dans une VM Ubuntu propre, sans source editable.
L’utilisateur final ne crée aucun compte GitHub/Cloudflare et ne configure ni
serveur public ni VPN. **Le protocole et le produit restent sans audit de sécurité
indépendant.** Les limites de SECURITY.md, notamment l’origine Pages partagée,
restent applicables.

## Historique et publication

L’archive a été intégrée sans lire l’ancien code pour s’en inspirer. Le commit
initial `eb71cfe9b80749d3c53f11e428f027b0d64fb372` est conservé sur
`backup/pre-rewrite-20260914`. Les PR [8](https://github.com/moukrea/jaunt/pull/8)
et [9](https://github.com/moukrea/jaunt/pull/9) ont été fusionnées après les checks
requis, sans contournement des protections, force-push ni suppression d’historique.
La release beta.1 reste immuable ; les corrections hôte sont publiées dans beta.2.

Le propriétaire a accordé OAuth Wrangler dans son navigateur. Le Worker Jaunt,
version `00dd364c-c69c-4e89-8878-00ebd38ca414`, utilise `ROOMS` / `Room`, SQLite,
migration `v1`, APP_ORIGIN `https://moukrea.github.io`. Aucun relais d’un autre
projet n’a été utilisé. Santé HTTP, authentification WebSocket, routage dans les
deux sens, ping/pong et refus d’une origine non autorisée ont été vérifiés.
Le véritable appairage chiffré et le shell ont ensuite été testés publiquement.

[Release beta.2](https://github.com/moukrea/jaunt/actions/runs/34855623613) : trois
assets publics (wheel, host-manifest.json, SHA256SUMS), téléchargés et vérifiés
avant [Pages](https://github.com/moukrea/jaunt/actions/runs/34855764137).
Les variables GitHub JAUNT_RELAY_URL, JAUNT_RELEASE_TAG et JAUNT_PAGE_URL sont
renseignées. Les 25 requêtes de ressources de la page, dont les modules JS,
images, licences jsQR/xterm, installateur et service worker, ont été comparées
aux octets livrés sous `/jaunt/`. Aucun JS runtime ne provient d’un CDN.

Les identifiants OAuth sont stockés chiffrés avec une clé dans le trousseau local.
CLOUDFLARE_ACCOUNT_ID est renseigné dans GitHub ; un futur déploiement du relais
par Actions exige encore son propre CLOUDFLARE_API_TOKEN. Le déploiement observé
a utilisé OAuth local, pas un token GitHub ni un token OAuth copié comme secret
API permanent. Cela ne concerne pas les utilisateurs finaux.

## Commandes et résultats réellement observés

En développement : `python3 -m venv .venv`, puis
`pip install -e . -r requirements-dev.txt pip-audit` et `npm ci`.
L’installation editable de développement est distincte des tests du wheel.

| Commande | Résultat |
|---|---|
| `npm install`, puis `npm ci` | Vrai package-lock.json résolu et committé ; installation reproductible |
| `npm run prepare-web` | 20 ressources, jsQR 1.4.0 et licence Apache copiés localement |
| `pytest -q` | **36 réussis** ; PTY réel, interop Web Crypto, upgrade atomique, envoi interrompu |
| `npm test` | **17 réussis** |
| `npm run test:relay` | **1 intégration réelle workerd/Miniflare réussie**, SQLite et WebSockets |
| `python scripts/check_project.py` | Réussi sans exemption `--source` |
| `python scripts/build_release.py` | Wheel beta.2, manifeste et checksums construits |
| `python -m playwright install chromium` | Chromium effectivement installé |
| `python tests/browser_e2e.py` | **20 scénarios réussis** dans la CI avec le relais Python |
| `JAUNT_E2E_RELAY=workerd python tests/browser_e2e.py` | **20 scénarios réussis**, localement et en CI |
| `python tests/installer_e2e.py` | **8 contrôles réussis** sur beta.2, localement et en CI |
| `JAUNT_INSTALLER_ONLINE=1 python tests/installer_e2e.py` | **8 contrôles réussis** sur beta.1, miroir loopback et dépendances PyPI dans des environnements neufs |
| `npm audit` | **0 vulnérabilité connue** dans le graphe résolu |
| `pip-audit` | **0 vulnérabilité connue** ; package local Jaunt absent de PyPI, donc non couvert |

[CI beta.2](https://github.com/moukrea/jaunt/actions/runs/34855112550) : sept jobs
réussis, dont 36 tests hôte sur Linux/macOS × Python 3.11/3.13 et les deux séries
de 20 scénarios navigateur. Les jobs `lint` et `test` exigés par la protection
exécutent de vrais contrôles ; le second dépend du succès des suites complètes.

Versions locales : Python 3.14.2, Node 25.5.0, npm 11.8.0, pytest 9.1.1,
Playwright 1.62.0, Chromium 151.0.7922.34. CI : Node 22, Python 3.11/3.13.
Hôte : websockets 16.0, cryptography 50.0.1, qrcode 8.2, pywebpush 2.5.0.
Build : setuptools 84.0.0, pip 26.2.1, Wrangler 4.131.2,
Miniflare direct 4.20260730.0 ; Wrangler utilise aussi son Miniflare
5.20260911.1-alpha. Overrides Miniflare : sharp 0.35.4 et undici 7.29.0.

Les avis initiaux de cryptography/pip et Miniflare/sharp/undici ont été traités
par mises à jour épinglées et overrides, puis retestés.
Sources : [cryptography](https://github.com/pyca/cryptography/security/advisories),
[sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c),
[undici](https://github.com/advisories/GHSA-4cwx-7wf7-3272).
La provenance/version exacte du bundle xterm reçu reste limitée comme indiqué
dans THIRD_PARTY_NOTICES.md ; ce bundle n’est pas couvert par npm audit.

## Recette publique sur machine propre

VM QEMU/KVM Ubuntu 24.04, Python 3.12.3, image officielle vérifiée SHA-256 :
`612b2c0cc1bc413a6cb8c38fd611794caf0f2b436c50013d8b3794db12ad7354`.
Aucun code source ni runtime editable n’y a été installé. L’installation publique
beta.1 a produit un QR et un service utilisateur systemd activé ; un vrai reboot
a confirmé son démarrage automatique, la connexion au relais et l’identité
conservée. La mise à jour publique beta.1 → beta.2 a conservé les appareils.

Le script de recette privé a piloté SSH et Chromium contre la page publique.
Il a exécuté la commande d’installation ci-dessus, `jaunt status`, `jaunt pair
--json`, les commandes `systemctl --user` et les interactions UI. Les QR et
sorties privées restent hors du dépôt. Résultats :

- Appairage public et canal authentifié chiffré via Cloudflare.
- Shell arbitraire, `printf`/`cat`, résultat `PUBLIC_JAUNT_PROVED` vérifié dans
  le terminal et dans un fichier ; deuxième onglet puis retour au premier.
- Upload et téléchargement multichunks Unicode/binaire comparés octet par octet.
- Image transférée, chemin cité inséré sans Enter ; absence d’exécution vérifiée
  par un fichier sentinelle. Collage natif désactivé sur cette VM headless.
- Rechargement de la page avec identité mémorisée, sans nouveau QR.
- Vraie coupure réseau sortant de la VM par une règle temporaire limitée à cette
  VM, retirée dans un `finally` : même PID du shell, même session, commande
  `RESUMED` prouvée après reconnexion sans appairage.
- Upgrade public refusé avec deux shells ordinaires actifs : daemon conservé.
- Upgrade avec `JAUNT_ALLOW_RESTART=1` : redémarrage explicite, shells terminés,
  service actif, identités hôte/appareils conservées, navigateur reconnecté.
- Révocation : navigateur déconnecté et création de shell désactivée.
- Aucune exception navigateur non interceptée.

Les onze contrôles sont conservés dans `docs/evidence/public-report.json`.
Les preuves workerd et installateur beta.2 sont dans le même dossier.
`browser-report.json` conserve l’ancien parcours local de 18 scénarios comme
preuve historique ; la CI référencée ci-dessus prouve les 20 scénarios actuels.

## Échecs corrigés sans retirer les fonctionnalités ni les assertions

- Une réponse de listing tardive remplaçait le chemin saisi : brouillon par
  machine et révision de requête, test retardant de vraies réponses chiffrées.
- Des assertions lisaient le terminal avant la livraison asynchrone : attente
  bornée du résultat réel, de l’insertion ou du rattachement terminé.
- Un contrôle Bash séparé de l’arrêt laissait une course avec la création d’un
  shell : arrêt d’upgrade atomique dans le daemon et fermeture de l’admission.
- Les pongs du relais masquaient la perte de l’hôte : contrôle séparé des
  messages authentifiés de l’hôte et reconnexion. Le test suspend le vrai hôte
  tout en laissant le relais fonctionner.
- Une exception WebSocket pendant un envoi terminait la tâche de sortie PTY :
  interruption normalisée en ConnectionError et canal fermé. Deux régressions
  avec PTY réel échouent avec l’ancien transport et passent après correction,
  avec replay et nouvelle sortie sur le même PID.
- Les tests headless héritaient du bureau et des profils personnels : environnement
  graphique retiré et shells de test sans profils, dans des dossiers temporaires.
- Tuer seulement le parent Miniflare laissait workerd connecté : le harness
  interrompt désormais son propre groupe de processus isolé.

## Limites et signalements à ne pas masquer

- Aucun téléphone physique n’a été manipulé par l’agent. L’utilisateur rapporte
  un appairage mobile réussi après oubli d’une entrée mémorisée ; cela ne valide
  pas caméra, clavier/IME, galerie, rotation, Wi-Fi/mobile, PWA suspendue ou push
  écran verrouillé. Il signale aussi un échec de collage de capture Android dans
  Claude Code : ce parcours spécifique reste en investigation.
- Livraison Web Push réelle et collage natif dans Claude/Codex : non validés.
  Un chemin inséré n’est pas une pièce jointe native ; aucun presse-papiers OS
  n’est promis sur un hôte headless.
- launchd, installation macOS/WSL, bootstrap sans Python, Safari/Firefox, tmux
  réel, charge prolongée, quotas/coûts et SLA du relais : non validés.
- Le protocole, l’hôte, le front et le relais n’ont pas d’audit indépendant.

## Artefacts et confidentialité

Les trois assets de chaque release ont été téléchargés, leurs checksums et le
contenu du wheel contrôlés. Gitleaks 8.30.1 n’a trouvé aucune fuite dans les
wheels. Le snapshot initial a produit un seul faux positif examiné :
l’initialisation JavaScript de FourKeyMap/TwoKeyMap dans xterm.
Les contrôles portent sur le projet et ses fixtures, jamais des scans destructifs
des dossiers personnels. Aucun host.json, état de développement, QR, coffre,
secret ou terminal privé n’est publié. Les workflows ont été relus et utilisent
npm ci ; Pages vérifie les trois assets avant déploiement. Le ZIP est produit
par liste autorisée, avec CRC, comparaison des octets et checksums par fichier.
La licence jsQR est conservée intacte, y compris son saut de ligne final.

## Correctifs ergonomiques après retour utilisateur

Le bouton Paste pouvait traiter un texte vide comme un collage réussi. Il ouvre
maintenant une zone de collage riche si l’API ne fournit aucun contenu utile,
accepte les images de FileList/DataTransfer et les PNG incorporés au HTML, sans
insérer de HTML ni télécharger une URL externe. Une image seule est envoyée
automatiquement au presse-papiers hôte puis au Ctrl+V de la session capturée si
le backend natif est disponible. Headless conserve le choix explicite du chemin.
Les erreurs hôte ne sont plus masquées comme des refus du presse-papiers mobile.

Le parcours workerd local passe à **22 scénarios**, dont lecture d’une vraie image
par l’API Clipboard de Chromium et simulation d’un résultat texte vide suivie
d’un collage riche vers un vrai hôte. Ce dernier test simule uniquement l’entrée
presse-papiers : il ne prétend pas avoir manipulé Android.

Une VM Xvfb/X11 séparée a aussi reçu l’image depuis le navigateur, via le Worker
public et le wheel beta.2 installé. Le PNG du presse-papiers xclip est identique
au fichier reçu et le PTY a reçu exactement l’octet `16` (Ctrl+V), sans Enter.
Ce test avant publication utilisait les fichiers UI de la branche injectés dans
Chromium à l’origine de la Page ; voir `native-clipboard-report.json`. Il ne prouve
pas l’affichage d’une pièce jointe dans un véritable Claude Code/Codex.
L’utilisateur rapporte que les deux modes Attach fonctionnent sur son appareil ;
la correction spécifique à Paste reste à confirmer sur son téléphone.

Transfers n’est plus un onglet permanent. Le suivi, l’annulation et les chemins
restent accessibles depuis Files → Transfer activity après un transfert ; les
téléchargements sont enregistrés par le navigateur.

La CI macOS a révélé un autre cas de fermeture : le drapeau alive du reaper
pouvait rester vrai après la sortie effective du processus. La fermeture vérifie
maintenant Popen.poll avant d’envoyer un signal au groupe. EPERM n’est toléré que
si le processus est désormais sorti ; une erreur sur un enfant vivant reste une
erreur. Une régression vérifie qu’aucun signal n’est envoyé à un PID déjà sorti.
Cette correction porte la suite locale à 37 tests et prépare la release beta.3.

## Android client and beta.3 follow-up — 2026-09-14

PR #10 passed every CI job, including 37 Python tests on Linux/macOS and both browser relay backends, then merged as `f85b9cb`. Public host `v0.1.0-beta.3` was published by run `34859426583`; all three public assets, wheel contents and checksums were verified, and the wheel secret scan found no leaks. Pages run `34859891960` succeeded; its beta.3 configuration and changed interface resources were compared with the merged source. The isolated Ubuntu VM upgraded from the public installer with its identity preserved and its user service active.

Android local build observations:

- JDK 17; Gradle 9.5.0 with official distribution SHA-256; AGP 9.3.2; compile SDK 37.0 / target 36 / minimum 26.
- `android/gradlew -p android :app:assembleRelease :app:lintRelease :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug --write-locks --write-verification-metadata sha256 --no-daemon`: successful. Two native protocol unit tests passed (bidirectional encryption, replay/tamper rejection and proof binding). The native channel also authenticated against the actual public Python host, independently of these unit fixtures.
- Android lint: no errors. Remaining warnings concern the deliberately retained target API 36, the compatible Gradle version, JavaScript being enabled for the bundled interface and feature-guard analysis; these are reviewed boundaries, not suppressed assertions. A renderer-loss recovery callback was subsequently added following the WebKit lint warning.
- OSV queried all 21 resolved Android release runtime Maven artifacts: no reported advisories on 2026-09-14. This is database coverage, not a security audit. WebKit was updated to 1.17.0 and the JVM JSON test library to 20260814 after checking available versions.
- `apksigner verify --verbose --print-certs`: signed release APK verifies with APK Signature Scheme v2, RSA 4096, certificate SHA-256 `0c94f35fe68a30eb155c4aa5b9003f633b5b4884f191c54f84bdeeec956348fe`. Local signed APK installation and launch succeeded in the emulator. Release debugging is disabled; the end-to-end automation below used the debug build's WebView debugging, not a production debug endpoint.
- Android 14/API 34 x86_64 emulator: installed APK → public Cloudflare relay → public release-installed beta.3 host → real shell command and output file; native Android text clipboard round-trip; native Java encrypted notification channel; actual Android notification with the app backgrounded and emulator screen off; native Android image clipboard → upload → isolated host X11 clipboard → PTY byte `16` (Ctrl+V), no Enter, PNG bytes equal; rotation and network toggle retain the same shell ID/PID; Android Save dialog writes exact binary fixture bytes.
- Android clipboard fixture is a separate instrumentation APK. It is not in the signed application. All host/clipboard/image tests used synthetic data in the isolated VM/emulator, never the user's desktop clipboard or personal folders.
- After shared-interface integration: `npm test` and actual `npm run test:relay` passed; `python tests/browser_e2e.py` passed all 22 browser scenarios; `python scripts/check_project.py` passed. GitHub CI repeats both browser relay backends before merge.

Evidence: `docs/evidence/android-report.json` and `android-dependency-audit.json`. Physical Android camera scanning, real keyboard/IME behavior, gallery variants, actual Wi-Fi/mobile handoff, deep idle/OEM battery behavior and attachment recognition inside an actual Claude Code/Codex version are not claimed. Screen-off emulator notification delivery is not proof of guaranteed deep-idle push. The protocol and native implementation remain independently unaudited.

A release-specific blank-start observation blocked publication during validation. The native container now keeps an explicit opening/retry screen until the bundled application confirms readiness and requests a redraw. Three consecutive cold starts of the non-debuggable signed release then displayed the workspace. Initial clean-run CI also rejected two missing Gradle metadata checksums; a fresh dependency-cache resolution generated the missing POM/module checksums without disabling verification.

## Automatic updates — implementation validation

The requested host updater adds six failure/safety tests: a downloaded update defers with a real active-session status even when restart authorization is inherited; tampered wheel bytes cannot reach host shutdown; automatic installation strips restart and developer overrides; explicit restart is handled separately; older/invalid release tags are rejected; disabling automatic updates prevents network access. `pytest -q`: **43 passed**. The real installer suite still passes all **8 checks**, including active PTY refusal and explicit restart. Public automatic version-to-version installation and Android's real update installer are tracked separately from these tests and must be recorded after release publication.
