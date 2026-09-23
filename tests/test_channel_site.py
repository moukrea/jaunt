"""Channel pages assembly against real temporary Git remotes and an injected GitHub API and Page."""
import importlib.util
import json
import os
from pathlib import Path

import pytest

from test_channel_release import channel, channel_state, github, publish_all  # noqa: F401  (fixture)
from test_release_pipeline import pipeline, repository  # noqa: F401  (fixture)

ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location('channel_site', ROOT / 'scripts/channel_site.py')
site = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(site)

PAGE = 'https://moukrea.github.io/jaunt/'
REPOSITORY = 'moukrea/jaunt'


def deliver(github, number, content, login='moukrea'):
    github['open'](number, content, login=login)
    channel.prepare(number)
    name = f'{login.lower()}_{number}'
    candidate = channel_state()['channels'][name]['candidates'][-1]
    publish_all(github, candidate)
    channel.record(candidate['sha'])
    github['world']['releases'] += [{'id': len(github['world']['releases']), 'tag_name': t, 'draft': False}
                                    for t in candidate['tags'].values()]
    github['world']['pulls'][number]['title'] = f'feat: pull {number}'
    return candidate


@pytest.fixture
def public(monkeypatch):
    documents = {}
    monkeypatch.setattr(site, 'fetch', lambda path: json.loads(json.dumps(documents.get(path))))
    monkeypatch.setattr(site.time, 'sleep', lambda seconds: None)
    monkeypatch.setenv('JAUNT_PAGE_URL', PAGE)
    return documents


def outputs(github):
    return github['outputs'][-1]


def test_selects_latest_delivered_candidate_of_live_channels(github):
    deliver(github, 9, '# first')
    second = deliver(github, 9, '# second')
    github['open'](9, '# third')
    channel.prepare(9)  # publishing: not yet a page
    github['open'](12, '# failed')
    channel.prepare(12)
    channel.failed(channel_state()['channels']['moukrea_12']['candidates'][0]['sha'])
    deliver(github, 14, '# removed')
    channel.cleanup(14)
    chosen = site.selected(channel_state())
    assert [(c['name'], c['n'], c['sha']) for c in chosen] == [('moukrea_9', 2, second['sha'])]
    assert chosen[0]['tags'] == second['tags'] and chosen[0]['source'] == second['source']
    assert site.selected(None) == []


def test_plan_redeploys_last_delivered_production_only_when_channels_change(github, public, monkeypatch):
    candidate = deliver(github, 9, '# first')
    site.plan()
    production = pipeline.state_load()[0]
    assert outputs(github) == {'site': True, 'sha': github['base'], 'source': github['base'],
                               **{c + '_tag': t for c, t in production['tags'].items()}}
    entry = {'name': 'moukrea_9', 'pr': 9, 'n': 1, 'release': candidate['tags']['host'],
             'desktopRelease': candidate['tags']['desktop'], 'androidRelease': candidate['tags']['android'],
             'releaseSource': candidate['source'], 'title': 'renamed later'}
    public[site.INDEX] = {'version': 1, 'channels': [entry]}
    site.plan()
    assert outputs(github) == {'site': False}  # a title is display text only
    channel.cleanup(9)
    site.plan()
    assert outputs(github)['site'] is True
    public[site.INDEX] = {'version': 1, 'channels': []}
    site.plan()
    assert outputs(github) == {'site': False}
    monkeypatch.setenv('JAUNT_AUTO_RELEASE_ENABLED', 'false')
    public.clear()
    site.plan()
    assert outputs(github) == {'site': False}


def test_plan_follows_history_and_waits_for_pending_production(github, public):
    production, old = pipeline.state_load()
    production['history'].append({'sha': 'b' * 40, 'source': 'a' * 40})
    old = pipeline.state_save(production, old)
    site.plan()
    assert (outputs(github)['sha'], outputs(github)['source']) == ('b' * 40, 'a' * 40)
    production['pending'] = {'status': 'failed'}
    pipeline.state_save(production, old)
    site.plan()
    assert outputs(github) == {'site': False}


def web(root, name, tags, **patch):
    directory = root / f'channel-web-{name}'
    (directory / 'js').mkdir(parents=True)
    (directory / 'index.html').write_text(name)
    config = {'version': 1, 'relay': 'wss://relay.test', 'page': PAGE, 'repository': REPOSITORY,
              'release': tags['host'], 'desktopRelease': tags['desktop'], 'androidRelease': tags['android']}
    config.update(patch)
    (directory / 'config.json').write_text(json.dumps(config))
    return directory


@pytest.fixture
def production_web(tmp_path):
    root = tmp_path / 'web'
    root.mkdir()
    (root / 'config.json').write_text(json.dumps({'version': 1, 'page': PAGE, 'repository': REPOSITORY}))
    return root


def test_assemble_binds_documents_lists_channels_and_drops_invalid_ones(github, production_web, tmp_path):
    good = deliver(github, 9, '# good')
    bad = deliver(github, 12, '# wrong tag')
    linked = deliver(github, 14, '# symlink')
    deliver(github, 16, '# never built')
    webs = tmp_path / 'webs'
    web(webs, 'moukrea_9', good['tags'], channel='main', releaseSource='0' * 40)  # always rebound
    web(webs, 'moukrea_12', bad['tags'], release=good['tags']['host'])
    os.symlink('/etc/passwd', web(webs, 'moukrea_14', linked['tags']) / 'js' / 'leak')
    chosen = site.selected(channel_state())
    site.assemble(production_web, webs, chosen)
    document = json.loads((production_web / 'ch/moukrea_9/config.json').read_text())
    assert document['channel'] == 'moukrea_9' and document['releaseSource'] == good['source']
    assert (production_web / 'ch/moukrea_9/index.html').read_text() == 'moukrea_9'
    assert sorted(p.name for p in (production_web / 'ch').iterdir()) == ['index.json', 'moukrea_9']
    index = json.loads((production_web / site.INDEX).read_text())
    assert index == {'version': 1, 'page': PAGE, 'repository': REPOSITORY, 'channels': [
        {'name': 'moukrea_9', 'pr': 9, 'n': 1, 'release': good['tags']['host'],
         'desktopRelease': good['tags']['desktop'], 'androidRelease': good['tags']['android'],
         'releaseSource': good['source'], 'title': 'feat: pull 9'}]}
    assert outputs(github) == {'channels': json.dumps(index['channels'], separators=(',', ':')),
                               'dropped': 'moukrea_12,moukrea_14,moukrea_16'}


def test_assemble_requires_published_releases_and_a_fresh_site(github, production_web, tmp_path):
    candidate = deliver(github, 9, '# first')
    for release in github['world']['releases']:
        release['draft'] = True
    web(tmp_path / 'webs', 'moukrea_9', candidate['tags'])
    site.assemble(production_web, tmp_path / 'webs', site.selected(channel_state()))
    assert outputs(github)['dropped'] == 'moukrea_9'
    assert json.loads((production_web / site.INDEX).read_text())['channels'] == []
    with pytest.raises(ValueError, match='already has a ch/'):
        site.assemble(production_web, tmp_path / 'webs', [])


def test_verify_requires_exact_public_channels_and_absent_removed_ones(github, public, production_web, tmp_path):
    good = deliver(github, 9, '# good')
    deliver(github, 12, '# removed')
    channel.cleanup(12)
    web(tmp_path / 'webs', 'moukrea_9', good['tags'])
    site.assemble(production_web, tmp_path / 'webs', site.selected(channel_state()))
    rows = json.loads(outputs(github)['channels'])
    with pytest.raises(ValueError, match='do not match the deployment: ch/index.json'):
        site.verify(rows, [])
    public[site.INDEX] = json.loads((production_web / site.INDEX).read_text())
    public['ch/moukrea_9/config.json'] = json.loads((production_web / 'ch/moukrea_9/config.json').read_text())
    public['ch/moukrea_12/config.json'] = {'stale': True}
    with pytest.raises(ValueError, match='moukrea_12'):
        site.verify(rows, [])
    del public['ch/moukrea_12/config.json']
    site.verify(rows, [])
    public['ch/moukrea_9/config.json']['releaseSource'] = 'f' * 40
    with pytest.raises(ValueError, match='moukrea_9'):
        site.verify(rows, [])
    public['ch/moukrea_9/config.json']['releaseSource'] = good['source']
    with pytest.raises(ValueError, match='not deployed: moukrea_14'):
        site.verify(rows, ['moukrea_14'])
