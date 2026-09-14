# Jaunt 0.1.0-beta.1

First from-scratch Jaunt host and mobile-first web client. Arbitrary POSIX PTYs, remembered encrypted pairing, reconnect, files, resumable network transfers, conditional native image clipboard, PWA notifications and a project-owned blind relay.

This is a beta, not an externally audited secure-access product. Read README.md and SECURITY.md. Native image paste needs an accessible host desktop clipboard; headless hosts use image upload plus a quoted path. Plain PTYs do not survive daemon restarts; use tmux when appropriate.

Install only against a deployed Jaunt Page with a configured relay. No public relay or production/hardware test is implied by publishing these sources.
