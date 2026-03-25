---
name: cairn CI/CD architecture
description: Complete CI/CD setup for the cairn multi-language P2P library — workflows, scripts, versioning, publishing strategy
type: project
---

# cairn CI/CD Architecture

Located at /home/emeric/code/cairn

## Repository Structure

```
packages/rs/cairn-p2p/     Rust reference implementation (Cargo.toml, version 0.2.0)
packages/ts/cairn-p2p/     TypeScript (package.json, version 0.2.0)
packages/go/cairn-p2p/     Go (go.mod: github.com/moukrea/cairn/packages/go/cairn-p2p)
packages/py/cairn-p2p/     Python (pyproject.toml, version 0.2.0)
packages/php/cairn-p2p/    PHP (composer.json: moukrea/cairn-p2p)
services/relay/            TURN relay (Rust)
services/signaling/        WebSocket signaling (Rust)
conformance/               Cross-language conformance test suite
website/                   Docusaurus v3 documentation site
demo/                      Demo applications
```

## GitHub Workflows (.github/workflows/)

### pr.yml — PR Validation
- Trigger: pull_request to main
- Concurrency: cancel-in-progress per branch
- Jobs: detect-changes (runs detect-changes.sh) → conditional test-rust/test-ts/test-go/test-py/test-php
- Rust ALWAYS runs (hardcoded true in detect-changes.sh)
- Other languages only run if their package directory changed

### release.yml — Main Branch Auto-Release
- Trigger: push to main
- Skips commits starting with "chore(release):" to prevent infinite loops
- Jobs: check-skip → test-rust/test-ts/test-go/test-py/test-php → version-bump
- version-bump job:
  - Runs bump-packages.sh (detects conventional commits, bumps semver)
  - Commits changed manifests with "chore(release): bump <summaries>"
  - Creates and pushes git tags
  - Creates GitHub releases with scoped changelogs

### tag-release.yml — Package Publishing (triggered by tags)
- Trigger: push of tags matching component patterns, OR workflow_dispatch
- Tag patterns:
  - cairn-p2p-rs-[0-9]*
  - cairn-p2p-ts-[0-9]*
  - packages/go/cairn-p2p/v[0-9]*  (Go uses special path-based tags)
  - cairn-p2p-py-[0-9]*
  - cairn-p2p-php-[0-9]*
  - cairn-relay-[0-9]*
  - cairn-signal-[0-9]*
- Jobs by component:
  - publish-rust: cargo publish -p cairn-p2p (CARGO_REGISTRY_TOKEN secret)
  - publish-ts: npm publish --provenance --access public (NPM_TOKEN secret, id-token write)
  - publish-go: just verifies build (Go publishing is tag-based, no registry push)
  - publish-py: python -m build + pypa/gh-action-pypi-publish (id-token write, OIDC)
  - publish-php: splitsh-lite subtree split → push to mirror repo moukrea/cairn-p2p (RELEASE_TOKEN)
  - publish-relay: docker build-push to ghcr.io/moukrea/cairn-relay (GITHUB_TOKEN)
  - publish-signal: docker build-push to ghcr.io/moukrea/cairn-signal (GITHUB_TOKEN)

### conformance.yml — Cross-Language Conformance
- Trigger: workflow_dispatch (tier 0/1/2 input) + weekly schedule (Sunday 03:00 UTC)
- Builds all Docker images, runs docker compose, uploads results as artifact (30 day retention)

### docs.yml — Documentation Deploy
- Trigger: push to main affecting website/**
- Builds Docusaurus site, deploys to GitHub Pages

### demo-images.yml — Demo Docker Images
- Trigger: release created OR workflow_dispatch
- Matrix: 10 demo images (messaging+folder-sync × rust/ts/go/py/php) + server-node
- Pushes to ghcr.io/moukrea/cairn-demo-{demo}-{lang} with version + latest tags
- Smoke-tests all images after build

## Scripts (.github/scripts/)

### detect-changes.sh
- Diffs PR against base ref
- Rust always=true
- Other langs: true if packages/{lang}/cairn-p2p/ directory changed
- Also outputs relay/signal/workspace change flags

### bump-packages.sh
- Component list: cairn-p2p-rs, cairn-p2p-ts, cairn-p2p-go, cairn-p2p-py, cairn-p2p-php, cairn-relay, cairn-signal
- Reads changed files from last git commit
- For each changed component: determine_bump() parses conventional commits since last tag
  - breaking (!) → major, feat → minor, fix/perf/refactor/build → patch
- Reads current version from manifest file (Cargo.toml, package.json, pyproject.toml) or git tag (Go, PHP)
- Writes new version back to manifest
- Outputs: has_bumps, commit_message, bumped (name:version:tag per line), tags
- Regenerates Cargo.lock if any Rust component bumped

### cliff.toml
- git-cliff config for changelog generation
- Filters: feat→Features, fix→Bug Fixes, etc.
- Skips chore(release) commits

## Secrets Required
- RELEASE_TOKEN: PAT for pushing release commits to main + PHP mirror repo
- CRATES_IO_TOKEN: crates.io publish
- NPM_TOKEN: npm publish
- GITHUB_TOKEN: auto-provided, used for ghcr.io Docker pushes and gh release create

## Key Design Decisions
- Infinite loop prevention: release.yml checks if commit starts with "chore(release):" and skips
- Go uses path-based tags (packages/go/cairn-p2p/v1.2.3) for Go module proxy compatibility
- PHP uses splitsh-lite to maintain a separate mirror repo (moukrea/cairn-p2p) for Packagist
- PR tests are change-gated (except Rust); release tests run all languages every time
- Version numbers are in manifest files for rs/ts/py; Go and PHP use tags only

**Why:** Saves CI time on PRs while ensuring full validation before release.
**How to apply:** When replicating this pattern, ensure the release workflow always runs all tests regardless of detect-changes, but PR workflow can gate by language.
