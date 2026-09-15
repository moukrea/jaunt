# jaunt 0.1.0-beta.11

Compatible host updates now replace the runtime while preserving ordinary shell processes, their working directories, environment and terminal history. Clients reconnect automatically. Older hosts need one protected migration: their active shells cannot be preserved retroactively, and the installer still requires explicit authorization before terminating them.

The shared workspace fixes squeezed Settings labels, unstable tab positions, mobile history jumps and oversized error messages. Tabs support drag-and-drop ordering and double-click renaming; the desktop sidebar can collapse. Claude and Codex foreground programs use locally bundled Meteor brand icons in tabs and pane captions. Other programs retain the terminal icon.

Web, desktop, Android and CLI support system language detection and explicit English, French, Spanish, Italian, Portuguese and German preferences. English remains the canonical repository documentation, with linked translated copies. The web homepage introduces the project and provides copyable installation commands; native apps open the workspace directly.

The installer offers `--client-only` for a desktop client without installing a local host or exposing local host controls. Update and transfer operations retain visible progress and final results. Desktop windows are titled `jaunt`; the installed web app is named `jaunt (PWA)`. Launcher and web icons use the supplied transparent artwork.

The protocol has not undergone an independent security audit. Physical-phone validation is not claimed. See [the validation report](SEAMLESS_WORKSPACE_VALIDATION.md) for observed tests and remaining platform boundaries.
