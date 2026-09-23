#!/usr/bin/env python3
"""Channel pages on the public site (docs/DEPLOYMENT.md#channel-pages).

Pages is one site, redeployed whole under jaunt-production-release: production
at the root, plus ch/<name>/ for the latest delivered candidate of each live
channel in jaunt-channel-state, all listed in ch/index.json. Both ledgers are
only read here. This is control-plane code: pages.yml runs it from main, never
from the production or candidate commit it deploys.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release_pipeline as rp  # noqa: E402
import update_channels as uc  # noqa: E402

INDEX = 'ch/index.json'
ATTEMPTS = 12


def selected(state):
    """Latest delivered candidate of each live channel, by name."""
    result = []
    for name, channel in sorted(((state or {}).get('channels') or {}).items()):
        delivered = [c for c in channel['candidates'] if c['status'] == 'delivered']
        if channel['status'] != 'live' or not delivered or not uc.publishable(name):
            continue
        candidate = max(delivered, key=lambda c: c['n'])
        result.append({'name': name, 'pr': channel['pr'], 'n': candidate['n'], 'sha': candidate['sha'],
                       'source': candidate['source'], 'tags': candidate['tags']})
    return result


def row(channel, title=None):
    """A ch/index.json entry: what a client needs to offer the channel, never an authority to switch."""
    value = {'name': channel['name'], 'pr': channel['pr'], 'n': channel['n']}
    value.update({uc.DOCUMENT[c]: tag for c, tag in channel['tags'].items()})
    value['releaseSource'] = channel['source']
    if title is not None:
        value['title'] = title
    return value


def identity(rows):
    # Titles are display text: renaming a pull request does not redeploy the site.
    return sorted((json.dumps({k: v for k, v in r.items() if k != 'title'}, sort_keys=True) for r in rows))


def fetch(path):
    """A public JSON document of the Page, or None when it is absent."""
    url = os.environ['JAUNT_PAGE_URL'].rstrip('/') + '/' + path
    if not url.startswith('https://'):
        raise ValueError('Public page must use HTTPS')
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def plan():
    """Decide a site-only deployment when production has nothing to publish."""
    if os.environ.get('JAUNT_AUTO_RELEASE_ENABLED') != 'true':
        rp.output({'site': False})
        return
    production, _ = rp.state_load()
    if not production or production['pending']:
        rp.summary('Channel pages wait for a delivered production without a pending publication.')
        rp.output({'site': False})
        return
    channels, _ = rp.state_load(rp.CHANNEL_REF)
    wanted = [row(c) for c in selected(channels)]
    public = fetch(INDEX)
    if public is not None and identity(public.get('channels', [])) == identity(wanted):
        rp.summary(f'Channel pages up to date: {", ".join(r["name"] for r in wanted) or "no live channel"}.')
        rp.output({'site': False})
        return
    # Republish the last delivered production exactly: same build commit, source and tags.
    if production['history']:
        last = production['history'][-1]
        sha, source = last['sha'], last['source']
    else:
        sha = source = production['receipts']['host']['sha']
    values = {'site': True, 'sha': sha, 'source': source}
    values.update({c + '_tag': production['tags'][c] for c in rp.COMPONENTS})
    rp.summary(f'Channel pages changed: redeploying production `{source}` with '
               f'{", ".join(r["name"] for r in wanted) or "no live channel"}.')
    rp.output(values)


def select():
    """The channels pages.yml builds, read under the production lock."""
    state, _ = rp.state_load(rp.CHANNEL_REF)
    channels = selected(state)
    rp.output({'channels': json.dumps(channels, separators=(',', ':')), 'count': len(channels)})


def links(root):
    return [p for p in Path(root).rglob('*') if p.is_symlink()]


def assemble(site, webs, channels):
    """Place each candidate web under ch/<name>/, bind its document, and write ch/index.json.

    A channel whose web is missing or invalid is dropped, never production: the
    run reports it and verification fails after production is delivered.
    """
    site, webs = Path(site), Path(webs)
    root = site / 'ch'
    if root.exists():
        raise ValueError('The production web already has a ch/ directory')
    production = json.loads((site / 'config.json').read_text())
    page, repository = production['page'], production['repository']
    releases = {r['tag_name']: r for r in rp.pages(f'{rp.repo()}/releases')}
    rows, dropped = [], []
    for channel in channels:
        name, source = channel['name'], webs / f'channel-web-{channel["name"]}'
        try:
            if not uc.publishable(name) or not (source / 'config.json').is_file():
                raise ValueError('candidate web was not built')
            if links(source):
                raise ValueError('candidate web contains symbolic links')
            document = json.loads((source / 'config.json').read_text())
            document.update(channel=name, releaseSource=channel['source'])
            uc.validate_document(document, name, page, repository)
            for component, tag in channel['tags'].items():
                if document[uc.DOCUMENT[component]] != tag:
                    raise ValueError(f'{uc.DOCUMENT[component]} is not the delivered candidate')
                release = releases.get(tag)
                if not release or release['draft']:
                    raise ValueError(f'release {tag} is not published')
        except (ValueError, KeyError, json.JSONDecodeError) as error:
            dropped.append(name)
            rp.summary(f'Channel `{name}` not deployed: {error}.')
            continue
        target = root / name
        shutil.copytree(source, target)
        (target / 'config.json').write_text(json.dumps(document, indent=2) + '\n')
        try:
            title = rp.api(f'{rp.repo()}/pulls/{channel["pr"]}')['title']
        except RuntimeError:
            title = None
        rows.append(row(channel, title))
    root.mkdir(exist_ok=True)
    index = {'version': 1, 'page': page, 'repository': repository, 'channels': rows}
    (root / 'index.json').write_text(json.dumps(index, indent=2) + '\n')
    rp.summary(f'Channel pages: {", ".join(r["name"] for r in rows) or "none"}'
               + (f'; dropped {", ".join(dropped)}' if dropped else '') + '.')
    rp.output({'channels': json.dumps(rows, separators=(',', ':')), 'dropped': ','.join(dropped)})


def verify(rows, dropped):
    """The public Page serves exactly the deployed channels, and no removed one."""
    state, _ = rp.state_load(rp.CHANNEL_REF)
    deployed = {r['name'] for r in rows}
    removed = sorted(n for n, c in ((state or {}).get('channels') or {}).items()
                     if c['status'] == 'removed' and n not in deployed)
    for attempt in range(ATTEMPTS):
        problems = []
        index = fetch(INDEX)
        if index is None or identity(index.get('channels', [])) != identity(rows):
            problems.append(INDEX)
        else:
            page, repository = index['page'], index['repository']
            for r in rows:
                document = fetch(f'ch/{r["name"]}/config.json')
                try:
                    uc.validate_document(document, r['name'], page, repository)
                    if any(document[f] != r[f] for f in (*uc.DOCUMENT.values(), 'releaseSource')):
                        raise ValueError('stale')
                except ValueError:
                    problems.append(r['name'])
        problems += [n for n in removed if fetch(f'ch/{n}/config.json') is not None]
        if not problems:
            break
        if attempt == ATTEMPTS - 1:
            raise ValueError('Public channel pages do not match the deployment: ' + ', '.join(problems))
        time.sleep(5)
    rp.summary(f'Public channel pages verified: {", ".join(sorted(deployed)) or "none"}; '
               f'removed and absent: {", ".join(removed) or "none"}.')
    if dropped:
        raise ValueError('Channels not deployed: ' + ', '.join(dropped))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['plan', 'select', 'assemble', 'verify'])
    parser.add_argument('--site')
    parser.add_argument('--webs')
    args = parser.parse_args()
    if args.command == 'plan':
        plan()
    elif args.command == 'select':
        select()
    elif args.command == 'assemble':
        if not args.site or not args.webs:
            raise ValueError('--site and --webs are required')
        assemble(args.site, args.webs, json.loads(os.environ['CHANNELS']))
    else:
        dropped = [n for n in os.environ.get('DROPPED', '').split(',') if n]
        verify(json.loads(os.environ.get('CHANNELS') or '[]'), dropped)


if __name__ == '__main__':
    main()
