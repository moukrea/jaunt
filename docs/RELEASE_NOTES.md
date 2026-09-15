# jaunt 0.1.0-beta.9

New bash sessions now load the login environment and the interactive shell configuration, restoring user command paths and prompts even when `.bash_profile` omits `.bashrc`. Accounts without a `SHELL` environment variable use their configured account shell.

On Ubuntu with restricted user namespaces, `jaunt gui` and graphical installation select the verified system desktop package so AppArmor and sandbox support are installed correctly. System authorization may be requested for the desktop package; the host remains a per-user service.

Program notifications preserve OSC 9 messages and OSC 777 title/body. Companion desktop and Android clients display that content and open the requested session on notification clicks. They use locally bundled Lucide icons, corrected launcher packaging, clearer split-pane controls, and touch/keyboard scroll fixes.

Existing pairing identities and running shells remain protected during automatic updates. Closing a view does not kill its shell; explicit termination remains available from host and clients. Updates still require explicit restart authorization before destroying active ordinary shells.

The protocol has not undergone an independent security audit. Physical-phone validation is not claimed. See the delivery regression report for commands and observed results.
