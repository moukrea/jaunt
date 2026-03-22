# Contributing to Jaunt

Thank you for your interest in contributing to Jaunt. This guide covers the development workflow and conventions used in the project.

## Prerequisites

- [Rust](https://rustup.rs/) stable toolchain
- Linux
- [cairn](https://github.com/moukrea/cairn) Rust crate (referenced via path dependency)
- [snag](https://github.com/moukrea/snag) installed for host daemon testing

## Building

```bash
cd jaunt/

# Debug build
cargo build

# Release build
cargo build --release
```

## Testing

```bash
# Run all tests
cargo test --workspace

# Run a specific crate's tests
cargo test -p jaunt-protocol

# Run tests with stdout visible
cargo test --workspace -- --nocapture
```

## Code Quality

```bash
# Lint (warnings treated as errors)
cargo clippy --workspace --all-targets -- -D warnings

# Check formatting
cargo fmt --check

# Auto-format
cargo fmt
```

All three checks must pass before a PR will be merged.

## Project Structure

```
jaunt/
├── Cargo.toml                    # workspace root
├── crates/
│   ├── jaunt-protocol/           # shared RPC types + connection profile
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── messages.rs       # request/response enums
│   │       └── profile.rs        # ConnectionProfile struct
│   ├── jaunt-host/               # host daemon binary
│   │   └── src/
│   │       ├── main.rs
│   │       ├── node.rs           # cairn node setup + event handling
│   │       ├── profile.rs        # connection profile generation
│   │       ├── snag.rs           # snag bridge (CLI mode)
│   │       ├── files.rs          # file browser
│   │       ├── approval.rs       # device approval logic
│   │       └── config.rs         # configuration
│   └── jaunt-client/             # CLI client binary
│       └── src/
│           ├── main.rs
│           ├── commands.rs       # command handlers
│           └── config.rs         # client config + hosts
└── docs/
    ├── jaunt-prd.md
    └── jaunt-tech-spec.md
```

## Commit Messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

Examples:

```
feat(host): add file browser with path validation
fix(client): handle reconnection on network change
docs(readme): add infrastructure tiers section
```

## Pull Requests

1. Fork the repository and create a branch from `main`
2. Make your changes
3. Ensure `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo fmt --check` all pass
4. Write a clear PR description explaining what changed and why
5. Submit the PR

## Architecture Notes

Key design constraints:

- **Jaunt owns nothing below it.** Sessions belong to snag, networking belongs to cairn. Jaunt is glue + UX.
- **cairn does all networking.** Pairing, transport, encryption, reconnection, signaling, relay.
- **Single-threaded async.** Both host and client use `tokio` with `current_thread` runtime.
- **CLI-based snag bridge.** The host daemon shells out to the `snag` binary. Unix socket direct integration is planned for Phase 4.
- **Connection profiles.** The mechanism for multi-tier client support. QR/link pairing embeds cairn infrastructure config.
