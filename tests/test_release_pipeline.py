"""Exercise the release queue against real temporary Git remotes and injected APIs."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess

import pytest

SPEC = importlib.util.spec_from_file_location('release_pipeline', Path(__file__).parents[1] / 'scripts/release_pipeline.py')
pipeline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pipeline)
ROOT = Path(__file__).parents[1]


BASELINE = {'host': 'v0.1.0-beta.41', 'desktop': 'desktop-v0.1.0-beta.33', 'android': 'android-v0.1.0-beta.31'}


def git(*args, cwd=None):
    return subprocess.check_output(['git', *args], cwd=cwd, text=True, stderr=subprocess.DEVNULL).strip()


@pytest.fixture
def repository(tmp_path, monkeypatch):
    remote = tmp_path / 'remote.git'
    checkout = tmp_path / 'checkout'
    git('init', '--bare', str(remote))
    git('clone', str(remote), str(checkout))
    monkeypatch.chdir(checkout)
    monkeypatch.setenv('GIT_AUTHOR_NAME', 'fixture')
    monkeypatch.setenv('GIT_AUTHOR_EMAIL', 'fixture@example.invalid')
    monkeypatch.setenv('GIT_COMMITTER_NAME', 'fixture')
    monkeypatch.setenv('GIT_COMMITTER_EMAIL', 'fixture@example.invalid')
    monkeypatch.setenv('GITHUB_RUN_ID', '123')
    monkeypatch.setenv('GITHUB_REPOSITORY', 'owner/fixture')
    monkeypatch.setenv('JAUNT_AUTO_RELEASE_ENABLED', 'true')
    for name in ('ANDROID_KEYSTORE_BASE64', 'ANDROID_STORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'):
        monkeypatch.setenv(name, 'test-fixture')
    names = pipeline.VERSION_FILES | {'scripts/build_release.py', 'scripts/prepare_web.mjs',
                                     'scripts/check_desktop_package.mjs', 'scripts/check_project.py'}
    names |= {f'.github/workflows/{name}.yml' for name in ('release', 'desktop', 'android', 'pages')}
    for name in names:
        target = checkout / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text((ROOT / name).read_text())
    # Release builds run these tests on a version-bumped commit: pin the
    # fixture baseline so expectations never depend on the checkout's versions.
    pipeline.bump_tree(checkout, pipeline.COMPONENTS, BASELINE, 'fixture', 'fixture baseline', 31)
    git('add', '.')
    git('commit', '-m', 'baseline')
    git('branch', '-M', 'main')
    config = json.loads(Path('web/config.json').read_text())
    tags = {c: config[pipeline.CONFIG[c]] for c in pipeline.COMPONENTS}
    for tag in tags.values():
        git('tag', tag)
    git('push', 'origin', 'main', '--tags')
    base = git('rev-parse', 'HEAD')
    receipts = {c: {'tag': t, 'sha': base, 'hashes': {'fixture': 'verified'}} for c, t in tags.items()}
    state = {'schema': 1, 'cursor': base, 'tags': tags, 'pending': None, 'receipts': receipts, 'history': []}
    published = {t: copy.deepcopy(receipts[c]) for c, t in tags.items()}
    outputs = []
    monkeypatch.setattr(pipeline, 'bootstrap', lambda: copy.deepcopy(state))
    monkeypatch.setattr(pipeline, 'validate_checks', lambda sha: True)
    monkeypatch.setattr(pipeline, 'release_verify', lambda tag, component, expected_sha=None: published.get(tag))
    monkeypatch.setattr(pipeline, 'output', lambda value: outputs.append(value))
    def commit(name, contents, subject='fix: product'):
        p = Path(name)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(contents)
        git('add', name)
        git('commit', '-m', subject)
        git('push', 'origin', 'main')
        return git('rev-parse', 'HEAD')
    return {'base': base, 'outputs': outputs, 'published': published, 'commit': commit, 'remote': remote, 'tags': tags}


def test_harness_test_command_does_not_publish(repository):
    pkg = json.loads(Path('package.json').read_text())
    pkg['scripts']['test'] += ' tests/new_harness.test.mjs'
    repository['commit']('package.json', json.dumps(pkg), 'test: harness')
    repository['commit']('scripts/linear_agent.mjs', '// harness')
    head = repository['commit']('docs/change.md', 'docs')
    pipeline.prepare()
    state, _ = pipeline.state_load()
    assert state['cursor'] == head and state['pending'] is None
    assert repository['outputs'][-1] == {'publish': False}
    assert not state['history']


@pytest.mark.parametrize(('name', 'components'), [
    ('web/new.mjs', ['android', 'desktop', 'host']),
    ('host/jaunt/locales/new.json', ['android', 'desktop', 'host']),
    ('host/jaunt/new.py', ['host']), ('pyproject.toml', ['host']),
    ('install.sh', ['android', 'desktop', 'host']),
    ('desktop/new.cjs', ['desktop']), ('android/new.java', ['android']),
    ('relay/new.mjs', ['relay']), ('scripts/prepare_web.mjs', ['android', 'desktop', 'host']),
    ('scripts/build_release.py', ['host']), ('scripts/check_desktop_package.mjs', ['desktop']),
    ('scripts/check_project.py', ['android', 'desktop', 'host']),
    ('scripts/dev.py', []), ('tests/new.py', []), ('.agents/skills/new.md', []),
    ('.github/workflows/ci.yml', []), ('scripts/release_pipeline.py', []),
])
def test_component_boundaries(repository, name, components):
    assert pipeline.affected('HEAD', 'HEAD', [name]) == components


def test_package_dependency_and_build_command_are_product(repository):
    pkg = json.loads(Path('package.json').read_text())
    pkg['dependencies']['new-product-lib'] = '1.0.0'
    head = repository['commit']('package.json', json.dumps(pkg))
    assert pipeline.affected(head + '^', head) == ['android', 'desktop', 'host']


def test_transitive_build_script_and_deleted_dependency(repository):
    repository['commit']('scripts/build_helper.py', 'print("helper")')
    parent = Path('scripts/build_release.py')
    repository['commit'](str(parent), parent.read_text() + '\nimport build_helper\n')
    assert pipeline.affected('HEAD', 'HEAD', ['scripts/build_helper.py']) == ['host']
    git('rm', 'scripts/build_helper.py')
    parent.write_text(parent.read_text().replace('import build_helper', '# removed helper'))
    git('add', str(parent)); git('commit', '-m', 'remove helper')
    assert pipeline.affected('HEAD^', 'HEAD', ['scripts/build_helper.py']) == ['host']


def test_dynamic_build_command_fails_closed(repository):
    pkg = json.loads(Path('package.json').read_text())
    pkg['scripts']['prepare-web'] = 'node "$BUILD_SCRIPT"'
    repository['commit']('package.json', json.dumps(pkg))
    with pytest.raises(ValueError, match='Dynamic build'):
        pipeline.affected('HEAD^', 'HEAD')


def test_prepare_immutable_child_and_resume(repository):
    source = repository['commit']('web/new.mjs', '// product')
    pipeline.prepare()
    first, old = pipeline.state_load()
    pending = first['pending']
    assert pending['source'] == source
    assert git('rev-parse', pending['sha'] + '^') == source
    assert set(git('diff', '--name-only', source, pending['sha']).splitlines()) <= pipeline.VERSION_FILES
    assert pending['tags'] == {'host': 'v0.1.0-beta.42', 'desktop': 'desktop-v0.1.0-beta.34', 'android': 'android-v0.1.0-beta.32'}
    assert 'versionCode 32' in pipeline.read_at(pending['sha'], 'android/app/build.gradle')
    assert '0.1.0b42' in pipeline.read_at(pending['sha'], 'host/jaunt/__init__.py')
    assert '0.1.0b42' in pipeline.read_at(pending['sha'], 'pyproject.toml')
    package = json.loads(pipeline.read_at(pending['sha'], 'package-lock.json'))
    assert package['version'] == package['packages']['']['version'] == '0.1.0-beta.34'
    for tag in pending['tags'].values():
        assert git('rev-parse', tag) == pending['sha']
    assert git('rev-parse', 'main') == source  # no version push into protected main
    repository['commit']('host/jaunt/next.py', '# next merge')
    pipeline.prepare()
    resumed, _ = pipeline.state_load()
    assert resumed == first
    assert repository['outputs'][-1]['sha'] == pending['sha']


def test_unvalidated_source_retains_cursor(repository, monkeypatch):
    source = repository['commit']('host/jaunt/new.py', '# app')
    monkeypatch.setattr(pipeline, 'validate_checks', lambda sha: False)
    pipeline.prepare()
    state, _ = pipeline.state_load()
    assert state['cursor'] == repository['base']
    assert state['pending'] is None
    assert source not in git('tag', '--list')


def test_disabled_cannot_bootstrap_or_tag(repository, monkeypatch):
    repository['commit']('web/new.mjs', '// app')
    monkeypatch.setenv('JAUNT_AUTO_RELEASE_ENABLED', '')
    pipeline.prepare()
    assert pipeline.state_load() == (None, None)
    assert repository['outputs'][-1] == {'publish': False}


def test_atomic_push_conflict_retains_checkpoint(repository, monkeypatch):
    source = repository['commit']('web/new.mjs', '// app')
    git('tag', 'release-source-' + source, repository['base'])
    git('push', 'origin', 'refs/tags/release-source-' + source)
    with pytest.raises(RuntimeError, match='git push failed'):
        pipeline.prepare()
    state, _ = pipeline.state_load()
    assert state['pending'] is None
    remote_tags = git('ls-remote', '--tags', 'origin')
    assert 'v0.1.0-beta.42' not in remote_tags


def test_stale_state_writer_cannot_overwrite(repository):
    pipeline.prepare()
    state, old = pipeline.state_load()
    state['history'].append({'one': 1})
    pipeline.state_save(state, old)
    state['history'].append({'two': 2})
    with pytest.raises(RuntimeError, match='git push failed'):
        pipeline.state_save(state, old)
    assert pipeline.state_load()[0]['history'] == [{'one': 1}]


def test_partial_publication_skips_verified_component(repository):
    repository['commit']('web/new.mjs', '// app')
    pipeline.prepare()
    state, _ = pipeline.state_load()
    p = state['pending']
    repository['published'][p['tags']['host']] = {'sha': p['sha'], 'hashes': {'wheel': 'verified'}}
    pipeline.prepare()
    result = repository['outputs'][-1]
    assert not result['host'] and result['android'] and result['desktop']
    assert result['sha'] == p['sha']


def test_variables_failure_does_not_acknowledge_or_choose_new_version(repository, monkeypatch):
    repository['commit']('web/new.mjs', '// app')
    pipeline.prepare()
    state, _ = pipeline.state_load(); p = state['pending']
    for tag in p['tags'].values():
        repository['published'][tag] = {'sha': p['sha'], 'hashes': {'fixture': 'verified'}}
    monkeypatch.setenv('RELEASE_SHA', p['sha']); monkeypatch.setenv('RELEASE_TOKEN', 'fixture-not-a-secret')
    writes = []
    def api(path, *args):
        writes.append(path)
        if len(writes) == 2:
            raise RuntimeError('permission denied')
    monkeypatch.setattr(pipeline, 'api', api)
    with pytest.raises(RuntimeError, match='permission denied'):
        pipeline.promote()
    failed, _ = pipeline.state_load()
    assert failed['cursor'] == repository['base']
    assert failed['pending']['sha'] == p['sha']
    pipeline.failed()
    assert pipeline.state_load()[0]['pending']['status'] == 'failed'


def test_public_page_mismatch_never_delivers(repository, monkeypatch):
    repository['commit']('web/new.mjs', '// app'); pipeline.prepare()
    state, _ = pipeline.state_load(); p = state['pending']
    monkeypatch.setenv('RELEASE_SHA', p['sha'])
    monkeypatch.setattr(pipeline, 'public_config', lambda: {})
    monkeypatch.setattr(pipeline.time, 'sleep', lambda _: None)
    with pytest.raises(ValueError, match='Public Pages'):
        pipeline.finish()
    assert pipeline.state_load()[0]['pending']['sha'] == p['sha']


def test_finish_drains_next_source_even_without_new_notification(repository, monkeypatch):
    first = repository['commit']('host/jaunt/one.py', '# first'); pipeline.prepare()
    state, old = pipeline.state_load(); p = state['pending']
    p['receipts'] = {}
    pipeline.state_save(state, old)
    second = repository['commit']('host/jaunt/two.py', '# second')
    config = {pipeline.CONFIG[c]: tag for c, tag in p['tags'].items()}
    config['releaseSource'] = first
    monkeypatch.setattr(pipeline, 'public_config', lambda: config)
    monkeypatch.setenv('RELEASE_SHA', p['sha'])
    real_run = pipeline.run
    dispatch = []
    def run(*args, **kwargs):
        if args[:3] == ('gh', 'workflow', 'run'):
            dispatch.append(args)
            return ''
        return real_run(*args, **kwargs)
    monkeypatch.setattr(pipeline, 'run', run)
    for tag in p['tags'].values():
        repository['published'][tag] = {'sha': p['sha']}
    pipeline.finish()
    assert pipeline.state_load()[0]['history'][-1]['status'] == 'delivered'
    assert len(dispatch) == 1
    pipeline.prepare()
    assert pipeline.state_load()[0]['pending']['source'] == second
    assert pipeline.state_load()[0]['pending']['tags']['host'] == 'v0.1.0-beta.43'


def assets(root, files):
    for name, data in files.items():
        (root / name).write_bytes(data)
    (root / 'SHA256SUMS').write_text(''.join(hashlib.sha256(data).hexdigest() + '  ' + name + '\n' for name, data in files.items()))


def test_host_assets_exact_inventory_and_hashes(tmp_path):
    wheel = 'jaunt_host-0.1.0b42-py3-none-any.whl'
    data = b'wheel bytes'
    manifest = json.dumps({'wheel': wheel, 'sha256': hashlib.sha256(data).hexdigest()}).encode()
    assets(tmp_path, {wheel: data, 'host-manifest.json': manifest})
    assert len(pipeline.verify_assets(tmp_path, 'host')) == 2
    (tmp_path / wheel).write_bytes(b'corrupt')
    with pytest.raises(ValueError, match='checksum mismatch'):
        pipeline.verify_assets(tmp_path, 'host')


@pytest.mark.parametrize('bad', ['../secret', 'x/../../secret', 'SHA256SUMS', '.', '..'])
def test_checksum_paths_are_not_followed(tmp_path, bad):
    (tmp_path / 'SHA256SUMS').write_text('0' * 64 + '  ' + bad + '\n')
    with pytest.raises(ValueError, match='checksum'):
        pipeline.verify_assets(tmp_path, 'host')


def test_missing_desktop_architecture_fails(tmp_path):
    assets(tmp_path, {'desktop-x64.tar.gz': b'a'})
    with pytest.raises(ValueError, match='Missing desktop'):
        pipeline.verify_assets(tmp_path, 'desktop')


def test_android_certificate_is_required(tmp_path):
    assets(tmp_path, {'app.apk': b'apk'})
    with pytest.raises(ValueError, match='Android'):
        pipeline.verify_assets(tmp_path, 'android')


def test_duplicate_checksum_fails(tmp_path):
    assets(tmp_path, {'app.apk': b'apk', 'SIGNING-CERTIFICATE.txt': b'cert'})
    checks = tmp_path / 'SHA256SUMS'
    checks.write_text(checks.read_text() + checks.read_text().splitlines()[0] + '\n')
    with pytest.raises(ValueError, match='duplicate'):
        pipeline.verify_assets(tmp_path, 'android')


def test_ci_requires_success_for_exact_main_source(monkeypatch):
    monkeypatch.setenv('GITHUB_REPOSITORY', 'owner/fixture')
    runs = [{'id': 10, 'head_sha': 'source', 'head_branch': 'main', 'event': 'push',
             'run_number': 10, 'run_attempt': 1, 'status': 'completed', 'conclusion': 'success'}]
    jobs = [{'name': 'lint', 'conclusion': 'success'}, {'name': 'test', 'conclusion': 'success'}]
    monkeypatch.setattr(pipeline, 'pages', lambda path, field: runs if field == 'workflow_runs' else jobs)
    assert pipeline.validate_checks('source')
    jobs[1]['conclusion'] = 'skipped'
    assert not pipeline.validate_checks('source')
    jobs[1]['conclusion'] = 'success'; runs[0]['head_branch'] = 'feature'
    assert not pipeline.validate_checks('source')


def test_release_verify_refuses_wrong_tag_target(repository, monkeypatch):
    # Restore the real verifier; never download assets from a mismatched target.
    verifier = SPEC.loader.get_code('release_pipeline')
    namespace = {'__name__': 'test_verifier'}
    exec(verifier, namespace)
    namespace['pages'] = lambda path: [{'tag_name': repository['tags']['host'], 'draft': False}]
    with pytest.raises(ValueError, match='different commit'):
        namespace['release_verify'](repository['tags']['host'], 'host', 'f' * 40)


def test_preflight_rejects_other_publication_and_does_not_log_token(monkeypatch, capsys):
    monkeypatch.setenv('GITHUB_REPOSITORY', 'owner/fixture')
    monkeypatch.setenv('GITHUB_RUN_ID', '123')
    monkeypatch.setenv('RELEASE_TOKEN', 'never-print-this-fixture')
    monkeypatch.setattr(pipeline, 'pages', lambda *args: [{'id': 456, 'path': '.github/workflows/pages.yml',
                      'event': 'workflow_dispatch', 'html_url': 'https://example.invalid/run/456'}])
    with pytest.raises(ValueError, match='Another publication'):
        pipeline.preflight()
    monkeypatch.setattr(pipeline, 'pages', lambda *args: [])
    calls = []
    def api(path, method='GET', payload=None, token=None):
        calls.append((method, payload, token))
        return {'value': 'existing-public-tag'}
    monkeypatch.setattr(pipeline, 'api', api)
    probes = []
    monkeypatch.setattr(pipeline, 'probe_tag_push', probes.append)
    pipeline.preflight()
    assert probes == [['existing-public-tag'] * 3]
    assert sum(c[0] == 'PATCH' for c in calls) == 3
    assert all(c[1]['value'] == 'existing-public-tag' for c in calls if c[0] == 'PATCH')
    assert 'never-print-this-fixture' not in capsys.readouterr().out


def test_real_desktop_package_architecture_names(tmp_path):
    names = ['amd64.deb', 'arm64.deb', 'x86_64.rpm', 'aarch64.rpm',
             'x64.tar.gz', 'arm64.tar.gz', 'x64.zip', 'arm64.zip', 'x64.dmg', 'arm64.dmg']
    assets(tmp_path, {'jaunt-desktop-0.1.0-beta.33-' + name: b'package' for name in names})
    assert len(pipeline.verify_assets(tmp_path, 'desktop')) == 10


def test_missing_selected_authority_creates_no_tags(repository, monkeypatch):
    source = repository['commit']('relay/new.mjs', '// relay change')
    monkeypatch.delenv('CLOUDFLARE_API_TOKEN')
    with pytest.raises(ValueError, match='CLOUDFLARE_API_TOKEN'):
        pipeline.prepare()
    state, _ = pipeline.state_load()
    assert state['pending'] is None
    assert state['cursor'] == repository['base']
    assert 'release-source-' + source not in git('ls-remote', '--tags', 'origin')


@pytest.mark.parametrize('interruption', ['bundle-upload', 'asset-upload', 'bundle-delete', 'publish-response'])
def test_draft_resume_keeps_original_build_bytes(tmp_path, monkeypatch, interruption):
    local = tmp_path / 'build'; local.mkdir()
    assets(local, {'app.apk': b'original build', 'SIGNING-CERTIFICATE.txt': b'cert'})
    tag = 'android-v0.1.0-beta.32'; sha = '1' * 40
    receipt = {'pending': {'tags': {'android': tag}, 'components': ['android'], 'sha': sha}}
    monkeypatch.setenv('GITHUB_REPOSITORY', 'owner/fixture')
    monkeypatch.setattr(pipeline, 'state_load', lambda: (receipt, 'state'))
    monkeypatch.setattr(pipeline, 'git', lambda *args: sha if args[0] == 'rev-parse' else '')
    remote = {'release': None, 'assets': {}, 'once': False}
    def inventory():
        return {**remote['release'], 'assets': [{'name': name, 'state': 'uploaded', 'size': len(data), 'id': name}
                                                for name, data in remote['assets'].items()]}
    monkeypatch.setattr(pipeline, 'pages', lambda *args: [inventory()] if remote['release'] else [])
    def api(*args):
        raise AssertionError('Draft lookup must use authenticated release inventory, not REST tag lookup')
    monkeypatch.setattr(pipeline, 'api', api)
    def interrupt(stage):
        if stage == interruption and not remote['once']:
            remote['once'] = True
            raise RuntimeError('connection lost after server accepted operation')
    def run(*args, **kw):
        action = args[2]
        if action == 'create':
            remote['release'] = {'tag_name': tag, 'draft': True}
        elif action == 'upload':
            path = Path(args[4]); remote['assets'][path.name] = path.read_bytes()
            interrupt('bundle-upload' if path.name == pipeline.BUNDLE else 'asset-upload')
        elif action == 'download':
            directory = Path(args[args.index('--dir') + 1])
            names = [args[args.index('--pattern') + 1]] if '--pattern' in args else list(remote['assets'])
            for name in names:
                (directory / name).write_bytes(remote['assets'][name])
        elif action == 'delete-asset':
            del remote['assets'][args[4]]; interrupt('bundle-delete')
        elif action == 'edit':
            remote['release']['draft'] = False; interrupt('publish-response')
        else:
            raise AssertionError(args)
        return ''
    monkeypatch.setattr(pipeline, 'run', run)
    monkeypatch.setattr(pipeline, 'release_verify', lambda *args: True)
    with pytest.raises(RuntimeError, match='connection lost'):
        pipeline.publish(local, 'android', tag)
    # A rebuild is intentionally different. Resume must retain the frozen bytes.
    assets(local, {'app.apk': b'nonreproducible rebuild', 'SIGNING-CERTIFICATE.txt': b'cert'})
    pipeline.publish(local, 'android', tag)
    assert not remote['release']['draft']
    assert pipeline.BUNDLE not in remote['assets']
    assert remote['assets']['app.apk'] == b'original build'
    verified = tmp_path / 'verified'; verified.mkdir()
    for name, data in remote['assets'].items():
        (verified / name).write_bytes(data)
    pipeline.verify_assets(verified, 'android')


def test_staging_bundle_cannot_escape(tmp_path):
    import zipfile
    bundle = tmp_path / 'bad.zip'
    with zipfile.ZipFile(bundle, 'w') as archive:
        archive.writestr('../outside', 'bad')
    with pytest.raises(ValueError, match='path'):
        pipeline.unpack_bundle(bundle, tmp_path / 'target')
    assert not (tmp_path / 'outside').exists()


GITHUB_WORKFLOW_GUARD = """#!/bin/sh
# Mirrors GitHub: a GITHUB_TOKEN ref may not differ from main in workflow files.
main=$(git rev-parse refs/heads/main) || exit 1
while read old new ref; do
  case "$ref" in refs/tags/*) ;; *) continue ;; esac
  [ "$new" = 0000000000000000000000000000000000000000 ] && continue
  if [ "$(git rev-parse "$new:.github/workflows")" != "$(git rev-parse "$main:.github/workflows")" ]; then
    echo "refusing to allow a GitHub App to create or update workflow without workflows permission" >&2
    exit 1
  fi
done
"""


def guard_workflows(repository):
    hook = repository['remote'] / 'hooks/pre-receive'
    hook.write_text(GITHUB_WORKFLOW_GUARD)
    hook.chmod(0o755)


def test_release_tag_carries_main_workflows_when_main_changed_them_later(repository):
    guard_workflows(repository)
    source = repository['commit']('host/jaunt/new.py', '# app')
    workflow = '.github/workflows/android.yml'
    main = repository['commit'](workflow, Path(workflow).read_text() + '# later CI change\n', 'ci: later')
    pipeline.prepare()
    pending, _ = pipeline.state_load()
    pending = pending['pending']
    assert pending['source'] == source and pending['tags']['host'] == 'v0.1.0-beta.42'
    assert git('rev-parse', pending['sha'] + '^') == source
    assert pipeline.read_at(pending['sha'], workflow) == pipeline.read_at(main, workflow)
    changed = set(git('diff', '--name-only', source, pending['sha']).splitlines())
    assert changed - pipeline.VERSION_FILES == {workflow}
    assert git('rev-parse', 'v0.1.0-beta.42') == pending['sha']


def test_preflight_probe_creates_and_removes_release_shaped_tag(repository):
    guard_workflows(repository)
    workflow = '.github/workflows/android.yml'
    repository['commit'](workflow, Path(workflow).read_text() + '# later CI change\n', 'ci: later')
    pipeline.probe_tag_push(list(repository['tags'].values()))
    assert 'jaunt-preflight' not in git('ls-remote', '--tags', 'origin')


def test_preflight_probe_reports_refused_tag_creation(repository):
    hook = repository['remote'] / 'hooks/pre-receive'
    hook.write_text('#!/bin/sh\necho "refusing to allow a GitHub App" >&2\nexit 1\n')
    hook.chmod(0o755)
    with pytest.raises(ValueError, match='GITHUB_TOKEN cannot create release tags'):
        pipeline.probe_tag_push(list(repository['tags'].values()))
