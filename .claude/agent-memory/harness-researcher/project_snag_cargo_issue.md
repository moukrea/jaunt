---
name: snag Cargo.toml nix features issue
description: Known issue with nix crate features in Cargo.toml — pty feature does not exist in nix 0.29
type: project
---

The harness log shows a build failure on 2026-03-22T15:30:15Z:

```
error: failed to select a version for `nix`.
package `snag` depends on `nix` with feature `pty` but `nix` does not have that feature.
package `nix` does have feature `aio`
```

The current Cargo.toml has:
```toml
nix = { version = "0.29", features = ["term", "fs", "process", "signal", "user"] }
```

The `pty` feature was removed in nix 0.29. The Cargo.toml in the repo was already fixed (no `pty` feature listed). The source code uses `nix::pty::openpty` directly — this requires the `pty` feature OR the feature was integrated into the base crate in newer versions.

**How to apply:** If `cargo build` fails with a nix pty feature error, check whether nix 0.29 includes pty in a different feature (e.g., the feature may now be called something else, or openpty may be available without a feature gate). The Cargo.lock exists and was generated successfully after the fix — check it for the resolved nix version.
