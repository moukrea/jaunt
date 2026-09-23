"""Channel publisher against real temporary Git remotes and an injected GitHub API."""
import importlib.util
import json
from pathlib import Path
import sys

import pytest

from test_release_pipeline import git, pipeline, repository  # noqa: F401  (fixture)

ROOT = Path(__file__).parents[1]
# channel_release imports release_pipeline by name: bind it to the fixture's module.
sys.modules['release_pipeline'] = pipeline
SPEC = importlib.util.spec_from_file_location('channel_release', ROOT / 'scripts/channel_release.py')
channel = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(channel)

MAINTAINER = {'role_name': 'maintain', 'permission': 'write'}


@pytest.fixture
def github(repository, monkeypatch):  # noqa: F811
    state = pipeline.bootstrap()
    pipeline.state_save(state, None)
    monkeypatch.setenv('GITHUB_EVENT_NAME', 'pull_request_target')
    monkeypatch.setenv('GITHUB_ACTOR', 'moukrea')
    world = {'pulls': {}, 'roles': {'moukrea': MAINTAINER, 'writer': {'role_name': 'write', 'permission': 'write'}},
             'events': {}, 'releases': [], 'deleted': []}

    def api(path, method='GET', payload=None, token=None):
        parts = path.split('/')
        if parts[3] == 'pulls':
            return json.loads(json.dumps(world['pulls'][int(parts[4])]))
        if parts[3] == 'collaborators':
            return world['roles'].get(parts[4], {'role_name': 'read', 'permission': 'read'})
        if parts[3] == 'releases' and method == 'DELETE':
            world['deleted'].append(int(parts[4]))
            world['releases'] = [r for r in world['releases'] if r['id'] != int(parts[4])]
            return None
        raise AssertionError(path)

    def pages(path, field=None):
        parts = path.split('?')[0].split('/')
        if parts[3] == 'issues':
            return world['events'].get(int(parts[4]), [])
        if parts[3] == 'releases':
            return list(world['releases'])
        raise AssertionError(path)

    monkeypatch.setattr(pipeline, 'api', api)
    monkeypatch.setattr(pipeline, 'pages', pages)

    def open_pull(number, content, login='moukrea', labeler='moukrea', fork=False):
        git('checkout', '-q', '-B', f'pr{number}', 'main')
        Path(f'host/jaunt/pr{number}.py').write_text(content)
        git('add', '.')
        git('commit', '-m', f'feat: pr {number}')
        head = git('rev-parse', 'HEAD')
        git('push', '-f', 'origin', f'HEAD:refs/pull/{number}/head')
        git('checkout', '-q', 'main')
        world['pulls'][number] = {
            'number': number, 'state': 'open', 'user': {'login': login}, 'labels': [{'name': 'channel'}],
            'head': {'sha': head, 'repo': {'full_name': 'someone/fork' if fork else 'owner/fixture'}}}
        world['events'][number] = [{'event': 'labeled', 'label': {'name': 'channel'}, 'actor': {'login': labeler}}]
        return head

    return {**repository, 'world': world, 'open': open_pull}


def channel_state():
    return pipeline.state_load(pipeline.CHANNEL_REF)[0]


def publish_all(github, candidate):
    for component, tag in candidate['tags'].items():
        github['published'][tag] = {'tag': tag, 'sha': candidate['sha'], 'hashes': {'fixture': component}}


def test_candidate_is_an_allowed_child_with_candidate_versions(github):
    head = github['open'](9, '# first')
    channel.prepare(9)
    entry = channel_state()['channels']['moukrea_9']
    candidate, = entry['candidates']
    assert candidate['tags'] == {'host': 'v0.1.0-beta.41.ch.moukrea.9.1',
                                 'desktop': 'desktop-v0.1.0-beta.33.ch.moukrea.9.1',
                                 'android': 'android-v0.1.0-beta.31.ch.moukrea.9.1'}
    sha = candidate['sha']
    assert git('rev-parse', sha + '^') == head
    assert set(git('diff', '--name-only', head, sha).splitlines()) <= pipeline.VERSION_FILES
    assert 'version = "0.1.0b41+ch.moukrea.9.1"' in pipeline.read_at(sha, 'pyproject.toml')
    assert json.loads(pipeline.read_at(sha, 'package.json'))['version'] == '0.1.0-beta.33.ch.moukrea.9.1'
    gradle = pipeline.read_at(sha, 'android/app/build.gradle')
    assert "versionName '0.1.0-beta.31.ch.moukrea.9.1'" in gradle and 'versionCode 31001' in gradle
    for tag in candidate['tags'].values():
        assert git('ls-remote', 'origin', f'refs/tags/{tag}').split()[0] == sha
    assert git('rev-parse', 'origin/main') == github['base']  # production untouched
    assert pipeline.state_load()[0]['tags'] == github['tags']
    assert github['outputs'][-1] == {'publish': True, 'sha': sha, 'channel': 'moukrea_9',
                                     **{c: True for c in pipeline.COMPONENTS},
                                     **{c + '_tag': t for c, t in candidate['tags'].items()}}
    # The publisher accepts exactly the reserved candidate.
    assert pipeline.publication_sha('android', candidate['tags']['android']) == sha
    with pytest.raises(ValueError, match='reserved channel candidate'):
        pipeline.publication_sha('android', 'android-v0.1.0-beta.31.ch.moukrea.9.2')
    with pytest.raises(ValueError, match='reserved channel candidate'):
        pipeline.publication_sha('host', candidate['tags']['android'])


def test_new_head_increments_n_and_k_is_shared_across_channels(github):
    github['open'](9, '# first')
    channel.prepare(9)
    channel.prepare(9)  # same head: resumes, never a second candidate
    assert len(channel_state()['channels']['moukrea_9']['candidates']) == 1
    github['open'](9, '# second')
    channel.prepare(9)
    github['open'](12, '# other', login='Alice')
    channel.prepare(12)
    state = channel_state()
    second = state['channels']['moukrea_9']['candidates'][-1]
    other, = state['channels']['alice_12']['candidates']
    assert second['n'] == 2 and second['tags']['host'].endswith('.ch.moukrea.9.2')
    assert (second['androidCode'], other['androidCode']) == (31002, 31003)
    assert other['n'] == 1 and state['codes'] == {'31': 3}


def test_delivered_candidate_is_not_republished(github):
    github['open'](9, '# first')
    channel.prepare(9)
    candidate = channel_state()['channels']['moukrea_9']['candidates'][0]
    publish_all(github, candidate)
    channel.record(candidate['sha'])
    assert channel_state()['channels']['moukrea_9']['candidates'][0]['status'] == 'delivered'
    channel.prepare(9)
    assert github['outputs'][-1]['publish'] is False


def test_record_refuses_missing_release_and_failed_is_retained(github):
    github['open'](9, '# first')
    channel.prepare(9)
    candidate = channel_state()['channels']['moukrea_9']['candidates'][0]
    with pytest.raises(ValueError, match='Candidate release missing'):
        channel.record(candidate['sha'])
    channel.failed(candidate['sha'])
    assert channel_state()['channels']['moukrea_9']['candidates'][0]['status'] == 'failed'
    channel.prepare(9)  # rerun resumes the same tags
    assert github['outputs'][-1]['sha'] == candidate['sha'] and github['outputs'][-1]['publish'] is True


@pytest.mark.parametrize('case', ['fork', 'writer-label', 'no-label', 'closed', 'reserved', 'hyphen', 'dispatch-writer'])
def test_untrusted_triggers_publish_nothing(github, monkeypatch, case):
    options = {'fork': {'fork': True}, 'writer-label': {'labeler': 'writer'}, 'reserved': {'login': 'main'},
               'hyphen': {'login': 'some-one'}}.get(case, {})
    github['open'](9, '# first', **options)
    pull = github['world']['pulls'][9]
    if case == 'no-label':
        pull['labels'] = []
    if case == 'closed':
        pull['state'] = 'closed'
    if case == 'dispatch-writer':
        monkeypatch.setenv('GITHUB_EVENT_NAME', 'workflow_dispatch')
        monkeypatch.setenv('GITHUB_ACTOR', 'writer')
    reason = {'fork': 'official repository', 'writer-label': 'not applied by a maintainer', 'no-label': 'no channel label',
              'closed': 'not open', 'reserved': 'No publishable channel name', 'hyphen': 'No publishable channel name',
              'dispatch-writer': 'not a maintainer'}[case]
    with pytest.raises(ValueError, match=reason):
        channel.prepare(9)
    assert channel_state() is None
    assert '.ch.' not in git('ls-remote', '--tags', 'origin')


def test_maintainer_dispatch_needs_no_label(github, monkeypatch):
    github['open'](9, '# first')
    github['world']['pulls'][9]['labels'] = []
    monkeypatch.setenv('GITHUB_EVENT_NAME', 'workflow_dispatch')
    channel.prepare(9)
    assert channel_state()['channels']['moukrea_9']['n'] == 1


def test_cleanup_removes_everything_and_replays(github):
    github['open'](9, '# first')
    channel.prepare(9)
    github['open'](9, '# second')
    channel.prepare(9)
    github['open'](12, '# other')
    channel.prepare(12)
    state = channel_state()
    tags = [t for c in state['channels']['moukrea_9']['candidates'] for t in c['tags'].values()]
    kept = list(state['channels']['moukrea_12']['candidates'][0]['tags'].values())
    github['world']['releases'] = [{'id': i, 'tag_name': t} for i, t in enumerate(tags + kept)]
    channel.cleanup(9)
    remote = git('ls-remote', '--tags', 'origin')
    assert not any(t in remote for t in tags) and all(t in remote for t in kept)
    assert sorted(github['world']['deleted']) == list(range(len(tags)))
    assert channel_state()['channels']['moukrea_9']['status'] == 'removed'
    with pytest.raises(ValueError, match='reserved channel candidate'):
        pipeline.publication_sha('host', tags[0])
    before = pipeline.state_load(pipeline.CHANNEL_REF)[1]
    channel.cleanup(9)  # replay: nothing left, nothing written
    assert pipeline.state_load(pipeline.CHANNEL_REF)[1] == before
    # Reopened: a fresh candidate list, but n and k keep increasing.
    channel.prepare(9)
    entry = channel_state()['channels']['moukrea_9']
    assert entry['status'] == 'live' and [c['n'] for c in entry['candidates']] == [3]
    assert entry['candidates'][0]['androidCode'] == 31004


def test_lost_lease_rereads_and_keeps_the_concurrent_write(github, monkeypatch):
    github['open'](9, '# first')
    channel.prepare(9)
    github['open'](12, '# other')
    real = pipeline.state_load
    raced = []

    def racing_load(ref=pipeline.STATE_REF):
        loaded = real(ref)
        if ref == pipeline.CHANNEL_REF and not raced:
            raced.append(True)
            other = json.loads(json.dumps(loaded[0]))
            other['codes']['31'] += 10  # another run reserved codes meanwhile
            pipeline.state_save(other, loaded[1], (), pipeline.CHANNEL_REF)
        return loaded

    monkeypatch.setattr(pipeline, 'state_load', racing_load)
    channel.prepare(12)
    state = channel_state()
    assert state['codes']['31'] == 12
    assert state['channels']['moukrea_12']['candidates'][0]['androidCode'] == 31012
    assert 'moukrea_9' in state['channels']


def test_production_publish_still_requires_its_pending_receipt(github):
    with pytest.raises(ValueError, match='serialized pending receipt'):
        pipeline.publication_sha('host', 'v0.1.0-beta.42')
