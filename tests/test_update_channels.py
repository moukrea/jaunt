"""The update-channel contract: reference implementation against the shared fixtures."""
import copy
import importlib.util
import json
from pathlib import Path

import pytest
from packaging.version import Version
from jaunt import channels as host, updates

ROOT = Path(__file__).parents[1]
FIXTURES = json.loads((ROOT / 'tests/fixtures/update_channels.json').read_text())


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f'scripts/{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


channels = load('update_channels')
pipeline = load('release_pipeline')
CANDIDATES = [case['tag'] for case in FIXTURES['tags']['valid']]


def test_names():
    names = FIXTURES['names']
    assert all(channels.valid_name(name) for name in names['valid'])
    assert not any(channels.valid_name(name) for name in names['invalid'])
    assert all(channels.publishable(name) for name in names['publishable'])
    assert not any(channels.publishable(name) for name in names['notPublishable'] + names['invalid'])


@pytest.mark.parametrize('case', FIXTURES['tags']['valid'], ids=lambda case: case['tag'])
def test_candidate_tags_round_trip(case):
    info = channels.parse(case['tag'])
    assert (info['component'], info['base'], info['channel'], info['n']) == (case['component'], case['base'], case['channel'], case['n'])
    assert channels.candidate_tag(case['base'], case['channel'], case['n']) == case['tag']
    if 'python' in case:
        assert channels.python_version(case['tag']) == case['python']
        assert Version(channels.python_version(case['base'])) < Version(case['python'])


@pytest.mark.parametrize('tag', FIXTURES['tags']['invalid'])
def test_invalid_candidate_tags(tag):
    with pytest.raises(ValueError):
        channels.parse(tag)


def test_order_and_incomparable_channels():
    for low, high in FIXTURES['order']['ascending']:
        assert channels.compare(low, high) == -1 and channels.compare(high, low) == 1
    for a, b in FIXTURES['order']['notComparable']:
        with pytest.raises(channels.NotComparable):
            channels.compare(a, b)


@pytest.mark.parametrize('case', FIXTURES['automatic'], ids=lambda case: f"{case['channel']}:{case['current']}->{case['target']}")
def test_automatic_updates_never_cross_a_channel(case):
    assert channels.automatic(case['channel'], case['current'], case['target']) is case['install']


def test_android_codes_keep_every_candidate_below_the_next_release():
    android = FIXTURES['android']
    for previous, expected in android['nextProductionCode']:
        assert channels.next_production_code(previous) == expected
    for case in android['candidateCode']:
        code = channels.candidate_code(case['base'], case['k'])
        assert code == case['code'] and code < channels.next_production_code(case['base'])
    for case in android['invalidCandidateCode']:
        with pytest.raises(ValueError):
            channels.candidate_code(case['base'], case['k'])
    for case in android['switch']:
        assert channels.android_switch_allowed(case['current'], case['target']) is case['allowed']


def test_channel_documents():
    official = FIXTURES['documents']['official']
    valid = FIXTURES['documents']['valid'][0]
    assert channels.validate_document(valid['document'], valid['name'], official['page'], official['repository'])
    for case in FIXTURES['documents']['invalid']:
        document = copy.deepcopy(valid['document'])
        document.update(case['patch'])
        with pytest.raises(ValueError):
            channels.validate_document(document, case['name'], official['page'], official['repository'])


def test_candidates_never_become_production_versions():
    production = FIXTURES['tags']['production']
    for component in channels.PREFIX:
        tags = [tag for tag in production + CANDIDATES if channels.parse(tag)['component'] == component]
        assert pipeline.next_tag(component, tags) == pipeline.next_tag(component, [tag for tag in tags if tag in production])


def test_host_accepts_host_candidates_and_refuses_everything_else():
    """The host implements channels: its own candidates parse, other components and malformed tags do not."""
    for case in FIXTURES['tags']['valid']:
        if case['component'] == 'host':
            assert updates.version(case['tag'])['channel'] == case['channel']
            assert updates.tag_from_version(case['python']) == case['tag']
        else:
            with pytest.raises(ValueError):
                updates.version(case['tag'])
    for tag in FIXTURES['tags']['invalid']:
        with pytest.raises(ValueError):
            updates.version(tag)


def test_host_channels_agree_with_every_fixture():
    """jaunt.channels reimplements the reference for the wheel; the shared fixtures bind them together."""
    names = FIXTURES['names']
    assert all(host.valid_name(name) for name in names['valid'])
    assert not any(host.valid_name(name) for name in names['invalid'])
    assert all(host.publishable(name) for name in names['publishable'])
    assert not any(host.publishable(name) for name in names['notPublishable'] + names['invalid'])
    for case in FIXTURES['tags']['valid']:
        info = host.parse(case['tag'])
        assert (info['component'], info['base'], info['channel'], info['n']) == (case['component'], case['base'], case['channel'], case['n'])
        assert info == channels.parse(case['tag'])
        if 'python' in case:
            assert host.python_version(case['tag']) == case['python'] and host.host_tag(case['python']) == case['tag']
    for tag in FIXTURES['tags']['invalid']:
        with pytest.raises(ValueError):
            host.parse(tag)
    for tag in FIXTURES['tags']['production']:
        assert host.parse(tag) == channels.parse(tag)
    for low, high in FIXTURES['order']['ascending']:
        assert host.compare(low, high) == -1 and host.compare(high, low) == 1
    for a, b in FIXTURES['order']['notComparable']:
        with pytest.raises(host.NotComparable):
            host.compare(a, b)
    for case in FIXTURES['automatic']:
        assert host.automatic(case['channel'], case['current'], case['target']) is case['install']
    official = FIXTURES['documents']['official']
    valid = FIXTURES['documents']['valid'][0]
    # installation.json stores the Page without its trailing slash; both spellings name the official Page.
    for page in (official['page'], official['page'].rstrip('/')):
        assert host.validate_document(valid['document'], valid['name'], page, official['repository'])
        for case in FIXTURES['documents']['invalid']:
            document = copy.deepcopy(valid['document'])
            document.update(case['patch'])
            with pytest.raises(ValueError):
                host.validate_document(document, case['name'], page, official['repository'])
