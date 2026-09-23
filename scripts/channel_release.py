#!/usr/bin/env python3
"""Channel publisher (docs/UPDATES.md#update-channels). Invoked only by channel.yml; never stores secrets.

A candidate is three prerelease tags `<production tag>.ch.<developer>.<pr>.<n>`
on a generated child of the pull request head. Reservations live on CHANNEL_REF,
apart from the production receipt ledger, and are pushed atomically with the tags.
Production tags, numbering and receipts are only read here.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release_pipeline as rp  # noqa: E402
import update_channels as uc  # noqa: E402

LABEL = 'channel'
TRUSTED = {'admin', 'maintain'}
ATTEMPTS = 3


def empty():
    # codes: last Android candidate counter k per production base code, shared by
    # every channel so that a candidate published later is always installable.
    return {'schema': 1, 'codes': {}, 'channels': {}}


def remote_head():
    refs = rp.git('ls-remote', 'origin', rp.CHANNEL_REF).split()
    return refs[0] if refs else None


def update(change):
    """Apply `change` to the freshest channel state; only a lost lease re-reads and retries.

    `change(state)` returns (result, refs): refs None means nothing to write,
    otherwise they are pushed atomically with the new state.
    """
    for _ in range(ATTEMPTS):
        state, old = rp.state_load(rp.CHANNEL_REF)
        state = state or empty()
        result, refs = change(state)
        if refs is None:
            return result
        try:
            rp.state_save(state, old, refs, rp.CHANNEL_REF)
            return result
        except RuntimeError:
            if remote_head() == old:
                raise
    raise RuntimeError('Channel state kept changing; rerun the channel workflow')


def role(login):
    value = rp.api(f'{rp.repo()}/collaborators/{login}/permission')
    return value.get('role_name') or value.get('permission')


def trusted_pull(number):
    """The publication trigger is the authority over what a channel installs: check it again from the API."""
    pull = rp.api(f'{rp.repo()}/pulls/{number}')
    if pull['state'] != 'open':
        raise ValueError('Pull request is not open')
    if (pull['head'].get('repo') or {}).get('full_name') != os.environ['GITHUB_REPOSITORY']:
        raise ValueError('Channel candidates are built only from branches of the official repository')
    if os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch':
        actor = os.environ['GITHUB_ACTOR']
        if role(actor) not in TRUSTED:
            raise ValueError(f'{actor} is not a maintainer and may not publish a channel')
        return pull
    if LABEL not in {label['name'] for label in pull['labels']}:
        raise ValueError(f'Pull request has no {LABEL} label')
    events = [e for e in rp.pages(f'{rp.repo()}/issues/{number}/events')
              if e['event'] == 'labeled' and e.get('label', {}).get('name') == LABEL]
    if not events or role(events[-1]['actor']['login']) not in TRUSTED:
        raise ValueError(f'The {LABEL} label was not applied by a maintainer')
    return pull


def channel_name(pull):
    name = f'{pull["user"]["login"].lower()}_{pull["number"]}'
    if not uc.publishable(name):
        raise ValueError(f'No publishable channel name for {pull["user"]["login"]!r}')
    return name


def code_at(tag):
    return int(re.search(r'versionCode (\d+)', rp.read_at(tag, 'android/app/build.gradle'))[1])


def build_commit(head, tags, code, subject):
    with tempfile.TemporaryDirectory() as directory:
        for name in rp.VERSION_FILES:
            p = Path(directory) / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(rp.read_at(head, name) + '\n')
        rp.bump_tree(directory, rp.COMPONENTS, tags, head, subject, code)
        files = {name: (Path(directory) / name).read_text() for name in rp.VERSION_FILES}
    timestamp = rp.git('show', '-s', '--format=%cI', head)
    sha = rp.make_commit(files, head, f'build: {subject}', timestamp, workflows='origin/main')
    changed = {name for name in rp.git('diff', '--name-only', head, sha).splitlines()
               if not name.startswith(rp.WORKFLOWS + '/')}
    if not changed <= rp.VERSION_FILES or rp.git('rev-parse', sha + '^') != head or not rp.same_workflows(sha):
        raise ValueError('Generated candidate is not an allowed child of the pull request head')
    return sha


def find(state, sha):
    for name, channel in state['channels'].items():
        for candidate in channel['candidates']:
            if candidate['sha'] == sha:
                return name, channel, candidate
    raise ValueError(f'No reserved candidate for {sha}')


def prepare(number):
    rp.git('fetch', 'origin', 'main', '--tags')
    pull = trusted_pull(number)
    name = channel_name(pull)
    head = pull['head']['sha']
    rp.git('fetch', 'origin', f'refs/pull/{number}/head')
    if rp.git('rev-parse', 'FETCH_HEAD') != head:
        raise ValueError('Pull request head moved; its own event publishes the new head')
    production, _ = rp.state_load()
    if not production:
        raise ValueError('No production receipt yet: a candidate extends the delivered production tags')
    bases = production['tags']

    def change(state):
        channel = state['channels'].setdefault(name, {'pr': number, 'status': 'live', 'n': 0, 'candidates': []})
        write = channel['status'] != 'live'
        if write:
            # Reopened after cleanup: its tags are gone, but n keeps increasing.
            channel.update(status='live', candidates=[])
        candidate = next((c for c in channel['candidates'] if c['source'] == head), None)
        if candidate:
            return candidate, [] if write else None
        n = channel['n'] + 1
        tags = {c: uc.candidate_tag(bases[c], name, n) for c in rp.COMPONENTS}
        base = code_at(bases['android'])
        k = state['codes'].get(str(base), 0) + 1
        code = uc.candidate_code(base, k)
        sha = build_commit(head, tags, code, f'channel {name} candidate {n}')
        channel['n'] = n
        state['codes'][str(base)] = k
        candidate = {'n': n, 'source': head, 'sha': sha, 'tags': tags, 'androidCode': code,
                     'status': 'publishing', 'run': os.environ['GITHUB_RUN_ID']}
        channel['candidates'].append(candidate)
        return candidate, [f'{sha}:refs/tags/{tag}' for tag in tags.values()]

    candidate = update(change)
    for tag in candidate['tags'].values():
        rp.git('fetch', 'origin', f'refs/tags/{tag}:refs/tags/{tag}')
    publish = candidate['status'] != 'delivered'
    values = {'publish': publish, 'sha': candidate['sha'], 'channel': name}
    for c in rp.COMPONENTS:
        values[c + '_tag'] = candidate['tags'][c]
        values[c] = publish and not rp.release_verify(candidate['tags'][c], c, candidate['sha'])
    if publish:
        rp.summary(f'Channel `{name}` candidate {candidate["n"]} for `{head}`: build commit `{candidate["sha"]}`, '
                   f'Android versionCode {candidate["androidCode"]}.')
    else:
        rp.summary(f'Channel `{name}` already published `{head}` as candidate {candidate["n"]}.')
    rp.output(values)


def record(sha):
    state, _ = rp.state_load(rp.CHANNEL_REF)
    _, _, candidate = find(state or empty(), sha)
    for tag in candidate['tags'].values():
        rp.git('fetch', 'origin', f'refs/tags/{tag}:refs/tags/{tag}')
    receipts = {c: rp.release_verify(tag, c, sha) for c, tag in candidate['tags'].items()}
    missing = [tag for c, tag in candidate['tags'].items() if not receipts[c]]
    if missing:
        raise ValueError('Candidate release missing: ' + ', '.join(missing))

    def change(state):
        name, channel, current = find(state, sha)
        if channel['status'] != 'live':
            raise ValueError(f'Channel {name} was removed while its candidate was building')
        current.update(status='delivered', receipts=receipts, run=os.environ['GITHUB_RUN_ID'])
        return name, []

    name = update(change)
    rp.summary(f'Channel `{name}` candidate {candidate["n"]} delivered: three verified prereleases.')


def failed(sha):
    def change(state):
        try:
            _, _, candidate = find(state, sha)
        except ValueError:
            return None, None
        if candidate['status'] == 'delivered':
            return None, None
        candidate.update(status='failed', run=os.environ['GITHUB_RUN_ID'])
        return None, []

    update(change)
    rp.summary(f'Channel candidate `{sha}` failed. Rerun the channel workflow; its tags and versions are retained.')


def cleanup(number):
    """Delete every release, tag and live entry of the pull request's channel. Safe to replay."""
    pattern = re.compile(rf'.+\.ch\.{uc.DEV}\.{number}\.{uc.COUNT}')
    releases = [r for r in rp.pages(f'{rp.repo()}/releases') if pattern.fullmatch(r['tag_name'])]
    for release in releases:
        rp.api(f'{rp.repo()}/releases/{release["id"]}', 'DELETE')
    refs = [line.split()[1] for line in rp.git('ls-remote', '--tags', 'origin').splitlines()]
    tags = sorted({ref[len('refs/tags/'):] for ref in refs if not ref.endswith('^{}')
                   and pattern.fullmatch(ref[len('refs/tags/'):])})

    def change(state):
        names = [n for n, c in state['channels'].items() if c['pr'] == number and c['status'] != 'removed']
        for n in names:
            state['channels'][n].update(status='removed', run=os.environ['GITHUB_RUN_ID'])
        if not names and not tags:
            return names, None
        return names, [f':refs/tags/{tag}' for tag in tags]

    names = update(change)
    rp.summary(f'Pull request #{number}: removed {len(releases)} prereleases, {len(tags)} tags, '
               f'channels {", ".join(names) or "none"}.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'record', 'failed', 'cleanup'])
    parser.add_argument('--pr', type=int)
    parser.add_argument('--sha')
    args = parser.parse_args()
    if args.command in ('prepare', 'cleanup'):
        if not args.pr or args.pr < 1:
            raise ValueError('--pr is required')
        globals()[args.command](args.pr)
    else:
        if not args.sha or not uc.SOURCE.fullmatch(args.sha):
            raise ValueError('--sha is required')
        globals()[args.command](args.sha)


if __name__ == '__main__':
    main()
