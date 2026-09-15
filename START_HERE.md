# Getting started with this archive

**jaunt 0.1.0-beta.5 — complete project, source distribution, and host wheel.**

The application is published at https://moukrea.github.io/jaunt/.
End users install the host with the README command, then pair the Android APK or their browser. The owner has already configured GitHub Pages and the jaunt Cloudflare relay. For maintenance or redeployment, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

**To try it locally without deploying:** follow the README's Local development section (`python scripts/dev.py`). This mode is reachable only from the same machine and does not replace the production relay.

## Where to look

- `README.md`: features, installation, and limitations.
- `DEPLOY_AGENT_PROMPT.md`: instructions for the deployment agent.
- `docs/VALIDATION.md`: observed results and untested scope.
- `docs/evidence/`: JSON evidence and browser screenshots.
- `SECURITY.md`: permissions, secrets, unaudited protocol, and GitHub Pages precautions.
- `release/`: built host wheel and checksums, identical to the public release assets.

The archive contains no pairing secrets or preconfigured accounts. The installable Android APK uses a bundled interface and native camera, clipboard, file, and notification integrations. See [docs/ANDROID.md](docs/ANDROID.md); the web client remains available on mobile and desktop.
