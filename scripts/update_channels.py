"""Reference implementation of the update-channel contract (docs/UPDATES.md#update-channels).

Clients reimplement these rules in their own language and prove agreement with
tests/fixtures/update_channels.json; the channel publisher imports this module.
"""
import re

PREFIX = {'host': 'v', 'desktop': 'desktop-v', 'android': 'android-v'}
RESERVED = {'main', 'beta'}
DEV = r'[a-z][a-z0-9]{0,31}'
COUNT = r'[1-9][0-9]{0,5}'
NAME = re.compile(rf'{DEV}(?:_{COUNT})?')
# Candidates only extend a prerelease base: a final X.Y.Z has no semver-safe suffix below X.Y.(Z+1).
BASE = r'(\d+)\.(\d+)\.(\d+)-(alpha|beta|rc)\.(\d+)'
PRODUCTION = re.compile(r'(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?')
CANDIDATE = re.compile(rf'{BASE}\.ch\.({DEV})\.({COUNT})\.({COUNT})')
STAGE = {'alpha': 0, 'beta': 1, 'rc': 2, None: 3}
PEP = {'alpha': 'a', 'beta': 'b', 'rc': 'rc'}
SOURCE = re.compile(r'[0-9a-f]{40}')
DOCUMENT = {'host': 'release', 'desktop': 'desktopRelease', 'android': 'androidRelease'}
CODE_STEP = 1000


class NotComparable(ValueError):
    """Two versions from different channels or components: no automatic order exists."""


def valid_name(name):
    return isinstance(name, str) and NAME.fullmatch(name) is not None


def publishable(name):
    """Only a per-PR sub-channel of a non-reserved developer may be published."""
    return valid_name(name) and '_' in name and name.split('_')[0] not in RESERVED


def parse(tag):
    """Split a release tag into its component, production key and optional channel."""
    for component, prefix in PREFIX.items():
        if not isinstance(tag, str) or not tag.startswith(prefix):
            continue
        rest = tag[len(prefix):]
        match = PRODUCTION.fullmatch(rest)
        if match:
            major, minor, patch, stage, number = match.groups()
            return {'component': component, 'key': (int(major), int(minor), int(patch), STAGE[stage], int(number or 0)),
                    'base': tag, 'channel': None, 'n': 0}
        match = CANDIDATE.fullmatch(rest)
        if match and match[6] not in RESERVED:
            major, minor, patch, stage, number, dev, pr, n = match.groups()
            return {'component': component, 'key': (int(major), int(minor), int(patch), STAGE[stage], int(number)),
                    'base': f'{prefix}{major}.{minor}.{patch}-{stage}.{number}', 'channel': f'{dev}_{pr}', 'n': int(n)}
        break
    raise ValueError(f'Unsupported release tag: {tag!r}')


def candidate_tag(base, channel, n):
    if not publishable(channel) or type(n) is not int or not re.fullmatch(COUNT, str(n)):
        raise ValueError('Invalid channel candidate')
    info = parse(base)
    if info['channel'] or info['key'][3] == STAGE[None]:
        raise ValueError('A candidate extends a production prerelease tag')
    dev, pr = channel.split('_')
    return f'{base}.ch.{dev}.{pr}.{n}'


def python_version(tag):
    """PEP 440 runtime version of a host tag; a candidate is a local version between its base and the next."""
    info = parse(tag)
    if info['component'] != 'host':
        raise ValueError('Not a host tag')
    major, minor, patch, stage, number = PRODUCTION.fullmatch(info['base'][1:]).groups()
    version = f'{major}.{minor}.{patch}' + (f'{PEP[stage]}{number}' if stage else '')
    if info['channel']:
        dev, pr = info['channel'].split('_')
        version += f'+ch.{dev}.{pr}.{info["n"]}'
    return version


def compare(a, b):
    """-1, 0 or 1; raises NotComparable across components or between two channels."""
    x, y = parse(a), parse(b)
    if x['component'] != y['component'] or (x['channel'] and y['channel'] and x['channel'] != y['channel']):
        raise NotComparable(f'{a} and {b} are not ordered')
    left = (x['key'], 1 if x['channel'] else 0, x['n'])
    right = (y['key'], 1 if y['channel'] else 0, y['n'])
    return (left > right) - (left < right)


def automatic(channel, current, target):
    """Whether an unattended check on `channel` may install `target` over `current`.

    Only an explicit channel change may install anything else; that decision is never taken here.
    """
    x, y = parse(current), parse(target)
    if x['component'] != y['component']:
        return False
    if channel == 'main':
        return y['channel'] is None and compare(current, target) < 0
    return x['channel'] == y['channel'] == channel and compare(current, target) < 0


def next_production_code(previous):
    """Android production codes are spaced so that every candidate of a base sorts below the next release."""
    return (previous // CODE_STEP + 1) * CODE_STEP if previous >= CODE_STEP else (previous + 1) * CODE_STEP


def candidate_code(base, k):
    if base >= CODE_STEP and base % CODE_STEP or type(k) is not int or not 0 < k < CODE_STEP:
        raise ValueError('Invalid Android candidate code')
    return (base if base >= CODE_STEP else base * CODE_STEP) + k


def android_switch_allowed(current, target):
    """Android refuses a lower or equal versionCode; a switch needing one requires uninstalling."""
    return target > current


def validate_document(document, name, page, repository):
    """Check a fetched ch/<name>/config.json against the requested name and the official installation."""
    if not publishable(name):
        raise ValueError('Reserved or invalid channel name has no channel document')
    if not isinstance(document, dict) or document.get('version') != 1 or document.get('channel') != name:
        raise ValueError('Channel document does not describe the requested channel')
    if document.get('page') != page or document.get('repository') != repository:
        raise ValueError('Channel document is not from the official Page and repository')
    if not isinstance(document.get('releaseSource'), str) or not SOURCE.fullmatch(document['releaseSource']):
        raise ValueError('Channel document has no verified release source')
    counts = set()
    for component, field in DOCUMENT.items():
        info = parse(document.get(field))
        if info['component'] != component or info['channel'] != name:
            raise ValueError(f'{field} is not a {component} candidate of {name}')
        counts.add(info['n'])
    if len(counts) != 1:
        raise ValueError('Channel components come from different candidates')
    return document
