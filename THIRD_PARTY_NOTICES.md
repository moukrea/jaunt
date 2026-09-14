# Licences et dépendances

Le code Jaunt est sous licence MIT, copyright moukrea. Le logo est fourni par le propriétaire du projet ; vérifier les droits avant toute redistribution hors du projet. Aucune police propriétaire n'est distribuée : l'interface utilise les polices système.

- `web/vendor/xterm.mjs` et `xterm.css` : xterm.js et FitAddon, licence MIT, voir `web/vendor/LICENSE-xterm.txt`. Bundle reçu avec les sources initiales ; aucune prétention à une build reproductible de ce bundle sans retrouver sa version/source exacte. Tester les mises à jour avant remplacement.
- Le build web installe **jsQR 1.4.0**, licence Apache-2.0, à partir du package npm `jsqr`, puis copie la source et sa licence sous `web/vendor`. Source : https://github.com/cozmo/jsQR . Aucun CDN JavaScript exécuté à la volée dans la page.
- Hôte : Python (PSF), websockets (BSD), cryptography (Apache-2.0/BSD), qrcode (BSD), pywebpush (MPL-2.0). Les dépendances sont installées séparément dans l'environnement privé ; leurs licences restent applicables.
- Outils de build/test : pytest, Playwright, Wrangler/Miniflare, setuptools, wheel. Voir leurs distributions et métadonnées de licence.
- L'installateur peut télécharger uv et Python depuis leurs canaux officiels lorsque Python manque. Ce téléchargement n'est pas une inclusion de leurs binaires dans le ZIP source.

Le SHA-256 du wheel détecte un téléchargement corrompu, mais ne constitue pas une signature indépendante du même compte GitHub qui publie le manifeste. Protéger le dépôt et les autorisations de release.
