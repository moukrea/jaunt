# jaunt contribution guidelines

- Read SECURITY.md and docs/PROTOCOL.md before modifying the transport.
- Arbitrary shells are the core feature. Do not restrict access to AI agents.
- Never put secrets in request URLs, logs, or published tests; pairing uses the fragment.
- Render remote DOM content with textContent, never innerHTML. No runtime CDN scripts in the UI.
- Never replay terminal input after reconnecting. Uploads use idempotent offsets and SHA-256 commits.
- Never send Enter automatically after pasting an image/path. Show actual native capabilities.
- Do not close PTYs when a browser disconnects. Preserve identity across updates.
- Tests: pytest; node --test tests/relay.test.mjs; npm run test:relay; python tests/browser_e2e.py.
- docs/VALIDATION.md records observations, not promises. Update it accurately.
- Write repository documentation, contribution guidance, and release notes in English by default. Application localization is separate.
