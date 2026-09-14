#!/usr/bin/env python3
"""Produce the handoff ZIP from explicit source roots, never runtime state.

Run tests and build_release.py first. The bundle includes their evidence when
present, the release wheel, a per-file checksum inventory and no credentials.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = (
    'START_HERE.md', 'README.md', 'DEPLOY_AGENT_PROMPT.md', 'AGENTS.md',
    'LICENSE', 'SECURITY.md', 'THIRD_PARTY_NOTICES.md', '.gitignore',
    'pyproject.toml', 'requirements-dev.txt', 'package.json', 'install.sh',
)
SOURCE_DIRS = ('.github', 'host/jaunt', 'relay', 'scripts', 'tests', 'web', 'docs')
EXCLUDE_DIRS = {'__pycache__', '.pytest_cache', '.dev-state', 'node_modules', '.wrangler', '.venv', 'evidence'}
EXCLUDE_SUFFIXES = {'.pyc', '.pyo', '.log', '.sock'}
EVIDENCE = ('browser-report.json', 'browser-worker-report.json', 'installer-report.json', 'run-summary.json',
            'desktop-welcome.png', 'desktop-terminal.png', 'desktop-files.png',
            'mobile-welcome.png', 'mobile-terminal.png')


def collect() -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for name in ROOT_FILES:
        files[name] = (ROOT / name).read_bytes()
    # Include only a genuine lockfile, when resolved during deployment/build.
    if (ROOT / 'package-lock.json').exists():
        files['package-lock.json'] = (ROOT / 'package-lock.json').read_bytes()
    for directory in SOURCE_DIRS:
        for path in sorted((ROOT / directory).rglob('*')):
            relative = path.relative_to(ROOT)
            if path.is_symlink():
                raise ValueError(f'Refusing symlink in handoff: {relative}')
            if not path.is_file() or any(part in EXCLUDE_DIRS for part in relative.parts):
                continue
            if path.suffix in EXCLUDE_SUFFIXES or path.name.startswith('.env'):
                continue
            if path.name in {'host.json', 'control.sock', 'state.json'}:
                raise ValueError(f'Unexpected runtime state: {relative}')
            files[relative.as_posix()] = path.read_bytes()
    for name in EVIDENCE:
        path = ROOT / 'test-results' / name
        if path.exists():
            files['docs/evidence/' + name] = path.read_bytes()
    manifest = json.loads((ROOT / 'dist/host-manifest.json').read_text())
    wheel = ROOT / 'dist' / manifest['wheel']
    if wheel.name != manifest['wheel'] or hashlib.sha256(wheel.read_bytes()).hexdigest() != manifest['sha256']:
        raise ValueError('Release wheel/manifest integrity failure')
    for path in (wheel, ROOT / 'dist/host-manifest.json', ROOT / 'dist/SHA256SUMS'):
        files['release/' + path.name] = path.read_bytes()
    files['CHECKSUMS.sha256'] = ''.join(
        f'{hashlib.sha256(content).hexdigest()}  {name}\n'
        for name, content in sorted(files.items())
    ).encode()
    return files


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT.parent / 'Jaunt-0.1.0-beta.1.zip')
    output = parser.parse_args().output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    files = collect()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(files.items()):
            item = zipfile.ZipInfo('jaunt/' + name, date_time=(2026, 9, 14, 0, 0, 0))
            executable = name.endswith('.sh') or (name.startswith('scripts/') and name.endswith('.py'))
            item.create_system = 3
            item.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
            item.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(item, content)
    with zipfile.ZipFile(output) as archive:
        bad = archive.testzip()
        if bad:
            raise ValueError(f'ZIP CRC failure: {bad}')
        for name, content in files.items():
            if archive.read('jaunt/' + name) != content:
                raise ValueError(f'ZIP round-trip mismatch: {name}')
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.zip.sha256').write_text(f'{digest}  {output.name}\n')
    print(f'{output}\n{len(files)} files; {output.stat().st_size:,} bytes\nSHA256 {digest}')


if __name__ == '__main__':
    main()
