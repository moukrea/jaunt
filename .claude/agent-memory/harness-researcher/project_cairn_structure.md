---
name: cairn repository structure
description: Complete structure, CI/CD, packaging, and release setup of the cairn repository at /home/emeric/code/cairn — used as reference for replicating the setup in jaunt
type: project
---

## Cairn Repository Overview

A polyglot monorepo for a P2P connectivity library. Five language implementations (Rust, TypeScript, Go, Python, PHP) plus two Rust services, a conformance test suite, a Docusaurus website, and demos.

**Root layout:**
```
Cargo.toml            Rust workspace root
Cargo.lock
packages/
  rs/cairn-p2p/       Rust reference implementation
  ts/cairn-p2p/       TypeScript (npm: cairn-p2p)
  go/cairn-p2p/       Go (module: github.com/moukrea/cairn/packages/go/cairn-p2p)
  py/cairn-p2p/       Python (PyPI: cairn-p2p)
  php/cairn-p2p/      PHP (Packagist: moukrea/cairn-p2p)
services/
  relay/              Rust TURN relay server
  signaling/          Rust WebSocket signaling server
conformance/          Cross-language conformance test suite (Docker)
demo/                 messaging/, folder-sync/, server-node/
docs/                 Design docs, PRD, technical spec
spec/                 Task specs for AI-driven dev
tasks/                AI task markdown files (done/ subdirectory)
tools/                gen-vectors, gen-vectors-extra
website/              Docusaurus site (deployed to GitHub Pages)
.github/
  workflows/
    release.yml       Main release pipeline (push to main)
    tag-release.yml   Publish packages when tags are pushed
    pr.yml            PR validation (change-aware)
    conformance.yml   Cross-language conformance (weekly + manual)
    docs.yml          Deploy Docusaurus to GitHub Pages
    demo-images.yml   Publish Docker demo images on release
  scripts/
    bump-packages.sh  Conventional commit → semver bump + tag
    detect-changes.sh Detect which components changed (for PR workflow)
  cliff.toml          git-cliff changelog config (not actively used in pipelines)
```

## CI/CD Pipeline Design

### release.yml (push to main)
1. Skips if commit message starts with `chore(release):` (prevents infinite loops)
2. Runs all 5 language tests in parallel
3. `version-bump` job: runs `bump-packages.sh`, commits version files, pushes tags
4. Creates GitHub releases with per-component scoped changelogs

### tag-release.yml (on tag push)
Parses tag → determines component → runs appropriate publish job:
- `cairn-p2p-rs-*` → `cargo publish -p cairn-p2p`
- `cairn-p2p-ts-*` → `npm publish --provenance --access public`
- `packages/go/cairn-p2p/v*` → `go build ./...` (Go doesn't need publishing; tag is enough)
- `cairn-p2p-py-*` → `python -m build` + `pypa/gh-action-pypi-publish`
- `cairn-p2p-php-*` → subtree split with splitsh-lite, push to mirror repo `moukrea/cairn-p2p`
- `cairn-relay-*` → Docker push to `ghcr.io/moukrea/cairn-relay`
- `cairn-signal-*` → Docker push to `ghcr.io/moukrea/cairn-signal`

### pr.yml (pull_request to main)
Uses `detect-changes.sh` to only test changed components.
Rust always runs (workspace Cargo.lock changes affect it).

### docs.yml (push to main, paths: website/**)
Builds Docusaurus, deploys to GitHub Pages.

### conformance.yml (manual + weekly cron Sunday 03:00 UTC)
Builds all 5 language Docker images, runs conformance test suite by tier.

### demo-images.yml (on release create)
Matrix build: 10 demo images × 2 platforms (amd64/arm64) + server-node image.
Runs smoke tests after.

## Tag Naming Conventions

| Component | Tag format |
|-----------|-----------|
| Rust lib | `cairn-p2p-rs-{version}` |
| TS lib | `cairn-p2p-ts-{version}` |
| Go lib | `packages/go/cairn-p2p/v{version}` (Go module standard) |
| Python lib | `cairn-p2p-py-{version}` |
| PHP lib | `cairn-p2p-php-{version}` |
| Relay service | `cairn-relay-{version}` |
| Signal service | `cairn-signal-{version}` |

## bump-packages.sh Logic

1. Reads files changed in last commit
2. For each component whose directory has changes:
   - Finds latest tag for that component
   - Analyzes conventional commits since that tag
   - Determines bump type: `major` (breaking `!`), `minor` (`feat`), `patch` (`fix`/`perf`/`refactor`/`build`)
   - Updates version in manifest file (Cargo.toml, package.json, pyproject.toml)
   - Go and PHP have no version file — tag-only versioning
3. Outputs: `has_bumps`, `commit_message`, `bumped` (name:version:tag lines), `tags`
4. Updates Cargo.lock if any Rust component changed

## Required Secrets

- `RELEASE_TOKEN` — PAT for pushing commits/tags from Actions, and PHP mirror repo access
- `CRATES_IO_TOKEN` — for `cargo publish`
- `NPM_TOKEN` — for `npm publish`
- `GITHUB_TOKEN` — built-in, for GHCR pushes and `gh release create`
- PyPI uses OIDC (`id-token: write`) — no secret needed

## Package Manifest Details

### TypeScript (packages/ts/cairn-p2p/package.json)
- `"type": "module"`
- exports: `./dist/index.mjs` (import) and `./dist/index.cjs` (require)
- build: `tsup src/index.ts --format esm,cjs --dts`
- test: vitest, lint: eslint@9 (flat config), typecheck: tsc --noEmit
- tsconfig: target ES2022, module NodeNext, strict, isolatedModules

### Rust (packages/rs/cairn-p2p/Cargo.toml)
- Workspace member, inherits edition/license/repository from root
- lib name: `cairn_p2p`

### Go (packages/go/cairn-p2p/go.mod)
- Module path: `github.com/moukrea/cairn/packages/go/cairn-p2p`
- go 1.24.0

### Python (packages/py/cairn-p2p/pyproject.toml)
- build backend: hatchling
- dev deps: pytest, pytest-asyncio, ruff
- `asyncio_mode = "auto"` in pytest config

### PHP (packages/php/cairn-p2p/composer.json)
- `moukrea/cairn-p2p`, PHP >= 8.2
- scripts: `test` (phpunit), `lint` (phpcs), `check` (phpstan)
- Published via subtree split to mirror repo `moukrea/cairn-p2p` (separate GitHub repo)

## Source Structure Pattern (consistent across languages)

Each package has:
```
src/
  config.*          Configuration types
  errors.*          Error types
  node.*            Main entry point (Node class/struct)
  session.*         Session state machine
  channel.*         Channel abstraction
  crypto/           AEAD, noise, ratchet, hkdf, identity, spake2
  pairing/          PIN, QR, link, PSK pairing mechanisms
  transport/        TCP, NAT, heartbeat, migration
  discovery/        mDNS, DHT, tracker, rendezvous
  mesh/             Router, relay
  server/           Server-mode peer
  protocol/         Wire protocol
tests/
  unit/             Unit tests
  integration/      Integration tests
  conformance/      Cross-language vector tests
```

## Website

Docusaurus 3.7, deployed to `moukrea.github.io/cairn/`.
Docs sections: getting-started, guides, infrastructure, api, demos, internals.
Uses mermaid theme for diagrams.

## Conventional Commits Convention

Used throughout. Release bot reads:
- `feat:` → minor bump
- `fix:`, `perf:`, `refactor:`, `build:` → patch bump
- `type!:` or `type(scope)!:` → major bump
- `chore(release):` → skip (release bot commits)
