// The published channel list, <page>/ch/index.json (docs/UPDATES.md#update-channels).
// It only offers names: every surface still fetches and validates ch/<name>/config.json before switching.
export const OFFICIAL = Object.freeze({page: 'https://moukrea.github.io/jaunt/', repository: 'moukrea/jaunt'});
const NAME = /^[a-z][a-z0-9]{0,31}_[1-9][0-9]{0,5}$/;
// Only a per-PR sub-channel of a non-reserved developer may be published.
export const publishable = name => typeof name === 'string' && NAME.test(name) && !/^(main|beta)_/.test(name);
export const channelIndexURL = page => new URL('ch/index.json', page).href;
// main first, then each valid published channel once; a malformed row is dropped, never trusted.
export function parseChannelIndex(document, expected = OFFICIAL) {
  if (!document || document.version !== 1 || !Array.isArray(document.channels)) throw new Error('Invalid channel list');
  if (document.page !== expected.page || document.repository !== expected.repository) throw new Error('This channel list is not from the official Page');
  const seen = new Set(['main']), channels = [{name: 'main'}];
  for (const row of document.channels) {
    if (!publishable(row?.name) || seen.has(row.name)) continue;
    seen.add(row.name);
    channels.push({name: row.name, pr: Number.isInteger(row.pr) ? row.pr : null, title: typeof row.title === 'string' ? row.title.slice(0, 200) : ''});
  }
  return channels;
}
