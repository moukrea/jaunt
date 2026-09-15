[English](../../../PROTOCOL.md) · [fr](PROTOCOL.md) · [es](../../es/docs/PROTOCOL.md) · [it](../../it/docs/PROTOCOL.md) · [pt](../../pt/docs/PROTOCOL.md) · [de](../../de/docs/PROTOCOL.md)

# Protocole jaunt v1

Ce document décrit la mise en œuvre, et non une norme ou une garantie de sécurité.

## Transports et identités

Endpoint: `wss://RELAY/v1/room/ROOM`. CHAMBRE est de 18 octets aléatoires, codés comme base non rembourrée64url (24 caractères). Les capacités de routage sont de 32 octets (43 caractères). L'hôte enregistre avec `hostToken` et `clientToken`. L'objet durable stocke ses haches SHA-256 dans une transaction atomique initiale; un autre hôte ne peut pas les remplacer. Le navigateur ne détient que clientToken. Les messages clients sont acheminés à l'aide d'un identifiant pair attribué par le relais, non choisi par le client.

Le relais stocke les hachages de routage et l'état de fixation nécessaires pour l'hibernation, jamais l'historique terminal. Les touches de chiffrement restent aux paramètres. Les deux connexions sont sortantes; l'hôte n'a pas besoin de port entrant. Navigateur WebSockets doit utiliser le `APP_ORIGIN` configuré; le bureau emballé utilise l'origine `jaunt://app` autorisée séparément. Les connexions natives d'origine/Android restent supportées. Tous les clients authentifient encore les capacités de routage et le canal de bout en bout.

## Raccordement

`jaunt1.` suivie de base64url JSON contenant `v` (version), `r` (relais), `h` (chambre), `t` (Token client), `p` (identification de la paire), `s` (secret de paire), et `n` (nom de l'hôte). L'hôte stocke et applique l'expiration; le navigateur ne traite pas sa propre valeur d'expiration comme faisant autorité. QR code pointe vers la page avec ce code dans le fragment. Durée de vie: 600 secondes, usage unique.

Le navigateur crée son ID de périphérique et son secret de 32 octets et les enregistre AVANT de consommer le code QR, puis les transmet seulement après l'authentification et le cryptage. Si le message de bienvenue final est perdu, il essaie d'abord l'identité persistante de périphérique, puis appariement si toujours valide. Révocation supprime l'autorisation côté hôte et ferme les canaux de cet appareil.

## Serre-mains

Les clés publiques utilisent l'encodage et la base SEC1 non compressés64url. La transcription est un tableau compact ASCII JSON dans cet ordre exact:

```
["jaunt-v1", room, auth, id, pair-or-"", clientNonce, clientPublic, serverNonce, serverPublic]
```

Les preuves sont HMAC-SHA256(secret, `server:`) et HMAC-SHA256(secret, `client:`), vérifiées avant d'ouvrir le canal. `auth` distingue l'appariement d'un appareil mémorisé. Chaque connexion utilise des nonces aléatoires.

Shared = P-256 ECDH. AAD = SHA256(transcript). HKDF-SHA256, longueur 32, sel SHA256(secret), info AAD. `jaunt-c2h` ou AAD. `jaunt-h2c`. Deux touches AES-256-GCM indépendantes, une par direction. Les compteurs stricts commencent à 1; le nonce de 12 octets est quatre octets zéro suivis du compteur Uint64 big-endian. Fermez et reconnectez avant que le compteur de nonce n'atteigne 2^53. Toute lacune, double ou GCM ferme le canal. Les touches éphémères ne sont jamais réutilisées après la reconnection.

Cadre d'application : `{type:"box", n:counter, ct:base64url(ciphertext+tag)}`. Les messages décryptés sont JSON; les morceaux binaires utilisent base64url. Budget de transport : 132 000 caractères. L'entrée, la sortie et les fichiers sont coupés avant cryptage.

## RPC et flux

Demandes : `{type:"rpc", id, method, params}`. Réponses : `{type:"reply", id, ok:true, result}`, ou le formulaire d'erreur défini dans daemon.py. `Peer.dispatch` et `Host.rpc` sont la source de vérité pour les méthodes et les événements; ne pas inventer un second schéma divergent.

Les sessions utilisent des identifiants idémpotent et des sorties avec des décalages d'octets absolus. Après la reconnexion, `session.attach(after)` rejoue uniquement les sorties conservées qui n'ont pas été reçues. Si le tampon a été tronqué, un événement de réinitialisation explicite est envoyé. Les dimensions sont partagées : le dernier client actif redimensionne le PTY commun.

Les téléchargements utilisent des ID par transfert, la propriété de l'appareil, un offset prévu et une réponse offset pour les morceaux en double. SHA-256 est calculé pendant la réception; commit est atomique et n'écrase pas une destination créée simultanément. Les fichiers temporaires sont dans le même répertoire avec le mode 0600. Les transferts expirent après une heure d'inactivité. Il n'y a pas de reprise sur disque après un redémarrage de l'hôte. Téléchargements lire les fichiers réguliers, vérifier la taille et mtime, et utiliser 48 KiB Des morceaux.

## Évolution

Un natif Android client doit mettre en œuvre ce protocole et la même sémantique de stockage d'identité; il ne doit pas copier le navigateur WebSocket Version de chaque changement incompatible. Python/Les essais d'interopérabilité et de rejouage de Crypto sur le Web doivent rester requis dans l'IC.

## Vues partagées et transport local de bureau

Un accueil inclut facultativement `peer`, l'identificateur de la vue actuelle. `viewers` et `activeView`. `terminal.geometry` porte la PTY'les colonnes, les lignes, la vue de contrôle et la liste des visualistes. Une entrée active explicite ou redimensionner la géométrie des revendications; il suffit de l'attacher ne. terminal La file d'attente d'écriture asynchrone de l'analyseur.

`session.detach` supprime une vue sans fermer la PTY. `session.terminate` termine explicitement la session sous-jacente, y compris une session tmux nommée, le cas échéant. L'ancien comportement de `session.close` reste compatible avec les anciens clients.

Le pont de bureau envoie les mêmes messages RPC/stream par la prise de commande 0600 Unix après `ui.connect`. Le répertoire parent 0700 de la prise limite l'accès au compte hôte. Aucun secret d'appariement n'est généré pour ce même canal; les connexions à distance conservent la poignée de main cryptographique existante. L'entrée n'est jamais rejouée lorsque l'un ou l'autre des canaux se reconnecte.

Le nouveau texte d'appariement utilise le préfixe en minuscule `jaunt1.`. Les clients mis à jour acceptent également le préfixe en majuscule d'origine; les fragments d'URL d'appariement et les étiquettes de transcription cryptographique sont inchangés.

Les hébergeurs de la publicité `sessionDirectory: true` acceptent `session.directory(id)` et le `sourceSession` optionnel sur `session.create`. Un `cwd` explicitement non vide a priorité. L'hôte lit le répertoire courant du processus shell sur Linux/macOS et revient à son répertoire initial si le processus est terminé ou si l'OS ne peut pas le fournir.

Les clients peuvent distinguer le résultat de la vérification demandée d'une vérification effectuée précédemment. Les états comprennent la vérification, le téléchargement, la vérification, l'installation, l'installation, le courant, le report et l'erreur. Une erreur d'installation n'est pas signalée en attente à moins que shells/transferts actifs ne bloque effectivement un redémarrage non autorisé.
