# jaunt 0.1.0-beta.7

Shared ordinary shells are now accessible simultaneously from the host desktop app and authorized remote clients, without tmux. The active device controls PTY dimensions; passive views do not resize it. Replay carries the geometry associated with retained output.

Sessions can be listed, opened, detached from a view, or explicitly terminated with their jobs. Closing a tab no longer terminates the shell. Explicit termination also catches background jobs after the shell has exited; the host retains the leader wait status until removal to prevent PID reuse. Automatic upgrades still preserve active ordinary shells and identities; destroying them during an update requires explicit restart authorization.

The companion clients add persistent tiled desktop tabs, mobile session tabs, corrected terminal sizing, natural text selection controls, a gear icon, dark/light/system/circadian themes, friendly host names/order/defaults, and automatic terminal-attention events. The Android update fixes system-bar/IME insets and uses the original artwork. Runtime JavaScript remains local and xterm/fit now have pinned, reproducible build inputs.

`jaunt gui` installs/opens the verified desktop app. The installer also adds it on graphical hosts when its release is advertised. The documented upload/path versus conditional native clipboard/Ctrl+V distinction is preserved; no Enter is sent automatically.

The protocol remains independently unaudited. Emulator and isolated CLI startup tests are not physical-phone tests or proof of every authenticated Claude Code/Codex workflow. See `docs/WORKSPACE_VALIDATION.md`.
