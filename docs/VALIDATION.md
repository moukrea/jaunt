# Jaunt — validation de l’intégration du 14 septembre 2026

La réécriture de l’archive a été intégrée sans lire l’ancien code. L’état distant
initial est conservé sur `backup/pre-rewrite-20260914`; le travail est sur
`rewrite/archive-beta-1`. Aucun force-push ni suppression de l’historique.

**Déploiement bloqué : aucune autorisation Cloudflare disponible.**
`wrangler whoami` indique « You are not authenticated » ; les secrets Actions
`CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` sont absents au moment du contrôle.
Aucun nouveau relais, tag/release ou site public n’est annoncé comme publié.
Le propriétaire a été invité à fournir uniquement cette autorisation via les
secrets GitHub Actions. Un token GitHub n’accorde pas de permission Cloudflare.

## Exécutions réellement observées

Les commandes Python ci-dessous utilisent l’environnement `.venv` créé avec
`python3 -m venv .venv`, puis `pip install -e . -r requirements-dev.txt pip-audit`.
La présence d’un environnement editable concerne le développement seulement ;
le test installateur vérifie séparément la provenance du wheel installé.

| Commande | Résultat observé |
|---|---|
| `npm install`, puis `npm ci` | Lockfile réel résolu ; installation reproductible depuis ce lockfile |
| `npm run prepare-web` | 20 ressources web ; jsQR 1.4.0 et licence Apache-2.0 copiés localement |
| `pytest -q` | **34 tests réussis**, dont PTY réel, Python ↔ Web Crypto et arrêt d’upgrade atomique |
| `npm test` | **17 tests réussis** (relais déterministe + JavaScript) |
| `npm run test:relay` | **1 intégration réussie dans workerd/Miniflare réel** : upgrade WS, Durable Object SQLite, authentification, routage bidirectionnel, auto-pong |
| `python scripts/check_project.py` | Réussi, sans exemption `--source` |
| `python scripts/build_release.py` | Wheel, manifeste et SHA256SUMS construits |
| `python -m playwright install chromium` | Chromium de test réellement téléchargé |
| `python tests/browser_e2e.py` | **18 scénarios réussis**, relais Python de référence, site servi sous `/jaunt/` |
| `JAUNT_E2E_RELAY=workerd python tests/browser_e2e.py` | **19 scénarios réussis**, navigateur → Worker/workerd réel → hôte → PTY/fichiers |
| `python tests/installer_e2e.py` | **8 contrôles réussis** en mode miroir offline |
| `JAUNT_INSTALLER_ONLINE=1 python tests/installer_e2e.py` | **8 contrôles réussis**, miroir de release loopback, dépendances PyPI installées dans des environnements privés neufs |
| `npm audit` | **0 vulnérabilité connue** dans le graphe résolu |
| `pip-audit` | **0 vulnérabilité connue** ; `jaunt-host` local absent de PyPI, donc non auditable par cette base |

Preuves synthétiques : `docs/evidence/browser-report.json` , `docs/evidence/browser-worker-report.json` et
`docs/evidence/installer-report.json`. Les captures contiennent uniquement des
terminaux et fichiers de test. Aucun QR ni secret d’appairage n’y est conservé.

## Versions et corrections

Environnement local : Linux x86_64, Python **3.14.2**, Node **25.5.0**, npm **11.8.0**,
Playwright **1.62.0**, Chromium **151.0.7922.34**, pytest **9.1.1**.
Hôte : websockets **16.0**, cryptography **50.0.1**, qrcode **8.2**, pywebpush **2.5.0**.
Build : setuptools **84.0.0**, pip **26.2.1**, Wrangler **4.131.2**,
Miniflare direct **4.20260730.0**. Wrangler embarque aussi son propre Miniflare
**5.20260911.1-alpha** ; les tests directs utilisent la version 4 épinglée.
La CI cible Node 22 et Python 3.11/3.13, sur Linux/macOS pour les tests hôte.

L’audit initial signalait cryptography 46.0.4 et pip 25.3 côté Python,
et trois paquets npm de gravité haute (Miniflare, sharp, undici).
cryptography et pywebpush ont été mis à jour et épinglés. L’installateur normal
met désormais pip à jour vers la version contrôlée avant les dépendances.
Les dépendances de Miniflare sharp **0.35.4** et undici **7.29.0** sont imposées
par des overrides explicites ; `npm audit fix` seul laissait les avis ouverts.
Les tests workerd ont été réexécutés après correction et après `npm ci`.

Sources des avis consultés :
[cryptography](https://github.com/pyca/cryptography/security/advisories),
[sharp](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c),
[undici](https://github.com/advisories/GHSA-4cwx-7wf7-3272).
Les avis connus ne constituent pas un audit du code Jaunt ni du protocole.
Le bundle xterm reçu dans l’archive conserve sa limitation de provenance/version
exacte décrite dans `THIRD_PARTY_NOTICES.md` ; il n’est pas couvert par npm audit.

Échecs lus et corrigés, sans supprimer les assertions :

- Le fichier preuve était créé avant la réception/rendu asynchrone du terminal.
  Le test attend maintenant la présence effective du résultat dans le scrollback
  avec une borne temporelle ; il échoue toujours si le résultat n’arrive pas.
- Le test headless héritait du bureau X11/Wayland et déclarait à tort attendre
  un presse-papiers indisponible. Son processus hôte est désormais privé des
  variables graphiques ; les PTY de test n’exécutent plus les profils personnels.
- Une réponse tardive du navigateur de fichiers écrasait un chemin en cours de
  saisie. Le rendu suit désormais les révisions de saisie et de requête.
- Deux vérifications de statut dans Bash ne suffisaient pas à exclure une création
  de shell juste avant l’arrêt. Le daemon vérifie les PTY et ferme leur admission
  atomiquement ; l’installateur utilise cette opération avant de toucher au service.
- Le contrôle du chemin d’installation résout le symlink `runtime/current` avant
  de vérifier que le module provient bien du `site-packages` du runtime neuf.

## Parcours prouvés et portée

Shell arbitraire réel : commande `printf`/`cat`, contenu exact du fichier et sortie
visible. Deux shells indépendants, retour au premier, rechargement avec identité
mémorisée. Le relais local est tué puis relancé : même daemon et PTY, nouvelle
connexion chiffrée sans QR ; interruption supplémentaire pendant un upload.
Fichier Unicode/binaire multichunks uploadé puis téléchargé et comparé octet par
octet. PNG converti et chemin échappé inséré sans Enter ; bouton de collage natif
désactivé pour l’hôte headless. Buffer presse-papiers >64 Kio, coffre protégé,
mauvais mot de passe rejeté, second appareil émulé, révocation sans fermer les shells.

Le fallback jsQR décode une image QR générée pour le test, sans BarcodeDetector.
Ce test ne prétend pas utiliser une caméra. Toutes les ressources précachées,
la licence jsQR, l’installateur et config.json répondent sous `/jaunt/`.
Aucun JavaScript runtime n’est chargé depuis un CDN. Les téléchargements de
navigateurs/dépendances sont des opérations de build, pas des scripts de la page.

Le test installateur télécharge un wheel depuis un miroir HTTP loopback explicitement
autorisé par `JAUNT_DEV_INSTALL=1`. En mode `JAUNT_INSTALLER_ONLINE=1`, il installe
les dépendances depuis PyPI sans hériter des dépendances du développement.
Il refuse un checksum falsifié avant toute installation, démarre le daemon, produit
un appairage, conserve l’identité et les appareils lors d’une mise à jour.
Un navigateur crée ensuite un vrai shell dans le runtime installé : l’upgrade sans
accord échoue, conservant PID et pointeur de runtime ; l’upgrade avec
`JAUNT_ALLOW_RESTART=1` termine le shell et reconnecte le navigateur mémorisé.
Le mode offline initial de six contrôles a également été exécuté avant extension.

## Non validé — ne pas annoncer comme livré en production

- Cloudflare réel, quotas/coûts, santé et WebSockets publics : autorisation manquante.
  Miniflare est un test réel du runtime local, pas un déploiement Cloudflare.
- Tag/release publique, trois assets GitHub, Pages réelle et installation depuis cette
  release sur une machine propre : en attente du relais ; aucune URL inventée.
- Service utilisateur systemd/launchd réel, bootstrap uv/Python absent de la machine,
  installation macOS/WSL : non exécutés par les tests locaux d’installateur.
- Téléphone physique : aucun utilisé. Caméra, IME/clavier, galerie, rotation réelle,
  Wi-Fi ↔ réseau mobile, PWA suspendue et push écran verrouillé restent non validés.
  Les dimensions tactiles simulées ne prouvent pas ces comportements matériels.
- Livraison Web Push FCM/Apple/Mozilla et collage image natif Claude/Codex sur un
  presse-papiers graphique : non exécutés. Un chemin inséré n’est pas une pièce jointe native.
- tmux réel, Firefox/Safari, charge prolongée, SLA et coût du relais : non validés.
- **Protocole, hôte, front et relais sans audit de sécurité indépendant.**
  Les limites de `SECURITY.md`, dont l’origine GitHub Pages partagée, sont conservées.

La publication Pages est manuelle et vérifie les trois assets et leurs checksums.
Les workflows utilisent obligatoirement `npm ci`. La recette publique de
`docs/DEPLOYMENT.md` reste obligatoire dès que l’autorisation Cloudflare est disponible.

## Contrôle des artefacts avant PR

Gitleaks **8.30.1** a inspecté le snapshot courant (89 fichiers), sans parcourir
l’ancien historique ni les dossiers personnels. Un unique résultat a été examiné :
`r.FourKeyMap=r.TwoKeyMap=void 0` dans le bundle xterm, une affectation JavaScript
et non une clé API. Aucune fuite réelle identifiée. Le wheel a été décompressé et
scanné séparément ; il contient uniquement le package Jaunt et ses métadonnées.
Le ZIP de livraison a été reconstruit, contrôlé par CRC, comparaison des octets et
checksums de tous ses fichiers. Les cinq captures ont été examinées visuellement :
aucun QR, coffre ou terminal privé. La licence jsQR est copiée sans modification ;
son saut de ligne final est signalé par `git diff --check` et conservé tel que fourni.

## CI GitHub observée

[Exécution 34849935562](https://github.com/moukrea/jaunt/actions/runs/34849935562) :
**5 jobs réussis**, hôte Linux/macOS × Python 3.11/3.13, navigateur et relais sous Node 22.
Cela valide les tests hôte macOS ; l’installation par launchd et Safari restent non testés.

Le parcours E2E additionnel Worker passe localement avec 18 scénarios, dont la perte
du vrai processus workerd et la reprise avec stockage Durable Object persistant.
Le premier essai tuait uniquement le parent Node : les sockets workerd restaient
temporaires ouvertes. Le harness a été corrigé pour tuer son propre groupe de
processus isolé ; il vérifie toujours la déconnexion effective avant redémarrage.
Cette correction concerne uniquement l’injection de panne dans le test.

La CI Worker a ensuite reproduit une seconde course de navigation : une requête
de rafraîchissement démarrée après la saisie pouvait encore la remplacer.
La correction conserve désormais le brouillon par machine et enregistre le
répertoire demandé dès l’envoi. Un 19e scénario retarde les véritables réponses
RPC chiffrées, déclenche un rafraîchissement après la saisie puis pendant la
navigation, et vérifie le champ et les fichiers obtenus. Il passe sous workerd.
La CSP est inchangée : le polling Playwright utilise une fonction, sans unsafe-eval.
