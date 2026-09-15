# Third-party licenses and dependencies

Jaunt code is licensed under MIT, copyright moukrea. The project owner supplied the logo; verify rights before redistributing it outside this project. No proprietary fonts are distributed: the UI uses system fonts.

- `web/vendor/xterm.mjs` and `xterm.css`: xterm.js and FitAddon, MIT license; see `web/vendor/LICENSE-xterm.txt`. This bundle arrived with the original sources. No reproducible-build claim is made without recovering its exact version/source. Test updates before replacing it.
- The web build installs **jsQR 1.4.0**, Apache-2.0, from the npm `jsqr` package and copies its source and license into `web/vendor`. Source: https://github.com/cozmo/jsQR . No CDN JavaScript runs dynamically in the page.
- Host: Python (PSF), websockets (BSD), cryptography (Apache-2.0/BSD), qrcode (BSD), pywebpush (MPL-2.0). Dependencies are installed separately in the private environment; their licenses still apply.
- Build/test tools: pytest, Playwright, Wrangler/Miniflare, setuptools, wheel. See their distributions and license metadata.
- When Python is missing, the installer may download uv and Python from their official channels. Their binaries are not bundled in the source ZIP.

The wheel SHA-256 detects a corrupted download, but is not a signature independent of the GitHub account publishing the manifest. Protect the repository and release permissions.
