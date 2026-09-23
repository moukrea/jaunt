// Project accounting is entirely local. No provider/Linear requests, credentials,
// worker launches or changes to the landing queue are made by these commands.
import { readFile, readdir, mkdir, writeFile, rename, rm, open, chmod } from 'node:fs/promises';
import { join, resolve, isAbsolute, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { processIdentity, identityState } from './linear_workers.mjs';
import { digest, number, time, label, identity, TOKEN_FIELDS, readNative, readAttempt, reconcileEvents } from './linear_cost_sources.mjs';

const schema = (condition, message) => { if (!condition) throw Error(`costs: ${message}`); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed, what) {
  schema(object(value) && Object.keys(value).every(k => allowed.includes(k)), `invalid ${what} fields`);
}
function period(value, what) {
  value.start = time(value.start); value.end = time(value.end);
  schema(value.start && value.end && value.start < value.end, `invalid ${what} period`);
}
const runtime = value => ['codex', 'claude'].includes(value);
const roles = ['worker', 'orchestrator', 'subagent', 'classifier', 'unknown'];
const projects = ['jaunt', 'other', 'unknown'];
function unique(rows, key, what) { schema(new Set(rows.map(key)).size === rows.length, `duplicate ${what}`); }
function officialUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash &&
      ['developers.openai.com', 'platform.openai.com', 'platform.claude.com', 'code.claude.com', 'www.anthropic.com', 'www.openai.com', 'openai.com'].includes(u.hostname);
  } catch { return false; }
}
export function validateConfig(input) {
  keys(input, ['version', 'projectRoots', 'sources', 'mappings', 'rates', 'subscriptions', 'coverage'], 'configuration');
  schema(input.version === 1, 'unsupported configuration version');
  const c = structuredClone(input);
  schema(Array.isArray(c.projectRoots) && c.projectRoots.length > 0 && c.projectRoots.every(p => typeof p === 'string' && isAbsolute(p)), 'projectRoots must be explicit absolute paths');
  c.projectRoots = [...new Set(c.projectRoots.map(p => resolve(p)))];
  for (const key of ['sources', 'mappings', 'rates', 'subscriptions', 'coverage']) {
    c[key] ??= []; schema(Array.isArray(c[key]), `${key} must be an array`);
  }
  for (const s of c.sources) {
    keys(s, ['id', 'kind', 'path'], 'source');
    schema(label(s.id) && ['codex', 'claude', 'attempts'].includes(s.kind) && typeof s.path === 'string' && isAbsolute(s.path), 'invalid source');
    s.path = resolve(s.path);
  }
  unique(c.sources, s => s.id, 'source id');
  for (const m of c.mappings) {
    keys(m, ['runtime', 'session', 'event', 'account', 'role', 'project'], 'mapping');
    schema(runtime(m.runtime) && Boolean(m.session) !== Boolean(m.event) && typeof (m.session || m.event) === 'string' && /^[a-f0-9]{64}$/.test(m.session || m.event), 'mapping requires exactly one hashed session or event reference from the inventory');
    schema(m.account === undefined || label(m.account), 'invalid account alias');
    schema(m.role === undefined || roles.includes(m.role), 'invalid role');
    schema(m.project === undefined || projects.includes(m.project), 'invalid project');
  }
  unique(c.mappings, m => `${m.runtime}:${m.event ? 'event:' + m.event : 'session:' + m.session}`, 'mapping');
  for (const r of c.rates) {
    keys(r, ['id', 'runtime', 'model', 'tier', 'currency', 'start', 'end', 'retrievedAt', 'source', 'evidence', 'minInputTokens', 'maxInputTokens', 'perMillion'], 'rate');
    schema(label(r.id) && runtime(r.runtime) && label(r.model) && label(r.tier) && /^[A-Z]{3}$/.test(r.currency), 'invalid rate identity');
    schema(Number.isSafeInteger(r.minInputTokens) && r.minInputTokens >= 0 && Number.isSafeInteger(r.maxInputTokens) && r.maxInputTokens > r.minInputTokens, 'rate requires an explicit input-context band');
    period(r, 'rate'); schema(time(r.retrievedAt) && officialUrl(r.source) && label(r.evidence), 'rate requires dated official provenance and a validity evidence reference');
    keys(r.perMillion, ['uncached', 'cached', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h', 'output'], 'price');
    schema(Object.values(r.perMillion).every(v => number(v) !== null), 'rates must be finite nonnegative numbers');
  }
  unique(c.rates, r => r.id, 'rate id');
  for (let i = 0; i < c.rates.length; i++) for (const b of c.rates.slice(i + 1)) {
    const a = c.rates[i];
    schema(!(a.runtime === b.runtime && a.model === b.model && a.tier === b.tier && a.start < b.end && b.start < a.end && a.minInputTokens < b.maxInputTokens && b.minInputTokens < a.maxInputTokens), 'overlapping rate periods/context bands');
  }
  for (const s of c.subscriptions) {
    keys(s, ['id', 'runtime', 'account', 'amount', 'currency', 'start', 'end', 'evidence', 'evidenceKind'], 'subscription');
    schema(label(s.id) && runtime(s.runtime) && label(s.account) && number(s.amount) !== null && /^[A-Z]{3}$/.test(s.currency), 'invalid subscription');
    period(s, 'subscription');
    schema(label(s.evidence) && ['invoice', 'user-declaration'].includes(s.evidenceKind), 'subscription payment evidence required');
  }
  unique(c.subscriptions, s => s.id, 'subscription id');
  for (let i = 0; i < c.subscriptions.length; i++) for (const b of c.subscriptions.slice(i + 1)) {
    const a = c.subscriptions[i];
    schema(!(a.runtime === b.runtime && a.account === b.account && a.start < b.end && b.start < a.end), 'overlapping subscription periods');
  }
  for (const a of c.coverage) {
    keys(a, ['runtime', 'account', 'start', 'end', 'evidence'], 'coverage attestation');
    schema(runtime(a.runtime) && label(a.account) && label(a.evidence), 'invalid coverage attestation'); period(a, 'coverage');
  }
  return c;
}
export function defaultConfig(root) {
  let roots = [resolve(root)];
  try {
    const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    roots.push(...worktrees.split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9)));
  } catch { /* explicit root remains usable outside Git */ }
  return validateConfig({ version: 1, projectRoots: roots,
    sources: [{ id: 'codex', kind: 'codex', path: join(homedir(), '.codex', 'sessions') },
      { id: 'codex-archive', kind: 'codex', path: join(homedir(), '.codex', 'archived_sessions') },
      { id: 'claude', kind: 'claude', path: join(homedir(), '.claude', 'projects') },
      { id: 'workers', kind: 'attempts', path: join(root, '.dev-state', 'workers') }],
    mappings: [], rates: [], subscriptions: [], coverage: [] });
}
async function json(path, absent = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return absent; throw Error('costs: unreadable or invalid private state'); }
}
async function privateWrite(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(tmp, JSON.stringify(value), { mode: 0o600 }); await rename(tmp, path); }
  finally { await rm(tmp, { force: true }); }
}
// Use an identity-bearing lock. Uncertain ownership is never stolen. A guard
// serializes recovery of a provably dead process after a crash.
export async function withCostLock(dir, action) {
  await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
  const lock = join(dir, 'collector.lock'), reaper = `${lock}.reap`;
  try { await readFile(reaper); throw Error('costs: lock recovery in progress'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (e) {
    if (e.code !== 'EEXIST') throw Error('costs: cannot acquire collector lock');
    let guard;
    try { guard = await open(reaper, 'wx', 0o600); } catch { throw Error('costs: collector busy or uncertain'); }
    try {
      const old = await json(lock);
      schema(identityState(old) === 'gone', 'collector busy or uncertain');
      await rm(lock);
    } finally { await guard.close(); await rm(reaper, { force: true }); }
    return withCostLock(dir, action);
  }
  try {
    const who = processIdentity(process.pid); schema(who, 'process identity unavailable');
    await handle.writeFile(JSON.stringify(who)); return await action();
  } finally { await handle.close(); await rm(lock, { force: true }); }
}
async function discover(root, kind) {
  const found = [], errors = [];
  async function walk(path) {
    let entries;
    try { entries = await readdir(path, { withFileTypes: true }); }
    catch (e) { errors.push(e.code === 'ENOENT' ? 'source-missing' : 'source-unreadable'); return; }
    for (const e of entries) {
      // Never follow transcript symlinks or inspect credentials/config files.
      if (e.isDirectory()) await walk(join(path, e.name));
      else if (e.isFile() && (kind === 'attempts' ? /^[a-f0-9-]{36}\.json$/.test(e.name) : e.name.endsWith('.jsonl'))) found.push(join(path, e.name));
    }
  }
  await walk(root); return { found: found.sort(), errors };
}
function ledgerCheck(ledger) {
  schema(ledger.version === 1 && object(ledger.files) && Array.isArray(ledger.errors), 'unsupported ledger');
  for (const [id, f] of Object.entries(ledger.files)) schema(/^[a-f0-9]{64}$/.test(id) && object(f) && Array.isArray(f.events) && Array.isArray(f.gaps), 'invalid source ledger');
  return ledger;
}
export async function scanCosts(dir, config, { now = new Date().toISOString() } = {}) {
  config = validateConfig(config);
  return withCostLock(dir, async () => {
    const ledger = ledgerCheck(await json(join(dir, 'ledger.json'), { version: 1, files: {}, errors: [], scans: 0 }));
    const previous = new Set(Object.keys(ledger.files)), errors = []; let changed = 0, unchanged = 0;
    const parserConfig = digest(JSON.stringify({ parserVersion: 1, roots: config.projectRoots }));
    for (const source of config.sources) {
      const { found, errors: discoveryErrors } = await discover(source.path, source.kind);
      errors.push(...discoveryErrors.map(code => ({ source: source.id, code })));
      for (const path of found) {
        const id = digest(`${source.kind}:${path}`); previous.delete(id);
        const old = ledger.files[id]; let buffer;
        try { buffer = await readFile(path); } catch { errors.push({ source: source.id, code: 'file-unreadable', file: id }); continue; }
        const signature = digest(buffer);
        if (old?.signature === signature && old.parserConfig === parserConfig) { old.missing = false; old.source = source.id; unchanged++; continue; }
        const parsed = source.kind === 'attempts' ? readAttempt(buffer.toString('utf8')) : readNative(buffer.toString('utf8'), { runtime: source.kind, path, projectRoots: config.projectRoots });
        // Preserve observed events across truncation, deletion and rotation.
        // Fresh evidence for the same identity supersedes that file's snapshot;
        // reconciliation still detects conflicting copies in other files.
        const freshIds = new Set(parsed.events.map(e => e.id));
        const retained = (old?.events || []).filter(e => !freshIds.has(e.id));
        const gaps = new Set(parsed.gaps);
        let priorEvents = old?.events || [];
        if (old && old.parserConfig !== parserConfig) {
          // Root selection is derived configuration, not contradictory source
          // evidence. Reclassify present identities, keep vanished context unknown.
          const current = new Map(reconcileEvents(parsed.events).map(e => [e.id, e]));
          priorEvents = priorEvents.map(e => ({ ...e, project: current.get(e.id)?.project || 'unknown',
            attributionConflict: current.get(e.id)?.attributionConflict || false }));
          if (retained.length) gaps.add('retained-project-context-unavailable');
        }
        if (old && buffer.length < old.bytes) gaps.add('source-truncated-history-retained');
        if (retained.length) gaps.add('prior-events-retained');
        ledger.files[id] = { source: source.id, kind: source.kind, signature, parserConfig, bytes: buffer.length,
          observedAt: now, missing: false, events: source.kind === 'attempts' ? [...retained, ...parsed.events] : reconcileEvents([...priorEvents, ...parsed.events]), gaps: [...gaps] };
        changed++;
      }
    }
    for (const id of previous) ledger.files[id].missing = true;
    ledger.errors = errors; ledger.scans++; ledger.lastScanAt = now;
    ledger.scan = { changed, unchanged, retainedMissingFiles: previous.size };
    // A single atomic ledger commit owns both evidence and source checkpoints.
    await privateWrite(join(dir, 'ledger.json'), ledger);
    return { lastScanAt: now, ...ledger.scan, errors, files: Object.keys(ledger.files).length };
  });
}
export function normalized(e) {
  const u = e.usage;
  if (e.runtime === 'codex') return { inputTotal: u.input, uncached: u.input !== null && u.cached !== null && (u.cacheWrite === null || u.cacheWrite === 0) && u.input >= u.cached ? u.input - u.cached : null,
    cached: u.cached, cacheWrite: u.cacheWrite, cacheWrite5m: null, cacheWrite1h: null, output: u.output };
  return { inputTotal: ['input', 'cached', 'cacheWrite'].every(k => u[k] !== null) ? u.input + u.cached + u.cacheWrite : null,
    uncached: u.input, cached: u.cached, cacheWrite: u.cacheWrite, cacheWrite5m: u.cacheWrite5m, cacheWrite1h: u.cacheWrite1h, output: u.output };
}
export function priceEvent(e, rates) {
  const unavailable = reason => ({ value: null, kind: 'unavailable', reason });
  if (e.excluded) return unavailable(e.excluded);
  if (!e.model || !e.at || !e.from) return unavailable('model-or-period-unavailable');
  if (e.priceGaps.length) return unavailable(e.priceGaps.join(','));
  const contextInput = normalized(e).inputTotal;
  if (contextInput === null) return unavailable('input-context-unavailable');
  const rate = rates.find(r => r.runtime === e.runtime && r.model === e.model && r.tier === e.tier && r.start <= e.from && e.at < r.end && contextInput >= r.minInputTokens && contextInput < r.maxInputTokens);
  if (!rate) return unavailable('dated-rate-unavailable');
  const u = normalized(e), components = { uncached: u.uncached, cached: u.cached, output: u.output };
  if (e.runtime === 'claude' && u.cacheWrite > 0) {
    if (u.cacheWrite5m === null || u.cacheWrite1h === null || u.cacheWrite5m + u.cacheWrite1h !== u.cacheWrite) return unavailable('cache-ttl-unavailable');
    components.cacheWrite5m = u.cacheWrite5m; components.cacheWrite1h = u.cacheWrite1h;
  } else if (u.cacheWrite === null) return unavailable('cache-write-unavailable');
  for (const [k, v] of Object.entries(components)) if (v === null || (v > 0 && number(rate.perMillion[k]) === null)) return unavailable('token-category-or-rate-unavailable');
  const value = Object.entries(components).reduce((sum, [k, v]) => sum + v * (rate.perMillion[k] ?? 0) / 1e6, 0);
  if (!Number.isFinite(value)) return unavailable('numeric-overflow');
  return { value, kind: 'estimated', currency: rate.currency, rate: rate.id, source: rate.source, retrievedAt: rate.retrievedAt, partial: e.partial,
    scope: 'observed token API equivalent only; not a bill or subscription charge' };
}
function metric(events, get) {
  const values = events.map(get).filter(v => number(v) !== null);
  const sum = values.reduce((a, b) => a + b, 0), available = values.length > 0 && Number.isSafeInteger(sum);
  return { value: available ? sum : null, kind: available ? 'observed' : 'unavailable',
    reported: values.length, candidates: events.length, complete: events.length > 0 && values.length === events.length && events.every(e => !e.partial) };
}
function moneySubtotal(rows) {
  const currencies = [...new Set(rows.filter(r => r.value !== null).map(r => r.currency))];
  return currencies.map(currency => ({ currency, value: rows.filter(r => r.currency === currency && r.value !== null).reduce((n, r) => n + r.value, 0), kind: 'estimated' }));
}
function summary(events) {
  const usable = events.filter(e => !e.excluded);
  return { events: events.length, included: usable.length, excluded: events.length - usable.length,
    native: Object.fromEntries(TOKEN_FIELDS.map(k => [k, metric(usable, e => e.usage[k])])),
    normalized: Object.fromEntries(['inputTotal', 'uncached', 'cached', 'cacheWrite', 'output'].map(k => [k, metric(usable, e => normalized(e)[k])])),
    apiEquivalent: { totals: moneySubtotal(usable.map(e => e.price)), pricedEvents: usable.filter(e => e.price.value !== null).length,
      candidates: usable.length, complete: usable.length > 0 && usable.every(e => e.price.value !== null && !e.partial) } };
}
function allocations(events, config, errors) {
  return config.subscriptions.map(s => {
    const candidates = events.filter(e => e.runtime === s.runtime && (!e.at || (e.at >= s.start && e.from < s.end)));
    const account = candidates.filter(e => e.account === s.account && !e.excluded);
    const attestation = config.coverage.find(a => a.runtime === s.runtime && a.account === s.account && a.start <= s.start && a.end >= s.end);
    const reasons = [];
    if (!attestation) reasons.push('all-project-coverage-not-attested');
    if (errors.length) reasons.push('source-coverage-gaps');
    if (!account.length) reasons.push('no-account-usage');
    if (candidates.some(e => !e.account && !e.excluded)) reasons.push('unmapped-account-usage');
    if (candidates.some(e => e.account === s.account && e.excluded && e.excluded !== 'native-source-preferred')) reasons.push('ambiguous-account-usage');
    if (account.some(e => e.project === 'unknown' || e.partial || !e.at || e.from < s.start || e.at >= s.end)) reasons.push('incomplete-project-or-period');
    if (account.some(e => e.price.value === null)) reasons.push('unpriced-usage');
    const currencies = new Set(account.filter(e => e.price.value !== null).map(e => e.price.currency));
    if (currencies.size !== 1) reasons.push('incomparable-price-currencies');
    const denominator = account.reduce((n, e) => n + (e.price.value || 0), 0);
    const numerator = account.filter(e => e.project === 'jaunt').reduce((n, e) => n + (e.price.value || 0), 0);
    if (!(denominator > 0)) reasons.push('zero-or-unavailable-denominator');
    return { subscription: s.id, account: s.account, runtime: s.runtime, start: s.start, end: s.end,
      paid: { value: s.amount, currency: s.currency, kind: s.evidenceKind === 'invoice' ? 'invoice-evidence-supplied' : 'user-declared', evidence: s.evidence },
      allocation: { value: reasons.length ? null : s.amount * numerator / denominator, currency: s.currency, kind: reasons.length ? 'unavailable' : 'estimated',
        method: 'api-equivalent-share-v1', numerator: reasons.length ? null : numerator, denominator: reasons.length ? null : denominator,
        weightCurrency: currencies.size === 1 ? [...currencies][0] : null, coverageEvidence: attestation?.evidence || null, reasons } };
  });
}
export function buildReport(ledger, config, { from = null, to = null, now = new Date().toISOString() } = {}) {
  config = validateConfig(config); ledgerCheck(ledger);
  schema((from === null || time(from)) && (to === null || time(to)) && (!from || !to || time(from) < time(to)), 'invalid report period');
  from = from && time(from); to = to && time(to);
  const all = reconcileEvents(Object.values(ledger.files).flatMap(f => f.events), config.mappings);
  for (const e of all) e.price = priceEvent(e, config.rates);
  const selected = all.filter(e => !e.at || ((!from || e.at >= from) && (!to || e.from < to))).map(e => structuredClone(e));
  for (const e of selected) if ((from && e.from < from) || (to && e.at >= to)) e.excluded ||= 'crosses-report-period';
  const gaps = [...ledger.errors, ...Object.entries(ledger.files).flatMap(([file, f]) => [
    ...f.gaps.map(code => ({ source: f.source, file, code })), ...(f.missing ? [{ source: f.source, file, code: 'source-disappeared-evidence-retained' }] : [])])];
  const grouped = (key, filter = () => true) => Object.fromEntries([...new Set(selected.filter(filter).map(key))].sort().map(k => [k, summary(selected.filter(e => filter(e) && key(e) === k))]));
  return { version: 1, generatedAt: now, lastScanAt: ledger.lastScanAt || null,
    freshnessSeconds: ledger.lastScanAt ? Math.max(0, (Date.parse(now) - Date.parse(ledger.lastScanAt)) / 1000) : null,
    period: { from, to, scope: 'all selected evidence, including anonymous other projects',
      firstJauntObserved: selected.find(e => e.project === 'jaunt' && e.at)?.at || null,
      lastJauntObserved: selected.filter(e => e.project === 'jaunt' && e.at).at(-1)?.at || null, firstObserved: selected.find(e => e.at)?.at || null, lastObserved: selected.filter(e => e.at).at(-1)?.at || null },
    scope: 'Known local evidence only; project lifetime completeness is not established. Never add API equivalents to subscriptions.',
    byRuntime: grouped(e => e.runtime, e => e.project === 'jaunt'), byRole: grouped(e => `${e.runtime}:${e.role}`, e => e.project === 'jaunt'),
    byMonth: grouped(e => `${e.runtime}:${e.at?.slice(0, 7) || 'unknown'}`, e => e.project === 'jaunt'),
    byIssue: grouped(e => e.issue || 'unattributed', e => e.project === 'jaunt'),
    otherProjects: summary(selected.filter(e => e.project === 'other')), unattributed: summary(selected.filter(e => e.project === 'unknown')),
    accounts: grouped(e => `${e.runtime}:${e.account || 'unknown'}`, e => e.project === 'jaunt'),
    subscriptions: allocations(all, config, gaps).filter(s => (!from || s.end > from) && (!to || s.start < to)),
    // Raw scoped client estimates are alternatives, never summed across resumes,
    // parents or native events. They can include children absent from token sums.
    reportedEstimates: selected.filter(e => e.reportedEstimate && e.project === 'jaunt').map(e => ({ event: e.id, runtime: e.runtime, at: e.at, session: e.session, ...e.reportedEstimate })),
    coverage: { complete: false, files: Object.keys(ledger.files).length, uniqueEvents: all.length, gaps,
      partialEvents: selected.filter(e => e.partial).length, excludedEvents: selected.filter(e => e.excluded).length,
      unknownAccounts: selected.filter(e => !e.account && !e.excluded).length,
      limits: ['Deleted or unrecorded history cannot be recovered.', 'Current claim runtime is not historical provider evidence.',
        'Quota resets are not charges.', 'Rate tables require explicit validity evidence; no current price is backdated.',
        'Other projects remain anonymous; unknown account assignments are not inferred.', 'Scoped client estimates are not invoice measurements.'] },
    // Hash references permit explicit account/role mappings without exporting
    // raw session identifiers, paths, prompts, replies or tool arguments.
    inventory: selected.map(e => ({ id: e.id, runtime: e.runtime, session: e.session, parent: e.parent, source: e.source, at: e.at, from: e.from,
      project: e.project, role: e.role, issue: e.issue, model: e.model, account: e.account, partial: e.partial, excluded: e.excluded || null,
      usage: e.usage, price: e.price })) };
}
export function markdownReport(r) {
  const show = v => v === null || v === undefined ? 'unavailable' : String(v);
  const lines = ['# Jaunt development costs', '', r.scope, '', `Last scan: ${r.lastScanAt || 'never'}`, '',
    '| Runtime | Observed input (all categories) | Observed output | API equivalent (estimate) |', '| --- | ---: | ---: | --- |'];
  for (const [runtime, s] of Object.entries(r.byRuntime)) lines.push(`| ${runtime} | ${show(s.normalized.inputTotal.value)} | ${show(s.normalized.output.value)} | ${s.apiEquivalent.totals.map(x => `${x.value.toFixed(4)} ${x.currency}`).join(', ') || 'unavailable'} (${s.apiEquivalent.pricedEvents}/${s.apiEquivalent.candidates} events priced) |`);
  lines.push('', '## Subscription payments and estimated allocation', '', '| Account | Period | Paid (evidence supplied) | Estimated Jaunt share |', '| --- | --- | --- | --- |');
  for (const s of r.subscriptions) lines.push(`| ${s.account} | ${s.start.slice(0, 10)}–${s.end.slice(0, 10)} | ${s.paid.value} ${s.paid.currency} (${s.paid.kind}) | ${show(s.allocation.value)} ${s.allocation.currency} |`);
  if (!r.subscriptions.length) lines.push('| unknown | unknown | unavailable | unavailable |');
  lines.push('', `Coverage: ${r.coverage.files} files; ${r.coverage.uniqueEvents} unique events; ${r.coverage.partialEvents} partial; ${r.coverage.excludedEvents} excluded; ${r.coverage.gaps.length} source gaps.`, '',
    ...r.coverage.limits.map(s => `- ${s}`), '', 'Use the JSON report for provenance, account allocation refusals, role/month/ticket breakdowns and source coverage.');
  return lines.join('\n');
}
export async function costsCommand(root, state, args, flags = {}, { signal } = {}) {
  const [action, ...rest] = args; schema(!rest.length, 'unexpected positional argument');
  const dir = join(state, 'costs'), configFile = join(dir, 'config.json');
  if (action === 'import') {
    schema(typeof flags.file === 'string', 'import requires --file');
    let input;
    try { input = JSON.parse(await readFile(flags.file, 'utf8')); } catch { throw Error('costs: invalid configuration file'); }
    const config = validateConfig(input);
    await withCostLock(dir, () => privateWrite(configFile, config));
    return { imported: true, sources: config.sources.length, rates: config.rates.length, subscriptions: config.subscriptions.length };
  }
  const config = validateConfig(await json(configFile) || defaultConfig(root));
  if (action === 'scan') return scanCosts(dir, config);
  if (action === 'report' || action === 'status') {
    const ledger = await json(join(dir, 'ledger.json'));
    if (!ledger) return { available: false, reason: 'run costs scan first' };
    if (action === 'status') {
      const collector = await json(join(dir, 'watch.json'));
      return { available: true, lastScanAt: ledger.lastScanAt, freshnessSeconds: Math.max(0, (Date.now() - Date.parse(ledger.lastScanAt)) / 1000),
        scans: ledger.scans, files: Object.keys(ledger.files).length, errors: ledger.errors,
        collector: collector ? { ...collector, processState: collector.identity ? identityState(collector.identity) : 'not-recorded' } : null };
    }
    schema(flags.format === undefined || ['json', 'markdown'].includes(flags.format), 'format must be json or markdown');
    const report = buildReport(ledger, config, { from: flags.from ?? null, to: flags.to ?? null });
    return flags.format === 'markdown' ? markdownReport(report) : report;
  }
  if (action === 'watch') {
    const seconds = flags.interval === undefined ? 60 : Number(flags.interval);
    schema(Number.isInteger(seconds) && seconds >= 10 && seconds <= 3600, 'interval must be 10–3600 seconds');
    const control = new AbortController(), abort = () => control.abort();
    signal?.addEventListener('abort', abort, { once: true });
    process.once('SIGINT', abort); process.once('SIGTERM', abort);
    let failure = null;
    try {
      // A separate lock gives watch ownership; individual scans still use the
      // collector lock so manual scans and config imports serialize safely.
      return await withCostLock(join(dir, 'watch-lock'), async () => {
        while (!control.signal.aborted && !signal?.aborted) {
          try {
            const current = validateConfig(await json(configFile) || config);
            await scanCosts(dir, current); failure = null;
          } catch { failure = 'scan-failed; previous ledger preserved'; }
          await privateWrite(join(dir, 'watch.json'), { identity: processIdentity(process.pid), at: new Date().toISOString(), intervalSeconds: seconds, failure, state: 'running' });
          try { await delay(seconds * 1000, null, { signal: control.signal }); } catch { break; }
        }
        await privateWrite(join(dir, 'watch.json'), { at: new Date().toISOString(), state: 'stopped', failure });
        return { stopped: true, failure };
      });
    } finally { signal?.removeEventListener('abort', abort); process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
  }
  throw Error('costs: expected scan, report, status, import or watch');
}
