# Memory Index

## Project
- [jaunt project overview](./project_jaunt_overview.md) — Core architecture, goals, dependencies, and docs locations for the Jaunt project
- [cairn repository structure](./project_cairn_structure.md) — Complete structure, CI/CD, packaging, and release setup of the cairn reference repo at /home/emeric/code/cairn, used as a model for jaunt
- [cairn CI/CD architecture](./project_cairn_cicd.md) — All workflow files, scripts, secrets, versioning logic, and publishing strategy in complete detail

## cairn-p2p Rust API
- [cairn-p2p Rust crate public API](./project_cairn_rs_api.md) — Complete API: all structs, enums, methods, factory functions for the cairn-p2p crate at /home/emeric/code/cairn/packages/rs/cairn-p2p/
- [cairn transport-to-api wiring architecture](./project_cairn_wiring_architecture.md) — Complete architectural picture: ApiNode internals, transport_connector injection point, connect() flow, send/dispatch_incoming, pairing payload, SwarmController, session/ApiSession distinction, test coverage, conformance runner status

## Snag Project (/home/emeric/code/snag)
- [project_snag_current_state.md](./project_snag_current_state.md) — Current state: fully implemented (NOT pre-impl), git history, known issues
- [project_snag_cargo_issue.md](./project_snag_cargo_issue.md) — nix crate `pty` feature issue in nix 0.29 and how it was resolved
- [project_snag_protocol.md](./project_snag_protocol.md) — Complete wire protocol: framing, all Request/Response types, socket path logic, DaemonClient API
