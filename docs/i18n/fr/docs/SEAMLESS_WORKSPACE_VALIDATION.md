[English](../../../SEAMLESS_WORKSPACE_VALIDATION.md) · [fr](SEAMLESS_WORKSPACE_VALIDATION.md) · [es](../../es/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [it](../../it/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [pt](../../pt/docs/SEAMLESS_WORKSPACE_VALIDATION.md) · [de](../../de/docs/SEAMLESS_WORKSPACE_VALIDATION.md)

# Validation de l'espace de travail et de la mise à jour de l'exécution — 2026-09-15

Versions candidates : hôte `0.1.0b11`, bureau `0.1.0-beta.10`, Android `0.1.0-beta.8` / code de version 8. La vérification de publication est en cours pendant que cette branche est sous test. Aucun hôte de production ou utilisateur ordinaire shell n'a été arrêté pour ces tests.

## Résultats observés

Commandité Résultat observé
| --- | --- |
Les tests `.venv/bin/python -m pytest -q` sont passés à 77, y compris les transitions réelles du programme PTY.
`npm test`
| `npm run test:relay` Les deux sont réels Miniflare/travailleurd WebSocket scénarios passés.
La syntaxe `.venv/bin/python scripts/check_project.py`.Python/JavaScript, les importations locales, les ressources de page et la syntaxe d'installation sont passées.
| `.venv/bin/python tests/browser_e2e.py` 23 scénarios passés avec réel PTYs, authentification, reconnects, comparaisons d'octets, repli de presse-papiers et révocation.
| `jaunt_E2E_RELAY=workerd .venv/bin/python tests/browser_e2e.py` Les 23 mêmes scénarios ont passé par la mise en œuvre effective Worker.
| `.venv/bin/python tests/terminal_render_e2e.py` Réel isolé `claude` et `codex` startup, leurs icônes d'onglet/panneau Meteor, terminal dimensions, sélection et défilement vers la fin passé. Pas d'invocation authentifiée du modèle.
| `DISPLAY=:179 .venv/bin/python tests/shared_workspace_e2e.py` | Electron et navigateur partagé un PTY, la propriété des dimensions, les contrôles de session et les groupes de division persistants sont passés.
`.venv/bin/python tests/feedback_e2e.py`.Les poignées de main/RPC interruptées, la rétroaction contextuelle limitée, les contrôles de progression et la commutation entre les vrais hôtes sont passés.
`.venv/bin/python tests/workspace_usability_e2e.py`= Positions de l'onglet stable, réordre de pointeur, renommer double-cliquez, pas de renom depuis longtemps, état de la barre latérale sauvegardée, paramètres réactifs et ancre de défilement mobile conservée passé.=
`.venv/bin/python tests/i18n_e2e.py`.Six localisations de navigateur, des redéfinitions explicitement enregistrées et six langues d'aide CLI sont passées ; les arguments de commande et les données utilisateur littérales sont restés inchangés.
| `.venv/bin/python tests/handoff_e2e.py` Temps d'exécution réel `exec` damon laissé en place/PTY PIDs, environnement, cwd et exécution de la commande navigateur. shell pourrait encore être terminé.
| `.venv/bin/python scripts/build_release.py` puis `.venv/bin/python tests/installer_e2e.py` Une roue installée a remplacé son runtime tout en gardant une réelle shell Les dossiers d'identité et d'appareil sont demeurés intacts; aucun gestionnaire de service de compte n'a été touché.
| `jaunt_LEGACY_RELEASE_DIR=<verified public beta.10 assets> .venv/bin/python tests/installer_e2e.py` Le véritable hôte de l'héritage public a refusé la migration avec un actif shell. Le redémarrage explicite de ce montage isolé l'a fermé et a conservé l'identité / les dispositifs.
| `DISPLAY=:179 .venv/bin/python tests/client_only_e2e.py` Nombre effectif Electron mode client seulement fait pas de local CLI appels; jumelé par le relais du propriétaire déployé et exécuté une commande sur un hôte isolé distant. `jaunt` window title passé.
`npm audit --omit=optional`= Aucune vulnérabilité n'a été signalée.
| `.venv/bin/python -m pip_audit` Aucune vulnérabilité de dépendance connue. Le projet installé localement lui-même n'est pas une distribution auditable PyPI.
Android Gradle crée, teste et lint.Après avoir remplacé un helper de flux de l'API-33 seulement par une boucle de lecture compatible avec l'API minimale 26.

Le scénario client natif utilise le relais WSS réel du propriétaire, car un relais de retour en boucle non sécurisé ne doit pas être accepté à partir d'une application emballée. Son état hôte et shell sont des appareils d'essai temporaires.

## Limites de validation restantes

Installation de version publique, mises à jour de l'application installée, la page publiée et la version définitive signée APK sont vérifiés après publication; leurs observations seront annexées ici. Android caméra, galerie, écran de verrouillage poussant et Wi-FiLes observations d'émulateur sont signalées séparément. Un lanceur ou un navigateur peut contrôler le masquage et l'approbation d'icônes installées PWA changement de nom/icône.

Les hôtes sans sortie d'exécution ont besoin d'une migration protégée. La shells ordinaire existante sur ces versions ne peut pas être conservée rétroactivement par le nouveau code. Les mises à jour compatibles conservent les processus; un arrêt de démon explicite, un crash ou un redémarrage de machine n'est pas rendu survivable par ce mécanisme.

Le protocole de chiffrement n'a pas reçu de vérification de sécurité indépendante**. Les tests fonctionnels ne changent pas ce statut.
