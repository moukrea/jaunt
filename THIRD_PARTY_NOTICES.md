# Third-party licenses and dependencies

jaunt code is licensed under MIT, copyright moukrea. The project owner supplied the logo; verify rights before redistributing it outside this project. No proprietary fonts are distributed: the UI uses system fonts.

- `web/vendor/xterm.mjs` and `xterm.css`: @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0, @xterm/addon-webgl 0.19.0 and @xterm/addon-unicode11 0.9.0, MIT. Built from the exact package-lock.json dependencies by `npm run prepare-web`; the four licenses are preserved in `web/vendor/LICENSE-xterm.txt`.
- `web/vendor/fonts/JuliaMono-*.woff2`: JuliaMono 0.63.2 Regular and Bold web fonts, unmodified from the official `JuliaMono-webfonts.tar.gz` release (https://github.com/cormullion/juliamono), SIL Open Font License 1.1 with Reserved Font Name JuliaMono, pinned by SHA-256 in `scripts/prepare_web.mjs`, which also writes `terminal-fonts.css`. The license is preserved in `web/vendor/LICENSE-juliamono.txt`.
- `web/vendor/fonts/SymbolsNerdFontMono-Regular.woff2`: Symbols Nerd Font Mono from Nerd Fonts 3.5.1 (`NerdFontsSymbolsOnly.zip`, https://github.com/ryanoasis/nerd-fonts), MIT, repackaged from TTF to WOFF2 without glyph changes and pinned by SHA-256 in `scripts/prepare_web.mjs`. It bundles icon sets under MIT, Apache 2.0, SIL OFL 1.1 and CC BY 4.0; the license and the per-set attribution table are preserved in `web/vendor/LICENSE-nerd-fonts-symbols.txt`.
- The web build installs **jsQR 1.4.0**, Apache-2.0, from the npm `jsqr` package and copies its source and license into `web/vendor`. Source: https://github.com/cozmo/jsQR . No CDN JavaScript runs dynamically in the page.
- Host: Python (PSF), websockets (BSD), cryptography (Apache-2.0/BSD), qrcode (BSD), pywebpush (MPL-2.0). Dependencies are installed separately in the private environment; their licenses still apply.
- Build/test tools: pytest, Playwright, Wrangler/Miniflare, setuptools, wheel. See their distributions and license metadata.
- When Python is missing, the installer may download uv and Python from their official channels. Their binaries are not bundled in the source ZIP.

The wheel SHA-256 detects a corrupted download, but is not a signature independent of the GitHub account publishing the manifest. Protect the repository and release permissions.
