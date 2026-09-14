# Jaunt 0.1.0-beta.2

Fix interrupted WebSocket sends so the PTY output pump keeps running after network loss. The shell, replay buffer and remembered identities survive the interruption. Upgrade retains host and device identities; active ordinary shells still block a restart unless explicitly authorized with `JAUNT_ALLOW_RESTART=1`.

The web client separately checks authenticated host liveness, waits for terminal attachment before accepting input, and preserves disconnect reasons. Real PTY and browser regression tests cover recovery.

This beta has no independent protocol/security audit. Native image paste requires an accessible host desktop clipboard; headless hosts support image upload plus a quoted path without Enter. Physical phone camera, network switching and locked-screen push have not been tested by the agent. See docs/VALIDATION.md for observed results and remaining limits.
