# Consignes de contribution Jaunt

- Lire SECURITY.md et docs/PROTOCOL.md avant toute modification du transport.
- Les shells arbitraires sont la fonction centrale. Ne pas restreindre aux agents AI.
- Aucun secret dans les URLs de requête, logs ou tests publiés ; le pairing utilise le fragment.
- DOM distant via textContent, jamais innerHTML. Pas de CDN exécuté dans l'UI.
- Aucun input terminal rejoué après une reconnexion. Uploads : offsets idempotents et commit SHA-256.
- Aucun Enter automatique après collage d'image/chemin. Afficher les capacités natives réelles.
- Pas de fermeture de PTY lors d'une déconnexion du navigateur. Préserver l'identité aux updates.
- Tests : pytest ; node --test tests/relay.test.mjs ; npm run test:relay ; python tests/browser_e2e.py.
- Le fichier docs/VALIDATION.md décrit des observations, pas des promesses : le mettre à jour honnêtement.
