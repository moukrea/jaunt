# Protocole Jaunt v1

Ce document décrit l'implémentation, pas un standard ni une garantie de sécurité.

## Transport et identités

Endpoint `wss://RELAY/v1/room/ROOM`. ROOM : 18 octets aléatoires, base64url sans padding (24 caractères). Capacités de routage : 32 octets, 43 caractères. L'hôte s'enregistre avec `hostToken` et `clientToken`. Le Durable Object stocke leurs SHA-256 lors d'une première transaction atomique ; un autre hôte ne peut pas remplacer ces valeurs. Le navigateur possède seulement clientToken. Les messages client sont routés avec un peer ID attribué par le relais, pas choisi par le client.

Le relais stocke les hashes de routage et états d'attachement nécessaires à l'hibernation, jamais l'historique du terminal. Les clés de chiffrement restent aux extrémités. Les deux connexions sont sortantes, sans port entrant sur la machine.

## Appairage

`JAUNT1.` + JSON base64url, contenant `v` (version), `r` (relais), `h` (room), `t` (clientToken), `p` (pair ID), `s` (pair secret), `n` (nom hôte). La date d’expiration est conservée et contrôlée côté hôte, pas utilisée comme autorité côté navigateur. Un QR pointe vers la Page avec ce code dans le fragment. Durée 600 secondes, usage unique.

Le navigateur crée son device ID et secret de 32 octets, les sauvegarde AVANT de consommer le QR, puis les transmet seulement après authentification/chiffrement. Si le welcome final est perdu, il essaie d'abord l'identité appareil déjà persistée, puis le pairing si encore valide. La révocation supprime l'autorisation côté hôte et ferme les canaux de cet appareil.

## Handshake

Client et serveur créent chacun une clé P-256 éphémère. Clé publique SEC1 non compressée, base64url. Le transcript est le tableau JSON compact, ASCII, dans cet ordre :

```
["jaunt-v1", room, auth, id, pair-or-"", clientNonce, clientPublic, serverNonce, serverPublic]
```

Les preuves sont HMAC-SHA256(secret, `server:` || transcript) et HMAC-SHA256(secret, `client:` || transcript), comparées avant ouverture du canal. `auth` distingue pairing et appareil mémorisé. Nonces aléatoires par connexion.

Shared = P-256 ECDH. AAD = SHA256(transcript). HKDF-SHA256, longueur 32, salt SHA256(secret), info AAD || `jaunt-c2h` ou AAD || `jaunt-h2c`. Deux clés AES-256-GCM indépendantes par direction. Compteurs stricts à partir de 1, nonce de 12 octets = 4 zéros + uint64 big-endian du compteur. Nonce épuisé avant 2^53 : fermer et reconnecter. Tout saut, doublon ou échec GCM ferme le canal. Aucune clé éphémère réutilisée après reconnexion.

Trame application : `{type:"box", n:counter, ct:base64url(ciphertext+tag)}`. Le message déchiffré est JSON ; les blocs binaires sont base64url. Budget transport 132 000 caractères. Les entrées/sorties/fichiers sont découpés avant chiffrement.

## RPC et flux

Requêtes `{type:"rpc", id, method, params}` ; réponses `{type:"reply", id, ok:true, result}` ou forme d'erreur définie dans daemon.py. Les méthodes et événements sont à lire dans `Peer.dispatch`/`Host.rpc`, source de vérité, plutôt que d'inventer un second schéma divergent.

Sessions : IDs idempotents, sorties avec offset absolu d'octet. Après reconnexion `session.attach(after)` rejoue uniquement la partie conservée non reçue. Si le buffer a été tronqué, événement reset explicite. Les dimensions sont partagées : le dernier client actif redimensionne la PTY commune.

Uploads : ID par transfert, propriétaire device, offset attendu, réponse offset sur doublon. SHA-256 calculé à la réception ; commit atomique sans écraser une destination concurrente. Temporaire dans le même dossier, permissions 0600. Expiration après une heure d'inactivité. Pas de reprise disque après redémarrage de l'hôte. Downloads : lecture de fichier régulier, taille et mtime contrôlées, blocs 48 Kio.

## Évolution

Un client Android natif doit implémenter ce protocole et le même stockage d'identité, pas copier la session WebSocket du navigateur. Versionner tout changement incompatible. Les tests d'interopérabilité Python/Web Crypto et les tests de replay doivent rester bloquants en CI.
