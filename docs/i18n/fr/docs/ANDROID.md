[English](../../../ANDROID.md) · [fr](ANDROID.md) · [es](../../es/docs/ANDROID.md) · [it](../../it/docs/ANDROID.md) · [pt](../../pt/docs/ANDROID.md) · [de](../../de/docs/ANDROID.md)

# jaunt Android

Le client Android emballe l'interface fonctionnelle existante dans une connexion APK. Le code Java natif implémente l'accès au presse-papiers, la numérisation de la caméra QR, la sélection/sauvetage des fichiers et une connexion de notification avant-plan opt-in. L'interface utilisateur reste HTML/JS dans le système Android WebView. Aucune connexion d'exécution JavaScript ne provient d'un CDN ou de la page publique : les actifs sont regroupés dans le APK.

## Utilisation

Installez le APK signé à partir de la version Android, puis ouvrez jaunt et scannez le `jaunt pair` QR de l'hôte. Android peut vous demander d'autoriser l'installation à partir du navigateur utilisé pour le télécharger. Cette autorisation est uniquement pour l'installation; aucun nouveau compte cloud n'est nécessaire.

Ouvrir un shell et utilisez Coller après avoir copié une capture d'écran. Avec un presse-papiers hôte pris en charge, l'image est téléchargée, copiée dans ce presse-papiers et Ctrl+V est envoyé à la sélection PTY sans Enter. Sinon, les choix de chemin/attache explicites existants restent. AndroidLes images partagées d'une autre application nécessitent une confirmation nommant la destination shell. Téléchargements ouverts AndroidEnregistrez la boîte de dialogue.

Activer les notifications d'arrière-plan Android sous Paramètres pour chaque hôte. Android demande l'autorisation de notification; une notification persistante affiche le nombre de connexions et offre Stop. Les notifications affichent le titre et le message du programme et ouvrent son host/session lorsque tapoté. Android contrôle la visibilité de l'écran de verrouillage. jaunt ne gratte pas la sortie terminal pour fabriquer du texte de notification. `jaunt notify "Need your attention"` et `jaunt run -- command` peuvent les déclencher. Le service utilisateur de l'hôte doit être actif.

Android L'arrêt de la force empêche le fonctionnement automatique jusqu'à ce que l'application soit de nouveau ouverte. La livraison de la notification n'est pas garantie. VPN et n'exige pas de références Firebase/FCM.

## Limites de sécurité

- `WebViewAssetLoader` sert uniquement des actifs groupés à `https://moukrea.github.io/jaunt/`. Les actifs manquants sont fermés. Les liens externes s'ouvrent en dehors du WebView privilégié.
- Le pont de message natif n'accepte que l'origine exacte de HTTPS et le cadre principal. Aucun chargement d'URL de fichier/contenu, trafic de texte clair, déboguage ou sauvegarde de WebView est activé.
- Les identités de notification Android utilisent la clé de périphérique déjà jumelée et jaunt v1 PSK-authentifiées éphémères P-256/HKDF/AES-GCM canal. Les compteurs authentifiés stricts rejettent le replay. L'interopérabilité du protocole natif est testée contre l'hôte Python installé à la sortie.
- Seule l'option explicite de notification d'arrière-plan copie les champs d'identité requis dans le stockage chiffré Android Keystore. Forget/revocation les supprime. Le verrouillage par défaut cache les données terminal mais ne désactive pas une connexion d'arrière-plan activée séparément.
- Les codes d'appariement, le contenu du presse-papiers, les touches de signature, les journaux terminal et les identités locales ne libèrent pas d'actifs.
- Le protocole et cette nouvelle mise en œuvre native n'ont **pas eu d'audit de sécurité indépendant**.

## Construisez et relâchez

Utilisez JDK 17, Android SDK plate-forme 37.0, build-tools 36.0.0 et l'enrouleur Gradle enregistré. Le comportement cible est Android 16/API 36; API d'installation minimum est 26. Les dépendances Gradle et les somme de vérification des artefacts sont générés à partir de la résolution réelle et enregistrés.

```sh
npm ci
npm run prepare-web
android/gradlew -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

`android-v*` tags lancés `.github/workflows/android.yml`. L'étiquette doit correspondre `versionName`. Signer utilise des secrets de dépôt `ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD` et `ANDROID_KEY_ALIAS`; la clé n'est matérialisée que dans le répertoire temporaire du coureur et retirée par la suite. APK, SHA256SUMS et signature-certificat de sortie de vérification. Une version existante n'est jamais écrasée. `v*` les versions restent séparées avec leurs trois actifs d'installateur.

Le Android test APK contient un montage de presse-papiers isolé pour l'émulateur. Il n'est pas expédié dans la version APK et n'ajoute aucun paramètre de débogage de production. L'automatisation de débogage WebView est désactivée dans les versions.

## Validation

Voir `docs/evidence/android-report.json` pour les résultats observés. Android appareil photo, différences clavier/IME, restrictions de batterie fournisseur, réel Wi-FiLe comportement de la mise à disposition /mobile et de la notification en profondeur nécessite toujours une validation physique des dispositifs. Les tests d'élimination de l'émulateur sont signalés séparément. Claude Code/Codex build affiche une pièce jointe simplement parce que les octets de presse-papiers et Ctrl+V livraison passée.

## Mises à jour des applications

La libération APK vérifie automatiquement le canal de libération publié lors de l'ouverture (au plus une fois par six heures); une connexion de fond activée vérifie également et peut vous informer d'une mise à jour. jaunt télécharge la APK seulement après avoir choisi Télécharger et installer, vérifie SHA-256 contre le fichier release checksum, vérifie l'ID de l'application et signe le certificat contre l'application installée, et refuse les rétrogrades de version. Android's propre installateur demande alors la confirmation. Android Peut nécessiter - -Offre à partir de cette source pour jaunt. Une application normale à chargement latéral ne peut pas contourner silencieusement cette confirmation OS.

Les mises à jour conservent les données de l'application et les touches d'appariement. La désinstallation de l'application les supprime. La mise à jour APK est partagée avec l'installateur de Android via une subvention privée FileProvider, et non un répertoire lisible par le public.
