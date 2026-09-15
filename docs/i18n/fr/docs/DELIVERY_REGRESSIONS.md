[English](../../../DELIVERY_REGRESSIONS.md) · [fr](DELIVERY_REGRESSIONS.md) · [es](../../es/docs/DELIVERY_REGRESSIONS.md) · [it](../../it/docs/DELIVERY_REGRESSIONS.md) · [pt](../../pt/docs/DELIVERY_REGRESSIONS.md) · [de](../../de/docs/DELIVERY_REGRESSIONS.md)

# Corrections de régression de livraison — 15 septembre 2026

Ce rapport fait suite à des échecs signalés par l'utilisateur après la version précédente. Les tests précédents de passage n'ont pas établi le démarrage correct de l'utilisateur shell, le défilement tactile utilisable ou le chemin de lancement par défaut de l'archive Ubuntu.

## Causes et changements reproduits

- Les profils de connexion Bash peuvent omettre `.bashrc`. Le service lancé shell nouvelles sessions chargent l'environnement de connexion et puis la configuration de bash interactive; manquant SHELL utilise le compte shell.
- Les mises à jour de l'hôte sans surveillance sautent les invites d'installation et d'autorisation du système GUI. L'installation graphique interactive et explicite `jaunt gui` installent toujours l'application de bureau.
- L'archive de bureau publiée avorte sous Ubuntu 24.04 espaces de noms d'utilisateurs restreints avec une erreur sandbox-helper. L'installateur y sélectionne maintenant le paquet système vérifié, ce qui permet d'installer son support AppArmor scoped sans désactiver la sandboxing Chromium.
- Le logo natif extraResource excluait sa source des actifs web emballés, brisant le logo in-app. La ressource native utilise maintenant une icône de bureau générée, conservant l'original dans les actifs web.
- L'emballage d'icônes Linux a utilisé un répertoire de thèmes 547×547 non indexé. Il comprend maintenant huit tailles standard dérivées de l'oeuvre d'origine.
- Les pictogrammes UI proviennent maintenant de Lucide 1.46.0, livré localement avec sa licence ISC. Android utilise un enveloppeur de lanceur adaptatif autour de l'œuvre fournie.
- L'interface utilisateur nouvelle session n'offre plus tmux. Les sessions existantes tmux et la compatibilité hôte restent intactes.
- Android touch swips n'a pas défilé le port virtuel de xterm. Un gestionnaire de touche fournit défilement et élan; le redimensionnement du clavier conserve l'ancre de lecture au lieu de sauter à la première ou à la dernière ligne.
- Le texte de la notification du programme a été supprimé. Les messages OSC 9 et le titre/le corps OSC 777 atteignent maintenant les notifications natives. Les cibles de notification restent en attente jusqu'à ce que leur hôte/session soit disponible. terminal la production est grattée.
- La vue scindée est dans la barre des onglets de bureau, avec création directe à côté / ci-dessous, scissions de session existantes, mise en page persistante, et l'onglet mobile fallback.

## Validation locale observée

- `npm install` / `npm audit`: dépendances épinglées et fichier de verrouillage réel; aucune vulnérabilité connue au moment de cette exécution. Node 25.5.0, npm 11.8.0, Electron 44.3.0, constructeur d'électrons 26.15.3.
- `.venv/bin/python -m pytest -q`: 63 passé sur Python 3.14.2, y compris les vrais tests de régression de connexion-PATH/prompt couleur PTY et de contenu de notification en morceaux.
- `node --test tests/js.test.mjs tests/relay.test.mjs`: 21 passé.
- `npm run test:relay`: 2 vrais tests de routage Miniflare/workerd passés.
- `npm run prepare-web` et `.venv/bin/python scripts/check_project.py`: passé; local jsQR, xterm, Lucide et licences.
- `.venv/bin/python scripts/build_release.py`: construit une roue non-éditable 0,10b9.
- `.venv/bin/python tests/browser_e2e.py`, également avec `jaunt_E2E_RELAY=workerd`: 23 scénarios passés par moteur.
- `.venv/bin/python tests/terminal_render_e2e.py`: défilement, ancre de lecture clavier-hauteur, sélection et thèmes passés, ainsi que le démarrage réel isolé Claude Code et Codex. Aucune exécution de modèle authentifiée n'est demandée.
- `DISPLAY=:179 .venv/bin/python tests/shared_workspace_e2e.py`: partage local/à distance PTY, propriété géométrique, détachement/termination et repli mobile du panneau passé.
- Signé Android release/debug builds, lint et tâches d'unité passées. `tests/android_workspace_e2e.py` le Android 14/API 34 l'émulateur a passé la vraie touche swipe, l'ancre du clavier réel, les insets du système, la rotation, le titre/le corps OSC écran et taper la notification dans la bonne session.

Installé candidat `.deb` plus roue non-éditable 0,1.0b9 passé sur Ubuntu 24.04: exécution réelle PTY, Seccomp=2/NoNewPrivs=1 rendu, décodé logos dans l'application, localement disponibles Lucide et des icônes de lanceur standard lisibles. Le bureau candidat a également authentifié par le relais public et a prouvé une commande à distance. `scripts/check_desktop_package.mjs` vérifie maintenant ces chemins de ressources empaquetés et métadonnées Linux dans CI.

La numérisation du binaire ASAR a produit deux faux positifs examinés dans les identifiants JavaScript fournisseurs (`FourKeyMap` et `SequencerByKey`); aucun justificatif n'était présent.

## Livraison publiée

PR [20](https://github.com/moukrea/jaunt/pull/20) fusionné en `cb0cb99910978e0874cf00235a046f47ff297d72` après toutes les vérifications passées. Sauvegarde `backup/pre-delivery-fixes-20260915` conserve l'état précédent. Aucune force-pouss ou suppression d'historique n'a été utilisée.

- Page publique : https://moukrea.github.io/jaunt/
- Hôte : [v0.1.0-beta.9](https://github.com/moukrea/jaunt/releases/tag/v0.1.0-beta.9), exactement trois actifs. Tous les comptes de contrôle, les chemins d'archives et les 16 fichiers sources Python/installateur ont été vérifiés par rapport à la source livrée.
- Bureau : [desktop-v0.1.0-beta.7](https://github.com/moukrea/jaunt/releases/tag/desktop-v0.1.0-beta.7), dix paquets Linux/macOS plus SHA256SUMS. Tous les dix téléchargements correspondaient aux montants de contrôle. Paquet public installé Ubuntu : exécution locale et distante shell, session de navigateur/desktop partagée, terminaison de chaque côté, logo décodé, icônes standard lisibles et rendu sandboxé.
- Android: [android-v0.1.0-beta.5](https://github.com/moukrea/jaunt/releases/tag/android-v0.1.0-beta.5), versionCode 5. Les 27 ressources web groupées publiques de APK correspondaient à la source; l'installateur hôte est intentionnellement exclu par la construction Android. Sa somme de contrôle et le certificat de signature existant ont été vérifiés. L'installation sur le beta public.4 APK a conservé l'appariement et le reconnecté. L'automatisation de l'interface utilisateur native sur la version APK a ensuite créé un shell, a prouvé un résultat de commande sur l'hôte et a mis fin à la session.

La commande exacte extraite de la page publique est passée dans un nouveau conteneur Fedora 43 et un nouveau compte dans le Ubuntu 24.04 VM:

```sh
bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash'
```

L'installation graphique interactive Ubuntu a automatiquement sélectionné le paquet de bureau du système public. Le service hôte a été activé, exécuté et connecté; un SVG valide QR a été généré sans imprimer ou publier son secret.

La page publique → Cloudflare → l'acceptation de la roue publique a passé 12 contrôles : appariement, saisie exacte de 512 caractères, multiple shells, comparaison par octet de fichier, image/path/no-Enter fallback, recharge, véritable interruption du réseau VM IPv4/IPv6 avec la même session/PID, refus de détruire shells active, redémarrage explicitement autorisé avec des identités conservées, et révocation. Voir [les résultats observés](../../../evidence/public-report-beta9.json).

Ce PC de maintenance a également été mis à jour par l'installateur public pour héberger 0,10b9 avec ses clés host/device existantes préservées. Un shell créé par service temporaire a trouvé et a lancé `codex-cli 0.154.0` par PATH et a produit une invite colorée; seule cette session temporaire a été terminée. Le beta.7 du bureau public a été installé et est resté en cours d'exécution sur Ubuntu.

Preuves de l'IC : [vérifications RP](https://github.com/moukrea/jaunt/actions/runs/34960446113), [Paquets de bureau](https://github.com/moukrea/jaunt/actions/runs/34960446067), [Android](https://github.com/moukrea/jaunt/actions/runs/34960446100). Publication: [hôte](https://github.com/moukrea/jaunt/actions/runs/34960988005), [Desktop](https://github.com/moukrea/jaunt/actions/runs/34961170116), [Android](https://github.com/moukrea/jaunt/actions/runs/34961169894), [Pages](https://github.com/moukrea/jaunt/actions/runs/34961981670). Les 28 ressources vérifiées de la page publique correspondaient aux fichiers fournis sous `/jaunt/`. La santé du relais existant et authentique WebSockets pass; aucune URL de relais ou de relais tiers n'a été inventée.

![Paquet de bureau public avec le logo fourni et les icônes d'interface Lucide](../../../evidence/desktop-release-beta7.png)

## Limites restantes

Le matériel physique Android, les claviers/politiques de batterie spécifiques au fournisseur, la commutation réelle Wi-Fi/mobile, l'exécution macOS et l'exécution ARM ne sont pas validés par ces tests. Les tests d'émulateur Android sont identifiés comme tels. Les conversations authentifiées Claude Code/Codex ne sont pas couvertes par des tests de démarrage isolés. **Le protocole n'est pas vérifié de façon indépendante.**
