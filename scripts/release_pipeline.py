#!/usr/bin/env python3
"""Serialized release queue. Invoked only by auto-release.yml; never stores secrets.

The state branch is an append-only receipt ledger, not a development branch.
A pending receipt and its immutable tags are pushed atomically. Publication may
be retried, but a delivered source is acknowledged only after public verification.
"""
from __future__ import annotations

import argparse
import asyncio
import secrets
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update_channels  # noqa: E402

STATE_REF = 'refs/heads/jaunt-release-state'
# Channel candidates live on their own ref: a channel write can never fail a
# production lease, and production never waits for a channel (JAU-82).
CHANNEL_REF = 'refs/heads/jaunt-channel-state'
COMPONENTS = ('host', 'desktop', 'android')
PREFIX = {'host': 'v', 'desktop': 'desktop-v', 'android': 'android-v'}
CONFIG = {'host': 'release', 'desktop': 'desktopRelease', 'android': 'androidRelease'}
NOTES = {'host': 'docs/RELEASE_NOTES.md', 'desktop': 'docs/DESKTOP_RELEASE_NOTES.md',
         'android': 'docs/ANDROID_RELEASE_NOTES.md'}
VERSION_FILES = {'pyproject.toml', 'host/jaunt/__init__.py', 'package.json',
                 'package-lock.json', 'android/app/build.gradle', 'web/config.json', *NOTES.values()}
ALL = set(COMPONENTS)
# GITHUB_TOKEN cannot hold the workflows permission, and GitHub refuses a new
# ref from it whose workflow files differ from the default branch. Every ref the
# runner creates therefore carries main's workflow tree, which the calling
# run on main uses anyway: reusable workflows resolve from the caller's commit.
WORKFLOWS = '.github/workflows'
CONTROL = {'scripts/release_pipeline.py', 'scripts/channel_site.py'}


def run(*args, cwd=None, data=None, env=None):
    result = subprocess.run(args, cwd=cwd, input=data, text=True, capture_output=True,
                            env={**os.environ, **(env or {})})
    if result.returncode:
        # No command/env dump: authentication must never appear in diagnostics.
        raise RuntimeError(f'{args[0]} {args[1] if len(args) > 1 else ""} failed: {result.stderr[-2000:]}')
    return result.stdout.strip()


def git(*args, **kw):
    return run('git', *args, **kw)


def api(path, method='GET', payload=None, token=None):
    args = ['gh', 'api', path, '--method', method]
    if payload is not None:
        args += ['--input', '-']
    text = run(*args, data=json.dumps(payload) if payload is not None else None,
               env={'GH_TOKEN': token} if token else None)
    return json.loads(text) if text else None


def repo():
    value = os.environ['GITHUB_REPOSITORY']
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', value):
        raise ValueError('Invalid repository')
    return f'repos/{value}'


def pages(path, field=None):
    result = []
    for page in range(1, 1001):
        value = api(f'{path}{"&" if "?" in path else "?"}per_page=100&page={page}')
        rows = value[field] if field else value
        result.extend(rows)
        if len(rows) < 100:
            return result
    raise RuntimeError('Pagination limit reached; refusing partial inventory')


def read_at(ref, name):
    try:
        return git('show', f'{ref}:{name}')
    except RuntimeError:
        # Distinguish absent paths from invalid refs/corrupt repositories.
        git('rev-parse', '--verify', f'{ref}^{{commit}}')
        if name not in git('ls-tree', '-r', '--name-only', ref).splitlines():
            return ''
        raise


def commands(text):
    """Local script references in workflow shell commands / package scripts."""
    return set(re.findall(r'(?<![\w/])(?:\./)?(scripts/[\w./-]+\.(?:py|mjs|cjs|js|sh))', text))


def build_graph(ref):
    graph = {}
    roots = {'release': {'host'}, 'desktop': {'desktop'}, 'android': {'android'}, 'pages': ALL}
    for workflow, components in roots.items():
        workflow_text = read_at(ref, f'.github/workflows/{workflow}.yml')
        if re.search(r'(?:node|python\d*|bash|npm run)\s+["\']?\$', workflow_text):
            raise ValueError(f'Dynamic workflow build command needs an explicit dependency: {workflow}')
        for name in commands(workflow_text):
            # The coordinator and the site assembler are control-plane code, not shipped product.
            if name not in CONTROL:
                graph.setdefault(name, set()).update(components)
    pkg = json.loads(read_at(ref, 'package.json') or '{}')
    scripts = pkg.get('scripts', {})
    pending = [k for k in scripts if k == 'prepare-web' or k.startswith('build:') or k in ('prepack', 'postpack')]
    seen = set()
    while pending:
        key = pending.pop()
        if key in seen:
            continue
        seen.add(key)
        command = scripts.get(key)
        if command is None:
            raise ValueError(f'Unresolved build command: {key}')
        if re.search(r'(?:node|python\d*|bash|npm run)\s+["\']?\$', command):
            raise ValueError(f'Dynamic build command needs an explicit dependency: {key}')
        pending.extend(re.findall(r'npm run ([\w:-]+)', command))
        for name in commands(command):
            graph.setdefault(name, set()).update(ALL)
    queue = list(graph)
    while queue:
        name = queue.pop()
        text = read_at(ref, name)
        if not text:
            raise ValueError(f'Unresolved build dependency at {ref}: {name}')
        refs = commands(text)
        for local in re.findall(r'(?:from\s*|import\s*\(|require\s*\()["\'](\.[^"\']+)["\']', text):
            path = PurePosixPath(name).parent / local
            parts = []
            for part in path.parts:
                if part == '..':
                    if not parts:
                        raise ValueError('Build import escapes repository')
                    parts.pop()
                elif part != '.':
                    parts.append(part)
            refs.add('/'.join(parts))
        # Python sibling modules are discovered from their actual import sites.
        for module in re.findall(r'^\s*(?:from|import) ([A-Za-z_]\w*)', text, re.M):
            sibling = str(PurePosixPath(name).parent / (module + '.py'))
            if read_at(ref, sibling):
                refs.add(sibling)
        if re.search(r'(?:import|require)\s*\(\s*(?!["\'\s])[^)]', text):
            raise ValueError(f'Dynamic build import needs an explicit dependency: {name}')
        for child in refs:
            before = graph.get(child, set()).copy()
            graph.setdefault(child, set()).update(graph[name])
            if before != graph[child]:
                queue.append(child)
    # prepare-web shares assets across all clients, irrespective of direct caller.
    if 'scripts/prepare_web.mjs' in graph:
        graph['scripts/prepare_web.mjs'].update(ALL)
    return graph


def affected(before, after, changed=None):
    names = changed if changed is not None else git('diff', '--name-only', '--no-renames', before, after).splitlines()
    graphs = [build_graph(before), build_graph(after)]
    result = set()
    for name in names:
        if name == 'package.json':
            old_pkg = json.loads(read_at(before, name) or '{}')
            new_pkg = json.loads(read_at(after, name) or '{}')
            for pkg in (old_pkg, new_pkg):
                pkg['scripts'] = {k: v for k, v in pkg.get('scripts', {}).items()
                                  if k == 'prepare-web' or k.startswith('build:') or k in ('prepack', 'postpack')}
            if old_pkg != new_pkg:
                result.update(ALL)
        elif name.startswith(('web/', 'host/jaunt/locales/')) or name in ('install.sh', 'package-lock.json'):
            result.update(ALL)
        elif name.startswith('host/') or name == 'pyproject.toml':
            result.add('host')
        elif name.startswith('desktop/'):
            result.add('desktop')
        elif name.startswith('android/'):
            result.add('android')
        elif name.startswith('relay/'):
            result.add('relay')
        for graph in graphs:
            result.update(graph.get(name, set()))
    return sorted(result)


def next_tag(component, tags):
    prefix = PREFIX[component]
    versions = []
    for tag in tags:
        match = re.fullmatch(re.escape(prefix) + r'(\d+)\.(\d+)\.(\d+)-beta\.(\d+)', tag)
        if match:
            versions.append(tuple(map(int, match.groups())))
    if not versions:
        raise ValueError(f'No beta baseline for {component}; version policy needs explicit migration')
    major, minor, patch, number = max(versions)
    return f'{prefix}{major}.{minor}.{patch}-beta.{number + 1}'


def bump_tree(root, selected, tags, source, subject, android_code):
    root = Path(root)
    def replace(name, pattern, value):
        p = root / name
        text, count = re.subn(pattern, lambda m: value(m), p.read_text(), count=1, flags=re.M)
        if count != 1:
            raise ValueError(f'Version field not found: {name}')
        p.write_text(text)
    for component in selected:
        if component not in COMPONENTS:
            continue
        version = tags[component][len(PREFIX[component]):]
        if component == 'host':
            python_version = update_channels.python_version(tags[component])
            replace('pyproject.toml', r'^version = "[^"]+"', lambda m: f'version = "{python_version}"')
            # pyproject version is not the first line; handle multiline separately below.
            replace('host/jaunt/__init__.py', r'__version__ = "[^"]+"', lambda m: f'__version__ = "{python_version}"')
        elif component == 'desktop':
            for name in ('package.json', 'package-lock.json'):
                p = root / name
                value = json.loads(p.read_text())
                value['version'] = version
                if name == 'package-lock.json':
                    value['packages']['']['version'] = version
                p.write_text(json.dumps(value, indent=2) + '\n')
        else:
            replace('android/app/build.gradle', r"versionName '[^']+'", lambda m: f"versionName '{version}'")
            replace('android/app/build.gradle', r'versionCode \d+', lambda m: f'versionCode {android_code}')
        notes = root / NOTES[component]
        notes.write_text(f'# jaunt {component} {version}\n\n- {subject}\n- Source: `{source}`.\n\n' + notes.read_text())
    config_path = root / 'web/config.json'
    config = json.loads(config_path.read_text())
    config.update({CONFIG[k]: v for k, v in tags.items()})
    config_path.write_text(json.dumps(config, indent=2) + '\n')


def state_load(ref=STATE_REF):
    refs = git('ls-remote', 'origin', ref).split()
    if not refs:
        return None, None
    git('fetch', 'origin', ref)
    sha = git('rev-parse', 'FETCH_HEAD')
    return json.loads(read_at(sha, 'state.json')), sha


def make_commit(files, parent=None, message='Record release receipt', timestamp=None, workflows=None):
    with tempfile.TemporaryDirectory() as directory:
        env = {'GIT_INDEX_FILE': str(Path(directory) / 'index'),
               'GIT_AUTHOR_NAME': 'jaunt release', 'GIT_AUTHOR_EMAIL': 'release@users.noreply.github.com',
               'GIT_COMMITTER_NAME': 'jaunt release', 'GIT_COMMITTER_EMAIL': 'release@users.noreply.github.com'}
        if timestamp:
            env.update(GIT_AUTHOR_DATE=timestamp, GIT_COMMITTER_DATE=timestamp)
        git('read-tree', parent if parent else '--empty', env=env)
        if workflows:
            git('rm', '-r', '--cached', '-f', '-q', '--ignore-unmatch', WORKFLOWS, env=env)
            git('read-tree', f'--prefix={WORKFLOWS}/', f'{workflows}:{WORKFLOWS}', env=env)
        for name, content in files.items():
            blob = git('hash-object', '-w', '--stdin', data=content)
            git('update-index', '--add', '--cacheinfo', f'100644,{blob},{name}', env=env)
        tree = git('write-tree', env=env)
        return git('commit-tree', tree, *(['-p', parent] if parent else []), data=message + '\n', env=env)


def state_save(state, old, extra_refs=(), ref=STATE_REF):
    sha = make_commit({'state.json': json.dumps(state, indent=2) + '\n'}, old)
    git('push', '--atomic', f'--force-with-lease={ref}:{old or ""}', 'origin', f'{sha}:{ref}', *extra_refs)
    return sha


def same_workflows(sha, main='origin/main'):
    return git('rev-parse', f'{sha}:{WORKFLOWS}') == git('rev-parse', f'{main}:{WORKFLOWS}')


def validate_checks(source):
    runs = pages(f'{repo()}/actions/workflows/ci.yml/runs?head_sha={source}', 'workflow_runs')
    candidates = [r for r in runs if r['head_sha'] == source and r['head_branch'] == 'main'
                  and r['event'] in ('push', 'workflow_dispatch')]
    if not candidates:
        return False
    latest = max(candidates, key=lambda r: (r['run_number'], r.get('run_attempt', 1)))
    if latest['status'] != 'completed' or latest['conclusion'] != 'success':
        return False
    checks = pages(f'{repo()}/actions/runs/{latest["id"]}/jobs', 'jobs')
    return all(any(j['name'] == name and j['conclusion'] == 'success' for j in checks) for name in ('lint', 'test'))


def verify_assets(directory, component):
    root = Path(directory)
    names = {p.name for p in root.iterdir() if p.is_file()}
    rows = (root / 'SHA256SUMS').read_text().splitlines()
    checks = {}
    for row in rows:
        match = re.fullmatch(r'([0-9a-f]{64})  ([^/\\]+)', row)
        if not match or match[2] in ('.', '..', 'SHA256SUMS') or match[2] in checks:
            raise ValueError('Invalid or duplicate checksum entry')
        checks[match[2]] = match[1]
    if set(checks) != names - {'SHA256SUMS'} or not checks:
        raise ValueError('Checksum manifest does not cover the exact asset inventory')
    for name, digest in checks.items():
        if hashlib.sha256((root / name).read_bytes()).hexdigest() != digest:
            raise ValueError(f'Asset checksum mismatch: {name}')
    if component == 'host':
        manifest = json.loads((root / 'host-manifest.json').read_text())
        wheel = manifest['wheel']
        if set(checks) != {'host-manifest.json', wheel} or not re.fullmatch(r'jaunt_host-[\w.]+(\+[a-z0-9.]+)?-py3-none-any.whl', wheel):
            raise ValueError('Invalid host asset inventory')
        if manifest['sha256'] != checks[wheel]:
            raise ValueError('Host manifest hash mismatch')
    elif component == 'android':
        if 'SIGNING-CERTIFICATE.txt' not in checks or len(checks) != 2 or sum(n.endswith('.apk') for n in checks) != 1:
            raise ValueError('Invalid Android asset inventory')
    elif component == 'desktop':
        for arch in ('x64', 'arm64'):
            for suffix in (f'-{arch}.tar.gz', f'-{dict(x64="amd64", arm64="arm64")[arch]}.deb', f'-{dict(x64="x86_64", arm64="aarch64")[arch]}.rpm', f'-{arch}.zip', f'-{arch}.dmg'):
                if not any(n.endswith(suffix) for n in checks):
                    raise ValueError(f'Missing desktop package: {suffix}')
    return checks


def release_verify(tag, component, expected_sha=None):
    # Inventory first, so 404 is not confused with auth/network errors.
    releases = pages(f'{repo()}/releases')
    matches = [r for r in releases if r['tag_name'] == tag]
    if not matches:
        return None
    release, = matches
    actual = git('rev-parse', f'{tag}^{{commit}}')
    if expected_sha and actual != expected_sha:
        raise ValueError(f'Tag points at a different commit: {tag}')
    if release['draft']:
        return None  # resumable publisher owns this unpublished staging area
    with tempfile.TemporaryDirectory() as directory:
        run('gh', 'release', 'download', tag, '--repo', os.environ['GITHUB_REPOSITORY'], '--dir', directory)
        hashes = verify_assets(directory, component)
    return {'tag': tag, 'sha': actual, 'url': release['html_url'], 'hashes': hashes}


def require_authority(selected):
    required = []
    if 'android' in selected:
        required += ['ANDROID_KEYSTORE_BASE64', 'ANDROID_STORE_PASSWORD', 'ANDROID_KEY_ALIAS']
    if 'relay' in selected:
        required += ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise ValueError('Selected publication authority unavailable: ' + ', '.join(missing))


BUNDLE = 'jaunt-release-staging.zip'


def unpack_bundle(bundle, destination):
    with zipfile.ZipFile(bundle) as archive:
        for entry in archive.infolist():
            if PurePosixPath(entry.filename).name != entry.filename or entry.filename in ('.', '..') or entry.is_dir():
                raise ValueError('Invalid staging bundle path')
            if ((entry.external_attr >> 16) & 0o170000) == 0o120000:
                raise ValueError('Staging symlink refused')
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate staging asset')
        archive.extractall(destination)


def publication_sha(component, tag):
    """The build commit a tag may publish: the production pending receipt, or a reserved channel candidate."""
    if '.ch.' not in tag:
        state, _ = state_load()
        pending = state and state['pending']
        if not pending or pending['tags'].get(component) != tag or component not in pending['components']:
            raise ValueError('Publication does not match the serialized pending receipt')
        return pending['sha']
    info = update_channels.parse(tag)
    state, _ = state_load(CHANNEL_REF)
    channel = state and state['channels'].get(info['channel'])
    candidate = channel and channel['status'] == 'live' and next(
        (c for c in channel['candidates'] if c['tags'].get(component) == tag), None)
    if info['component'] != component or not candidate:
        raise ValueError('Publication does not match a reserved channel candidate')
    return candidate['sha']


def publish(directory, component, tag):
    """Freeze build bytes in one draft asset, then resume missing uploads.

    The temporary bundle is uploaded before any advertised asset. It allows a
    later run to reuse the ORIGINAL bytes even if a rebuild is nondeterministic.
    Never replace a published asset or a completed staging asset.
    """
    sha = publication_sha(component, tag)
    git('fetch', 'origin', f'refs/tags/{tag}:refs/tags/{tag}')
    if git('rev-parse', f'{tag}^{{commit}}') != sha:
        raise ValueError('Publication tag moved')
    releases = pages(f'{repo()}/releases')
    release = next((r for r in releases if r['tag_name'] == tag), None)
    if release and not release['draft']:
        if not release_verify(tag, component, sha):
            raise ValueError('Published release disappeared')
        return
    gh_repo = os.environ['GITHUB_REPOSITORY']
    if not release:
        verify_assets(directory, component)
        run('gh', 'release', 'create', tag, '--repo', gh_repo, '--verify-tag', '--draft', '--prerelease',
            '--title', f'jaunt {component} {tag}', '--notes-file', NOTES[component])
        # REST /releases/tags only resolves published releases, not drafts.
        release, = [r for r in pages(f'{repo()}/releases') if r['tag_name'] == tag]
    with tempfile.TemporaryDirectory() as staging:
        staging = Path(staging)
        inventory = {a['name']: a for a in release['assets']}
        bundle = inventory.get(BUNDLE)
        if bundle and bundle['state'] != 'uploaded':
            # GitHub can leave a zero-length "starter" after an interrupted
            # upload. This is not a published artifact or a completed bundle.
            if set(inventory) != {BUNDLE} or bundle['size'] != 0:
                raise ValueError('Ambiguous incomplete staging bundle')
            api(f'{repo()}/releases/assets/{bundle["id"]}', 'DELETE')
            bundle = None
            inventory = {}
        if bundle:
            run('gh', 'release', 'download', tag, '--repo', gh_repo, '--pattern', BUNDLE, '--dir', str(staging))
            frozen = staging / 'frozen'; frozen.mkdir()
            unpack_bundle(staging / BUNDLE, frozen)
            verify_assets(frozen, component)
        elif inventory:
            # Bundle is removed only after every final asset has been verified.
            frozen = staging / 'frozen'; frozen.mkdir()
            run('gh', 'release', 'download', tag, '--repo', gh_repo, '--dir', str(frozen))
            verify_assets(frozen, component)
        else:
            frozen = Path(directory)
            verify_assets(frozen, component)
            with zipfile.ZipFile(staging / BUNDLE, 'w', compression=zipfile.ZIP_STORED) as archive:
                for asset in sorted(frozen.iterdir()):
                    archive.write(asset, asset.name)
            run('gh', 'release', 'upload', tag, str(staging / BUNDLE), '--repo', gh_repo)
            inventory[BUNDLE] = {'name': BUNDLE}
        expected = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in frozen.iterdir()}
        if set(inventory) - {BUNDLE} - set(expected):
            raise ValueError('Unexpected draft release asset')
        for name, digest in expected.items():
            if name in inventory:
                # Missing/ambiguous server-side starter entries are recoverable
                # only before publication and only from the frozen build bundle.
                asset = inventory[name]
                if asset['state'] != 'uploaded':
                    if BUNDLE not in inventory or asset['size'] != 0:
                        raise ValueError('Ambiguous incomplete draft asset')
                    api(f'{repo()}/releases/assets/{asset["id"]}', 'DELETE')
                else:
                    check = staging / ('check-' + name); check.mkdir()
                    run('gh', 'release', 'download', tag, '--repo', gh_repo, '--pattern', name, '--dir', str(check))
                    if hashlib.sha256((check / name).read_bytes()).hexdigest() != digest:
                        raise ValueError('Existing draft asset differs from frozen build')
                    continue
            run('gh', 'release', 'upload', tag, str(frozen / name), '--repo', gh_repo)
        if BUNDLE in inventory:
            run('gh', 'release', 'delete-asset', tag, BUNDLE, '--repo', gh_repo, '--yes')
        # A retry after this point checks the exact complete final inventory.
        verified = staging / 'verified'; verified.mkdir()
        run('gh', 'release', 'download', tag, '--repo', gh_repo, '--dir', str(verified))
        verify_assets(verified, component)
        run('gh', 'release', 'edit', tag, '--repo', gh_repo, '--draft=false')
    summary(f'Published immutable {component} assets for {tag}.')


def output(values):
    for key, value in values.items():
        line = f'{key}={str(value).lower() if isinstance(value, bool) else value}\n'
        if '\n' in line[:-1]:
            raise ValueError('Multiline output refused')
        with open(os.environ.get('GITHUB_OUTPUT', os.devnull), 'a') as f:
            f.write(line)
    print(json.dumps(values, indent=2))


def summary(text):
    print(text)
    with open(os.environ.get('GITHUB_STEP_SUMMARY', os.devnull), 'a') as f:
        f.write(text + '\n')


def preflight():
    # Reject legacy/manual publishers that do not participate in this lock.
    for status in ('queued', 'in_progress', 'waiting', 'pending'):
        for item in pages(f'{repo()}/actions/runs?status={status}', 'workflow_runs'):
            if str(item['id']) == os.environ.get('GITHUB_RUN_ID'):
                continue
            path = item.get('path', '').split('@')[0]
            if path in {'.github/workflows/' + n + '.yml' for n in ('release', 'desktop', 'android', 'pages', 'relay')}:
                if item['event'] == 'pull_request' or (item['event'] == 'push' and item['head_branch'] == 'main'):
                    continue
                raise ValueError(f'Another publication workflow is active: {item["html_url"]}')
    token = os.environ.get('RELEASE_TOKEN', '')
    if not token:
        raise ValueError('RELEASE_TOKEN is required for repository Variables: write')
    published = []
    for name in ('JAUNT_RELEASE_TAG', 'JAUNT_DESKTOP_RELEASE_TAG', 'JAUNT_ANDROID_RELEASE_TAG'):
        path = f'{repo()}/actions/variables/{name}'
        current = api(path, token=token)
        # Rewriting the same public value tests the actual permission without
        # advertising an unpublished version. The token never enters state/logs.
        api(path, 'PATCH', {'name': name, 'value': current['value']}, token=token)
        published.append(current['value'])
    summary('Preflight: repository tag variables readable and writable with RELEASE_TOKEN.')
    probe_tag_push(published)


def probe_tag_push(published_tags):
    # Create, then delete, a tag shaped like a release commit on each published
    # base: GitHub refuses GITHUB_TOKEN refs whose workflows differ from main.
    git('fetch', 'origin', 'main', '--tags')
    bases = sorted({git('rev-parse', f'{tag}^{{commit}}') for tag in published_tags})
    for index, base in enumerate(bases):
        probe = make_commit({}, base, 'Probe release tag permission [skip ci]', workflows='origin/main')
        ref = f'refs/tags/jaunt-preflight-{os.environ["GITHUB_RUN_ID"]}-{index}'
        try:
            git('push', 'origin', f'{probe}:{ref}')
        except RuntimeError as error:
            raise ValueError(f'GITHUB_TOKEN cannot create release tags on {base}: {error}') from None
        git('push', 'origin', f':{ref}')
    summary('Preflight: GITHUB_TOKEN created and deleted release-shaped tags.')


def bootstrap():
    config = public_config()
    tags = {c: config[CONFIG[c]] for c in COMPONENTS}
    receipts = {c: release_verify(t, c) for c, t in tags.items()}
    if not all(receipts.values()):
        raise ValueError('Published configuration references absent assets')
    shas = {r['sha'] for r in receipts.values()}
    if len(shas) != 1:
        raise ValueError('Initial component tags differ: reconcile the publication baseline before activation')
    source, = shas
    git('merge-base', '--is-ancestor', source, 'origin/main')
    return {'schema': 1, 'cursor': source, 'tags': tags, 'receipts': receipts,
            'pending': None, 'history': []}


def public_config():
    url = os.environ['JAUNT_PAGE_URL'].rstrip('/') + '/config.json'
    if not url.startswith('https://'):
        raise ValueError('Public page must use HTTPS')
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def prepare():
    git('fetch', 'origin', 'main', '--tags')
    if os.environ.get('JAUNT_AUTO_RELEASE_ENABLED') != 'true':
        summary('Automatic publication disabled. Enable only after exclusive publisher handoff and preflight.')
        output({'publish': False})
        return
    state, old = state_load()
    if state is None:
        state = bootstrap()
        old = state_save(state, old)
    if not state['pending']:
        git('merge-base', '--is-ancestor', state['cursor'], 'origin/main')
        sources = git('rev-list', '--first-parent', '--reverse', f'{state["cursor"]}..origin/main').splitlines()
        for source in sources:
            selected = affected(f'{source}^', source)
            if not selected:
                state['cursor'] = source
                old = state_save(state, old)
                continue
            if not validate_checks(source):
                summary(f'Merged, awaiting successful main CI: `{source}`. No delivery acknowledged.')
                output({'publish': False})
                return
            require_authority(selected)
            tag_list = git('tag', '--list').splitlines()
            tags = dict(state['tags'])
            tags.update({c: next_tag(c, tag_list) for c in selected if c in COMPONENTS})
            # Spaced so that every channel candidate of a base sorts below the next release.
            codes = [int(re.search(r'versionCode (\d+)', read_at(t, 'android/app/build.gradle'))[1])
                     for t in tag_list if t.startswith('android-v') and '.ch.' not in t]
            source_code = int(re.search(r'versionCode (\d+)', read_at(source, 'android/app/build.gradle'))[1])
            with tempfile.TemporaryDirectory() as directory:
                for name in VERSION_FILES:
                    p = Path(directory) / name
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text(read_at(source, name) + '\n')
                bump_tree(directory, selected, tags, source, git('show', '-s', '--format=%s', source),
                          update_channels.next_production_code(max([source_code, *codes])))
                files = {name: (Path(directory) / name).read_text() for name in VERSION_FILES}
            timestamp = git('show', '-s', '--format=%cI', source)
            release_sha = make_commit(files, source, f'build: publish {source}', timestamp, workflows='origin/main')
            changed = {name for name in git('diff', '--name-only', source, release_sha).splitlines()
                       if not name.startswith(WORKFLOWS + '/')}
            if (not changed <= VERSION_FILES or git('rev-parse', release_sha + '^') != source
                    or not same_workflows(release_sha)):
                raise ValueError('Generated release is not an allowed child of validated main')
            state['pending'] = {'source': source, 'sha': release_sha, 'tags': tags, 'components': selected,
                                'status': 'publishing', 'run': os.environ['GITHUB_RUN_ID']}
            refs = [f'{release_sha}:refs/tags/{tags[c]}' for c in selected if c in COMPONENTS]
            # Relay-only releases still need a durable reference for exact checkout.
            refs.append(f'{release_sha}:refs/tags/release-source-{source}')
            old = state_save(state, old, refs)
            break
    pending = state['pending']
    if not pending:
        summary(f'Queue drained through `{state["cursor"]}`; no unpublished product change.')
        output({'publish': False})
        return
    require_authority(pending['components'])
    for c in pending['components']:
        if c in COMPONENTS:
            git('fetch', 'origin', f'refs/tags/{pending["tags"][c]}:refs/tags/{pending["tags"][c]}')
    values = {'publish': True, 'sha': pending['sha'], 'source': pending['source'],
              'relay': 'relay' in pending['components']}
    for c in COMPONENTS:
        values[c + '_tag'] = pending['tags'][c]
        existing = release_verify(pending['tags'][c], c, pending['sha'] if c in pending['components'] else None)
        if c not in pending['components'] and not existing:
            raise ValueError(f'Previously advertised release disappeared: {c}')
        values[c] = c in pending['components'] and not existing
    summary(f'Publication pending for `{pending["source"]}`; immutable build commit `{pending["sha"]}`.')
    output(values)


def promote():
    git('fetch', 'origin', '--tags')
    state, old = state_load()
    p = state['pending']
    if not p or p['sha'] != os.environ['RELEASE_SHA']:
        raise ValueError('Pending release changed')
    receipts = {}
    for c, tag in p['tags'].items():
        receipts[c] = release_verify(tag, c, p['sha'] if c in p['components'] else None)
        if not receipts[c]:
            raise ValueError(f'Release missing: {tag}')
    p['receipts'] = receipts
    state_save(state, old)
    for c, tag in p['tags'].items():
        name = 'JAUNT_' + {'host': 'RELEASE_TAG', 'android': 'ANDROID_RELEASE_TAG', 'desktop': 'DESKTOP_RELEASE_TAG'}[c]
        api(f'{repo()}/actions/variables/{name}', 'PATCH', {'name': name, 'value': tag}, os.environ['RELEASE_TOKEN'])
    summary('All package assets verified. Three advertisement variables updated; Pages may now deploy.')


def finish():
    state, old = state_load()
    p = state['pending']
    if not p or p['sha'] != os.environ['RELEASE_SHA']:
        raise ValueError('Pending release changed')
    for attempt in range(12):
        config = public_config()
        if all(config.get(CONFIG[c]) == tag for c, tag in p['tags'].items()) and config.get('releaseSource') == p['source']:
            break
        if attempt == 11:
            raise ValueError('Public Pages configuration does not match the prepared delivery')
        time.sleep(5)
    p.update(status='delivered', run=os.environ['GITHUB_RUN_ID'])
    state['history'].append(p)
    state.update(cursor=p['source'], tags=p['tags'], receipts=p['receipts'], pending=None)
    state_save(state, old)
    summary(f'Delivered `{p["source"]}`: verified assets and public Pages. Receipt: `{STATE_REF}`.')
    run('gh', 'workflow', 'run', 'auto-release.yml', '--ref', 'main', '--repo', os.environ['GITHUB_REPOSITORY'])


def failed():
    state, old = state_load()
    if state and state['pending']:
        state['pending'].update(status='failed', run=os.environ['GITHUB_RUN_ID'])
        state_save(state, old)
        summary(f'Publication failed for `{state["pending"]["source"]}`. Resume auto-release.yml; versions and checkpoint retained.')


async def relay_probe():
    # Only random test capabilities, carried inside WebSocket frames, never URLs.
    import aiohttp
    url = os.environ['JAUNT_RELAY_URL'].rstrip('/')
    if not url.startswith('wss://'):
        raise ValueError('Relay must use WSS')
    room = secrets.token_urlsafe(18)
    host_token, client_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
        async with session.get('https://' + url[6:] + '/health') as response:
            if response.status != 200 or not (await response.json()).get('ok'):
                raise ValueError('Relay health failed')
        async with session.ws_connect(url + '/v1/room/' + room) as host:
            await host.send_json({'type': 'auth', 'role': 'host', 'token': host_token, 'clientToken': client_token})
            if (await host.receive_json(timeout=10)).get('type') != 'ready':
                raise ValueError('Relay host authentication failed')
            async with session.ws_connect(url + '/v1/room/' + room) as client:
                await client.send_json({'type': 'auth', 'role': 'client', 'token': client_token})
                ready = await client.receive_json(timeout=10)
                if ready.get('type') != 'ready' or not ready.get('hostOnline'):
                    raise ValueError('Relay client authentication failed')
                await host.receive_json(timeout=10)  # peer.joined
                payload = {'probe': secrets.token_hex(16)}
                await client.send_json({'type': 'route', 'data': payload})
                received = await host.receive_json(timeout=10)
                if received.get('data') != payload:
                    raise ValueError('Client to host routing failed')
                await host.send_json({'type': 'route', 'to': received['from'], 'data': payload})
                if (await client.receive_json(timeout=10)).get('data') != payload:
                    raise ValueError('Host to client routing failed')
    summary('Deployed relay: health, capability authentication and bidirectional WebSocket routing passed.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['preflight', 'prepare', 'promote', 'finish', 'failed', 'verify-assets', 'relay-probe', 'publish'])
    parser.add_argument('--directory')
    parser.add_argument('--tag')
    parser.add_argument('--component', choices=COMPONENTS)
    args = parser.parse_args()
    if args.command == 'publish':
        publish(args.directory, args.component, args.tag)
    elif args.command == 'relay-probe':
        asyncio.run(relay_probe())
    elif args.command == 'verify-assets':
        verify_assets(args.directory, args.component)
    else:
        globals()[args.command]()


if __name__ == '__main__':
    main()
