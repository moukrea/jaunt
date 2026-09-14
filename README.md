# Jaunt

<img src="web/assets/jaunt.png" width="96" alt="Logo Jaunt">

**Vos shells, vos fichiers, votre machine. Depuis votre téléphone.**

Jaunt est une application web installable (PWA) et un hôte POSIX. Elle donne accès à de vrais terminaux, pas seulement à Claude Code ou Codex. La page est statique ; un relais partagé transporte les connexions chiffrées sortantes de l'hôte et du navigateur.

**Version : 0.1.0-beta.2.** [Ouvrir Jaunt](https://moukrea.github.io/jaunt/). Le relais et la release hôte sont déployés ; le protocole reste sans audit de sécurité externe. Voir le [rapport de validation](docs/VALIDATION.md) pour les tests réellement exécutés et les limites non validées.

## Première mise en ligne — une fois pour le propriétaire du projet

Confier [DEPLOY_AGENT_PROMPT.md](DEPLOY_AGENT_PROMPT.md) à l'agent qui a accès à GitHub. Il configure GitHub Pages, une release hôte et **un relais Cloudflare pour le projet entier**. Il faut une autorisation Cloudflare : un token GitHub ne la remplace pas. Aucune infrastructure à créer par les utilisateurs finaux.

Le relais n'est pas emprunté à sshx, Happy ou Zedra. Aucune dépendance à leurs serveurs, à Tailscale ou à un compte utilisateur Jaunt. Le compte Cloudflare du propriétaire peut avoir des quotas/coûts : aucune promesse de relais gratuit ou illimité.

## Installer l'hôte

```sh
curl -fsSL https://moukrea.github.io/jaunt/install.sh | bash
```

Linux, macOS ou WSL. `curl` est nécessaire. L'installateur utilise un Python 3.11–3.14 compatible ou installe un Python privé via uv. Aucun `sudo` implicite. Il vérifie le SHA-256 de la release, crée un environnement privé et démarre un service utilisateur lorsque disponible.

Ouvrir **https://moukrea.github.io/jaunt/**, scanner le QR affiché par l'hôte, ou coller la chaîne `JAUNT1.…`. Le QR expire après dix minutes et n'est utilisable qu'une fois. L'appareil mémorisé utilise ensuite sa propre clé : un changement de Wi-Fi ou de 4G/5G ne nécessite pas de réappairage. Conserver l'onglet ouvert pour reprendre automatiquement ; si le système mobile suspend/tue le navigateur, rouvrir l'application.

```sh
jaunt pair                       # Appairer un autre appareil
jaunt service install            # Installer/activer le service utilisateur
jaunt status                     # État de l'hôte et des shells
jaunt doctor                     # Diagnostic sans afficher les secrets
jaunt devices                    # Appareils autorisés
jaunt revoke IDENTIFIANT          # Révoquer un appareil perdu
jaunt notify "Build terminé"      # Push aux navigateurs inscrits
jaunt run -- make test            # Notification de fin de commande
jaunt clipboard < notes.txt       # Mettre du texte à disposition du client
jaunt stop                       # Arrête l'hôte ET ses shells non-tmux
```

L'appairage autorise le **compte système qui exécute l'hôte**, avec toutes ses permissions. Ne pas installer en root pour un usage ordinaire. Un QR est un secret donnant accès au shell : ne pas le publier.

## Fonctions livrées

| Domaine | Comportement |
|---|---|
| Terminaux | PTY réel, clavier interactif, plusieurs onglets, création/renommage/fermeture, redimensionnement, touches Ctrl/Alt/Esc/Tab/flèches mobiles |
| Reprise | Historique borné, reconnexion automatique, état mémorisé ; une coupure navigateur ne ferme pas le shell |
| tmux | Créer une session tmux ou rattacher une session existante, si tmux est installé ; fermer sa vue ne tue pas le serveur tmux |
| Fichiers | Navigation, fichiers cachés, pagination, création de dossier, renommage, suppression non récursive, upload/download, aperçu texte/image |
| Transferts | Suivi contextuel dans Files → Transfer activity ; morceaux de 48 Kio, offsets de reprise réseau, SHA-256 d'upload, finalisation atomique, annulation |
| Images | Galerie, fichier, collage et drag-and-drop ; conversion PNG des formats décodables par le navigateur ; insertion du chemin ou collage natif conditionnel |
| Presse-papiers | Sélection, copie du scrollback conservé, lecture/écriture du presse-papiers hôte quand disponible, buffer texte headless, OSC 52 en copie seulement |
| Protection | QR à usage unique, clés propres aux appareils, révocation, coffre navigateur facultativement protégé par PIN/mot de passe et verrouillage automatique |
| Notifications | Inscription Web Push, test depuis les réglages, CLI `notify`/`run` ; ni compte ntfy ni détection magique des événements internes d'un agent |
| Interface | Mobile/PC, PWA installable, ressources locales, logo fourni ; pas encore une application Android native |

## Images : la distinction importante

**Paste :** une image est envoyée automatiquement au presse-papiers de l’hôte puis collée avec Ctrl+V dans la session choisie, si le backend natif est disponible. Si le navigateur renvoie du vide, une zone de collage riche et un choix d’image sont proposés. Attach conserve les deux modes explicites. Aucun Enter n’est envoyé.

**Fallback disponible avec une connexion active :** sélectionner/coller l'image, l'envoyer sur l'hôte et insérer son chemin correctement échappé dans le terminal. Aucune validation automatique par Entrée. Claude/Codex ou un autre outil peut lire ce fichier si son propre mode l'autorise.

**Collage natif conditionnel :** quand l'hôte dispose d'un presse-papiers graphique accessible (macOS, Wayland avec `wl-clipboard`, X11 avec `xclip`), Jaunt y place le PNG puis envoie Ctrl+V au terminal. Cela dépend aussi du raccourci et du comportement de l'outil CLI. **Sur une machine headless, Jaunt ne simule pas une pièce jointe native Claude/Codex par magie : le fallback est le fichier et son chemin.** HEIC et autres formats non décodés par le navigateur restent transférables comme fichiers, mais ne sont pas convertis en PNG.

## Limites explicites

- 16 shells actifs, 32 vues retenues, 2 Mio de replay brut par PTY et 10 000 lignes de scrollback côté xterm. La copie intégrale concerne l'historique encore conservé, pas une journalisation infinie.
- Maximum 512 Mio par fichier côté hôte ; téléchargement en mémoire limité à 128 Mio dans les navigateurs sans écriture directe de fichier ; aperçu limité à 16 Mio. Huit uploads simultanés, 1 Gio déclaré total.
- La reprise d'upload fonctionne après coupure réseau tant que l'hôte et la page conservent le transfert. Après redémarrage de l'hôte ou rechargement complet de la page, recommencer l'upload ; aucun accès persistant non autorisé aux fichiers locaux du téléphone.
- Les shells ordinaires survivent à la déconnexion, **pas au redémarrage du daemon ou de la machine**. tmux permet la survie à un redémarrage du daemon, pas à un reboot de l'OS.
- Un seul onglet d'application Jaunt par profil navigateur peut posséder le coffre en même temps. Les onglets de terminal dans Jaunt et plusieurs appareils sont supportés.
- Les notifications requièrent les permissions et le support Web Push du navigateur. Sur iOS, utiliser la PWA installée. La livraison dépend du réseau et du fournisseur push ; aucune garantie temps réel.
- Une machine en veille/éteinte n'est pas joignable. Pas de réveil à distance, pas de tunnel TCP arbitraire, pas de bureau graphique, pas de shell Windows natif.
- Les coûts, limites et disponibilité du relais de production relèvent du compte Cloudflare. Le relais comporte des garde-fous de base, pas une protection commerciale anti-abus garantie.

## Développement local

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -e . -r requirements-dev.txt
npm install
npm run prepare-web
python scripts/dev.py
```

Le runner n'écoute que sur `127.0.0.1`, démarre hôte et relais local et affiche un QR de test. **Ce n'est pas un mode d'exposition à Internet.** Sur un téléphone physique, utiliser le déploiement HTTPS ; `localhost` désigne le téléphone, pas le PC.

```sh
pytest -q                         # Tests Python + tests d'interopérabilité avec Node
node --test tests/relay.test.mjs   # Modèle déterministe du Worker
npm run test:relay                # Runtime Miniflare réel, dépendances npm requises
python scripts/check_project.py   # Cohérence des ressources et syntaxe
python scripts/build_release.py   # Wheel + manifeste + SHA256SUMS
python tests/browser_e2e.py       # Navigateur et hôte réels, isolation temporaire
```

`JAUNT_BROWSER_EXECUTABLE=/chemin/vers/chromium` permet d'utiliser un navigateur système. Sinon : `python -m playwright install chromium`. Les tests ne modifient jamais les politiques de sécurité de votre navigateur.

## Documents

[Déploiement](docs/DEPLOYMENT.md) · [Sécurité](SECURITY.md) · [Protocole](docs/PROTOCOL.md) · [Dépannage](docs/TROUBLESHOOTING.md) · [Validation](docs/VALIDATION.md) · [Licences tierces](THIRD_PARTY_NOTICES.md)
