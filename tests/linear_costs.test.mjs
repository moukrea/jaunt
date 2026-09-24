import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, appendFile, rm, stat, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readNative, readAttempt, reconcileEvents, identity, projectOf } from '../scripts/linear_cost_sources.mjs';
import { validateConfig, scanCosts, buildReport, priceEvent, normalized, costsCommand, withCostLock, markdownReport, publicSubscriptionDefaults } from '../scripts/linear_costs.mjs';
import { parseCommandArgs } from '../scripts/linear_agent.mjs';
const exec = promisify(execFile);
const t0 = '2026-09-01T00:00:00.000Z', t1 = '2026-09-01T00:01:00.000Z', t2 = '2026-09-01T00:02:00.000Z';
const end = '2026-10-01T00:00:00.000Z';
const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
const codexUsage = (input = 100, output = 10) => ({ input_tokens: input, cached_input_tokens: 20, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 3 });
function codexRows({ id = 'thread', cwd = '/project', total = codexUsage(), last = total, extra = {} } = {}) {
  return [{ type: 'session_meta', timestamp: t0, payload: { id, cwd, timestamp: t0, ...extra } },
    { type: 'turn_context', timestamp: t0, payload: { model: 'observed-model', service_tier: 'standard', cwd } },
    { type: 'event_msg', timestamp: t1, payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: last } } }];
}
function claudeRow({ id = 'msg', session = 'session', cwd = '/project', output = 10, stop = 'end_turn', extra = {}, usage = {} } = {}) {
  return { type: 'assistant', timestamp: t1, sessionId: session, cwd, ...extra,
    message: { id, model: 'observed-model', stop_reason: stop, content: [{ text: 'SECRET_PROVIDER_TEXT' }],
      usage: { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 0, output_tokens: output, service_tier: 'standard', ...usage } } };
}
const native = (rows, runtime = 'codex', path = '/sessions/test.jsonl') => readNative(jsonl(rows), { runtime, path, projectRoots: ['/project'] });
const config = (extra = {}) => validateConfig({ version: 1, projectRoots: ['/project'], sources: [], ...extra });
const ledger = events => ({ version: 1, files: { ['a'.repeat(64)]: { events, gaps: [], source: 'test' } }, errors: [], scans: 1, lastScanAt: t2 });
const rate = (extra = {}) => ({ id: 'test-rate', runtime: 'codex', model: 'observed-model', tier: 'standard', currency: 'USD',
  start: t0, end, retrievedAt: t0, source: 'https://developers.openai.com/api/docs/pricing', evidence: 'synthetic-fixture-not-a-real-tariff',
  minInputTokens: 0, maxInputTokens: 1000000, perMillion: { uncached: 2, cached: 1, output: 10, cacheWrite5m: 3, cacheWrite1h: 4 }, ...extra });
const catalogPrice = (extra = {}) => ({ id: 'synthetic-price', runtime: 'codex', plan: 'synthetic-formula', amount: 100, currency: 'USD',
  cadence: 'month', channel: 'web', region: 'synthetic-region', source: 'https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers',
  retrievedAt: '2026-09-24', taxStatus: 'unknown', ...extra });
const scenario = (extra = {}) => ({ id: 'synthetic-scenario', catalog: 'synthetic-price', comparison: 'synthetic-comparison',
  assumption: 'synthetic-fixture-not-an-actual-account', basis: 'published', ...extra });
const taxRule = (extra = {}) => ({ jurisdiction: 'synthetic-tax-region', rate: 0.2, source: 'https://www.economie.gouv.fr/',
  retrievedAt: t0, assumption: 'synthetic-rule-not-personal-tax-evidence', ...extra });
async function temporary(t) { const dir = await mkdtemp(join(tmpdir(), 'jaunt-costs-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
function attempt(extra = {}) {
  return { issue: 'JAU-7', claimedAt: t0, attempt: '00000000-0000-4000-8000-000000000001', runtime: 'claude', session: 'session',
    startedAt: t0, endedAt: t2, childExited: true, code: 0, launchMode: 'start',
    owner: { runtime: 'codex', thread: 'owner', secret: 'SECRET_OWNER' },
    telemetry: { version: 1, requested: { model: 'requested-only' }, models: ['observed-model'], runtimeVersion: '2.1.278', reportedCost: 5,
      turns: {}, messages: {}, result: { source: 'claude result', inputTokens: 100, cachedInputTokens: 20, cacheCreationInputTokens: 0, outputTokens: 10 } }, ...extra };
}

test('native counts deduplicate cumulative snapshots; reasoning/cache are not added twice', () => {
  const rows = codexRows(); rows.push(rows.at(-1));
  const total = { ...codexUsage(130, 15), cached_input_tokens: 25, reasoning_output_tokens: 5 };
  rows.push({ type: 'event_msg', timestamp: t2, payload: { type: 'token_count', info: { total_token_usage: total,
    last_token_usage: { ...codexUsage(30, 5), cached_input_tokens: 5, reasoning_output_tokens: 2 } } } });
  const parsed = native(rows); assert.equal(parsed.events.length, 2);
  const report = buildReport(ledger(parsed.events), config());
  assert.equal(report.byRuntime.codex.normalized.inputTotal.value, 130);
  assert.equal(report.byRuntime.codex.normalized.output.value, 15);
  assert.equal(report.byRuntime.codex.normalized.uncached.value, 105);
  assert.equal(reconcileEvents([...parsed.events, ...parsed.events]).length, 2);
});
test('fork baselines, inherited events, missing baselines and resets remain gaps', () => {
  const rows = codexRows({ extra: { forked_from_id: 'parent', timestamp: t1 } });
  rows[2].timestamp = t0;
  rows.push({ ...rows[2], timestamp: t1, payload: { type: 'token_count', info: { total_token_usage: codexUsage(500, 100), last_token_usage: codexUsage() } } });
  rows.push({ ...rows[2], timestamp: t2, payload: { type: 'token_count', info: { total_token_usage: codexUsage(1, 1), last_token_usage: codexUsage(1, 1) } } });
  const p = native(rows); assert.equal(p.events.length, 0);
  assert.ok(p.gaps.includes('inherited-history-excluded')); assert.ok(p.gaps.includes('cumulative-counter-reset'));
  const restored = native(codexRows({ total: codexUsage(500, 100), last: codexUsage() }));
  assert.equal(restored.events[0].usage.input, 100); assert.equal(restored.events[0].partial, true);
});
test('a cumulative gap keeps observed delta but refuses to assign its model', () => {
  const rows = codexRows(); const total = { ...codexUsage(300, 50), cached_input_tokens: 60, reasoning_output_tokens: 10 };
  rows.push({ ...rows[2], timestamp: t2, payload: { type: 'token_count', info: { total_token_usage: total, last_token_usage: codexUsage() } } });
  const p = native(rows); assert.equal(p.events[1].usage.input, 200); assert.equal(p.events[1].model, null);
  assert.equal(priceEvent(p.events[1], [rate()]).value, null);
});
test('Claude message snapshots count once and final output supersedes a placeholder', () => {
  const p = native([claudeRow({ stop: null, output: 1 }), claudeRow()], 'claude');
  const events = reconcileEvents(p.events); assert.equal(events.length, 1);
  assert.equal(events[0].usage.output, 10); assert.equal(events[0].partial, false);
  assert.equal(normalized(events[0]).inputTotal, 120);
  assert.ok(!JSON.stringify(events).includes('SECRET_PROVIDER_TEXT'));
  const inputConflict = structuredClone(p.events[1]); inputConflict.usage.input = 200;
  assert.equal(reconcileEvents([p.events[1], inputConflict])[0].excluded, 'counter-conflict');
});
test('subagents have separate identities; copied messages and conflicting project attribution stay safe', () => {
  const parent = native([claudeRow()], 'claude').events[0];
  const child = native([claudeRow({ id: 'child-message', extra: { agentId: 'child', isSidechain: true } })], 'claude').events[0];
  const events = reconcileEvents([parent, child, child]); assert.equal(events.length, 2);
  assert.equal(child.parent, parent.session); assert.notEqual(child.session, parent.session);
  const copied = native([claudeRow({ cwd: '/unrelated', session: 'fork' })], 'claude').events[0];
  assert.equal(reconcileEvents([parent, copied])[0].project, 'unknown');
  assert.equal(projectOf('/project-copy', ['/project']), 'other'); assert.equal(projectOf(null, ['/project']), 'unknown');
});
test('actual attempt runtime survives a claim migration; native evidence supersedes overlapping wrappers', () => {
  const a = readAttempt(JSON.stringify(attempt()));
  assert.equal(a.events[0].runtime, 'claude');
  const codex = readAttempt(JSON.stringify(attempt({ runtime: 'codex', session: 'new-codex-session', attempt: '00000000-0000-4000-8000-000000000002', telemetry: null })));
  const n = native([claudeRow()], 'claude');
  const events = reconcileEvents([...a.events, ...codex.events, ...n.events]);
  assert.equal(events.find(e => e.source === 'attempt' && e.runtime === 'claude').excluded, 'native-source-preferred');
  assert.equal(events.find(e => e.source === 'native').role, 'worker');
  assert.equal(events.find(e => e.source === 'native').issue, 'JAU-7');
  const r = buildReport(ledger(events), config()); assert.equal(r.byRuntime.claude.normalized.inputTotal.value, 120);
  assert.equal(r.reportedEstimates[0].scope, 'session'); assert.equal(r.reportedEstimates[0].kind, 'estimated');
  assert.ok(!JSON.stringify(events).includes('SECRET_OWNER'));
});
test('overlapping attempts are excluded without a native source; owner role uses explicit historical identity', () => {
  const a = readAttempt(JSON.stringify(attempt())).events[0];
  const b = { ...a, id: 'another' };
  assert.ok(reconcileEvents([a, b]).every(e => e.excluded === 'overlapping-attempts'));
  const owner = native(codexRows({ id: 'owner' })).events[0];
  assert.equal(reconcileEvents([a, owner]).find(e => e.source === 'native').role, 'orchestrator');
});
test('classifier copied on resume is one separate Claude event even for a Codex worker', () => {
  const r = attempt(); r.telemetry.requested.routing = { at: t0, phase: 'planning', classifier: { observedModels: ['observed-model'],
    usage: { inputTokens: 12, outputTokens: 3, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, costUsd: { value: 0.5 } } };
  const a = readAttempt(JSON.stringify(r)); r.attempt = 'second'; r.runtime = 'codex';
  const b = readAttempt(JSON.stringify(r));
  const events = reconcileEvents([...a.events, ...b.events]);
  assert.equal(events.filter(e => e.role === 'classifier').length, 1);
  assert.equal(events.find(e => e.role === 'classifier').runtime, 'claude');
  delete r.telemetry.requested.routing.at;
  assert.equal(readAttempt(JSON.stringify(r)).events[1].excluded, 'classifier-identity-unavailable');
});
test('rates are dated, exact-model/tier and distinguish unavailable from actual zero', () => {
  const e = native(codexRows()).events[0];
  const priced = priceEvent(e, [rate()]); assert.ok(Math.abs(priced.value - 0.00028) < 1e-12); assert.equal(priced.kind, 'estimated');
  assert.equal(priceEvent(e, [rate({ start: t2 })]).value, null);
  assert.equal(priceEvent({ ...e, model: 'requested-only' }, [rate()]).value, null);
  assert.equal(priceEvent({ ...e, tier: null }, [rate()]).value, null);
  assert.equal(priceEvent(e, [rate({ perMillion: { uncached: 0, cached: 0, output: 0 } })]).value, 0);
  const missing = { ...e, usage: { ...e.usage, output: null } }; assert.equal(priceEvent(missing, [rate()]).value, null);
  const cw = native(codexRows({ total: { ...codexUsage(), cache_write_input_tokens: 20 } })).events[0];
  assert.equal(priceEvent(cw, [rate()]).value, null);
});
test('Claude cache TTL, regional and tool fee ambiguity do not create invented costs', () => {
  const c = native([claudeRow({ usage: { cache_creation_input_tokens: 20 } })], 'claude').events[0];
  assert.equal(priceEvent(c, [rate({ runtime: 'claude' })]).reason, 'cache-ttl-unavailable');
  const known = native([claudeRow({ usage: { cache_creation_input_tokens: 20, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 10 } } })], 'claude').events[0];
  assert.ok(priceEvent(known, [rate({ runtime: 'claude' })]).value > 0);
  const region = native([claudeRow({ usage: { inference_geo: 'us' } })], 'claude').events[0];
  assert.equal(priceEvent(region, [rate({ runtime: 'claude' })]).value, null);
});
test('subscription allocation needs payment, comparable all-project weights and explicit coverage', () => {
  const one = native(codexRows()).events[0]; const two = { ...one, id: 'other', session: identity('codex', 'other'), project: 'other' };
  const c = config({ rates: [rate()], mappings: [one, two].map(e => ({ runtime: e.runtime, session: e.session, account: 'account-a' })),
    subscriptions: [{ id: 'paid-1', runtime: 'codex', account: 'account-a', amount: 200, currency: 'EUR', start: t0, end, evidence: 'invoice-1', evidenceKind: 'invoice' }],
    coverage: [{ runtime: 'codex', account: 'account-a', start: t0, end, evidence: 'all-projects-reviewed' }] });
  let r = buildReport(ledger([one, two]), c); assert.equal(r.subscriptions[0].allocation.value, 100);
  assert.equal(r.subscriptions[0].allocation.currency, 'EUR'); assert.equal(r.subscriptions[0].allocation.weightCurrency, 'USD');
  assert.equal(r.subscriptions[0].paid.value, 200);
  const unknown = { ...two, id: 'third', session: identity('codex', 'unknown') };
  assert.equal(buildReport(ledger([one, two, unknown]), c).subscriptions[0].allocation.value, null);
  c.coverage = []; r = buildReport(ledger([one, two]), c); assert.equal(r.subscriptions[0].allocation.value, null);
  assert.ok(r.subscriptions[0].allocation.reasons.includes('all-project-coverage-not-attested'));
});
test('legacy configs keep public arrays empty; dated defaults supply references without inventing payments', () => {
  assert.deepEqual(config().subscriptionCatalog, []); assert.deepEqual(config().subscriptionScenarios, []);
  const defaults = publicSubscriptionDefaults(), c = config(defaults);
  const r = buildReport(ledger([]), c, { now: '2026-09-25T00:00:00.000Z', to: t0 });
  assert.deepEqual(r.subscriptions, []);
  assert.equal(r.publicSubscriptions.comparisons[0].published.value, 500);
  assert.equal(r.publicSubscriptions.comparisons[0].taxInclusive.value, null);
  assert.deepEqual(r.publicSubscriptions.scenarios.map(s => s.taxInclusive.value), [120, 240, null]);
  assert.ok(r.publicSubscriptions.catalog.every(p => p.validity === null && p.sourceAgeDays === 1));
  for (const s of r.publicSubscriptions.scenarios) {
    assert.equal(s.account, null); assert.equal(s.start, null); assert.equal(s.allocation.value, null);
    assert.ok(s.allocation.reasons.includes('period-unavailable')); assert.ok(!('paid' in s));
  }
  const md = markdownReport(r);
  assert.match(md, /published 500 USD\/month; tax-inclusive unavailable/);
  assert.match(md, /https:\/\/support.claude.com/); assert.match(md, /unknown \| unknown \| unavailable/);
  assert.match(md, /not-user-location-evidence/);
});
test('tax-inclusive references stay unchanged and reject contradictory second tax rules', () => {
  const p = catalogPrice({ taxStatus: 'included', taxSource: 'https://help.openai.com/en/articles/9038389-updating-billing-information-tax-id-and-vat-id' });
  const c = config({ subscriptionCatalog: [p], subscriptionScenarios: [scenario({ basis: 'tax-inclusive' })] });
  assert.equal(buildReport(ledger([]), c).publicSubscriptions.scenarios[0].taxInclusive.value, 100);
  assert.throws(() => config({ ...c, subscriptionScenarios: [scenario({ tax: taxRule() })] }), /already included/);
  p.taxStatus = 'excluded';
  assert.equal(buildReport(ledger([]), { ...c, subscriptionCatalog: [p] }).publicSubscriptions.scenarios[0].taxInclusive.value, null);
});
test('public regional prices and currencies never come from FX or a partially known comparison sum', () => {
  const c = config({ subscriptionCatalog: [catalogPrice(), catalogPrice({ id: 'eur', amount: null, currency: 'EUR' }), catalogPrice({ id: 'usd-missing', amount: null })],
    subscriptionScenarios: [scenario(), scenario({ id: 'eur-scenario', catalog: 'eur' }), scenario({ id: 'missing', catalog: 'usd-missing' })] });
  const r = buildReport(ledger([]), c).publicSubscriptions;
  assert.equal(r.comparisons.length, 2);
  assert.ok(r.comparisons.every(c => c.published.value === null));
  assert.equal(r.scenarios[1].published.value, null); assert.equal(r.scenarios[1].published.currency, 'EUR');
  assert.ok(r.scenarios[1].taxInclusive.reasons.includes('regional-price-unavailable'));
  assert.throws(() => config({ subscriptionCatalog: [catalogPrice({ currency: null })] }), /catalog price/);
});
test('scenario allocation reuses paid all-project guards and requires historical price validity for one cycle', () => {
  const one = native(codexRows()).events[0], two = { ...one, id: 'other', session: identity('codex', 'other'), project: 'other' };
  const payment = { id: 'payment', runtime: 'codex', account: 'account-a', amount: 100, currency: 'USD', start: t0, end, evidence: 'synthetic-payment', evidenceKind: 'invoice' };
  const s = scenario({ account: payment.account, start: t0, end, periodEvidence: 'explicit-scenario-period' });
  const c = config({ rates: [rate()], mappings: [one, two].map(e => ({ runtime: e.runtime, session: e.session, account: payment.account })),
    subscriptions: [payment], subscriptionCatalog: [catalogPrice()], subscriptionScenarios: [s],
    coverage: [{ runtime: 'codex', account: payment.account, start: t0, end, evidence: 'all-projects-reviewed' }] });
  const report = (input = c, events = [one, two]) => buildReport(ledger(events), input);
  assert.equal(report().subscriptions[0].allocation.value, 50);
  assert.ok(report().publicSubscriptions.scenarios[0].allocation.reasons.includes('catalog-validity-not-established-for-period'));
  c.subscriptionCatalog[0].validity = { start: t0, end, evidence: 'synthetic-effective-price-period' };
  assert.deepEqual(report().publicSubscriptions.scenarios[0].allocation, { ...report().subscriptions[0].allocation, basis: 'published' });
  for (const input of [{ ...c, coverage: [] }, { ...c, rates: [] }, { ...c, mappings: c.mappings.slice(0, 1) }]) {
    const r = report(input); assert.equal(r.publicSubscriptions.scenarios[0].allocation.value, null);
    assert.deepEqual(r.publicSubscriptions.scenarios[0].allocation.reasons, r.subscriptions[0].allocation.reasons);
  }
  const shorter = report({ ...c, subscriptionScenarios: [{ ...s, end: t2 }] }).publicSubscriptions.scenarios[0];
  assert.equal(shorter.allocation.value, null); assert.ok(shorter.allocation.reasons.includes('period-is-not-one-published-cycle'));
  const missingAccount = { ...s }; delete missingAccount.account;
  assert.equal(report({ ...c, subscriptionScenarios: [missingAccount] }).publicSubscriptions.scenarios[0].allocation.value, null);
  const gap = ledger([one, two]); gap.errors.push({ code: 'source-missing' });
  assert.ok(buildReport(gap, c).publicSubscriptions.scenarios[0].allocation.reasons.includes('source-coverage-gaps'));
});
test('tax-inclusive allocations require both the price and tax validity, never just retrieval dates', () => {
  const e = native(codexRows()).events[0], validity = { start: t0, end, evidence: 'synthetic-validity' };
  const c = config({ rates: [rate()], mappings: [{ runtime: 'codex', session: e.session, account: 'account' }],
    coverage: [{ runtime: 'codex', account: 'account', start: t0, end, evidence: 'coverage' }],
    subscriptionCatalog: [catalogPrice({ validity, taxStatus: 'excluded', taxSource: 'https://help.openai.com/' })],
    subscriptionScenarios: [scenario({ account: 'account', start: t0, end, periodEvidence: 'period', basis: 'tax-inclusive', tax: taxRule() })] });
  let s = buildReport(ledger([e]), c).publicSubscriptions.scenarios[0];
  assert.equal(s.taxInclusive.value, 120); assert.equal(s.allocation.value, null);
  assert.ok(s.allocation.reasons.includes('tax-validity-not-established-for-period'));
  c.subscriptionScenarios[0].tax.validity = validity;
  s = buildReport(ledger([e]), c).publicSubscriptions.scenarios[0]; assert.equal(s.allocation.value, 120);
});
test('catalog and tax imports reject ambiguous periods, unsafe or nonofficial provenance and invalid dates', () => {
  const check = (p = catalogPrice(), s = scenario()) => config({ subscriptionCatalog: [p], subscriptionScenarios: [s] });
  for (const source of ['https://help.openai.com/?token=SECRET', 'https://user:SECRET@help.openai.com/', 'https://help.openai.com/#SECRET', 'https://help.openai.com.attacker.test/', 'https://www.economie.gouv.fr/']) {
    assert.throws(() => check(catalogPrice({ source })), /provenance/);
  }
  for (const retrievedAt of ['yesterday', '2026-02-30', null]) assert.throws(() => check(catalogPrice({ retrievedAt })), /provenance/);
  assert.throws(() => check(catalogPrice({ validity: { start: t0, end } })), /evidence/);
  assert.throws(() => check(catalogPrice({ taxStatus: 'excluded' })), /tax provenance/);
  assert.throws(() => check(catalogPrice(), scenario({ start: t0 })), /period/);
  assert.throws(() => check(catalogPrice(), scenario({ tax: taxRule({ source: 'https://example.com/tax' }) })), /provenance/);
  assert.throws(() => check(catalogPrice(), scenario({ tax: taxRule({ rate: 20 }) })), /scenario tax/);
  assert.throws(() => config({ subscriptionCatalog: [catalogPrice()], subscriptions: [scenario()] }), /subscription/);
});
test('report periods exclude straddling consumption without changing whole-subscription allocation', () => {
  const e = native(codexRows()).events[0]; e.from = t0;
  const r = buildReport(ledger([e]), config(), { from: '2026-09-01T00:00:30.000Z' });
  assert.equal(r.byRuntime.codex.included, 0); assert.equal(r.inventory[0].excluded, 'crosses-report-period');
  assert.throws(() => buildReport(ledger([e]), config(), { from: end, to: t0 }), /period/);
});
test('configuration rejects unknown fields, unsafe references, ambiguous periods and invented zeros', () => {
  assert.throws(() => config({ secrets: 'SECRET' }), /fields/);
  assert.throws(() => config({ rates: [rate({ source: 'https://developers.openai.com/pricing?key=SECRET' })] }), /provenance/);
  assert.throws(() => config({ rates: [rate(), rate({ id: 'second' })] }), /overlapping/);
  assert.throws(() => config({ rates: [rate({ perMillion: { output: -1 } })] }), /nonnegative/);
  assert.throws(() => config({ subscriptions: [{ id: 'missing' }] }), /subscription/);
  assert.throws(() => config({ mappings: [{ runtime: 'codex', session: 'invented-session' }] }), /hashed/);
});
test('scanner is idempotent, preserves rotations/deletions and reads only allowlisted files', async t => {
  const dir = await temporary(t), source = join(dir, 'source'), state = join(dir, 'costs'); await mkdir(source);
  const path = join(source, 'session.jsonl'); await writeFile(path, jsonl(codexRows()));
  await writeFile(join(source, 'auth.json'), 'SECRET_CREDENTIALS');
  const c = config({ sources: [{ id: 'fixture', kind: 'codex', path: source }] });
  let result = await scanCosts(state, c); assert.equal(result.changed, 1);
  result = await scanCosts(state, c); assert.equal(result.changed, 0); assert.equal(result.unchanged, 1);
  await copyFile(path, join(source, 'copy.jsonl')); await scanCosts(state, c);
  let saved = JSON.parse(await readFile(join(state, 'ledger.json')));
  assert.equal(buildReport(saved, c).coverage.uniqueEvents, 1);
  await writeFile(path, jsonl(codexRows({ id: 'new' }))); await scanCosts(state, c);
  saved = JSON.parse(await readFile(join(state, 'ledger.json'))); assert.equal(buildReport(saved, c).coverage.uniqueEvents, 2);
  await rm(path); await scanCosts(state, c); saved = JSON.parse(await readFile(join(state, 'ledger.json')));
  assert.equal(buildReport(saved, c).coverage.uniqueEvents, 2); assert.ok(Object.values(saved.files).some(f => f.missing));
  assert.ok(!JSON.stringify(saved).includes('SECRET')); assert.equal((await stat(join(state, 'ledger.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(state)).mode & 0o777, 0o700);
});
test('partial final lines are deferred; corrupt rows produce gaps without wiping earlier evidence', async t => {
  const dir = await temporary(t), source = join(dir, 'source'), state = join(dir, 'costs'); await mkdir(source);
  const path = join(source, 'session.jsonl'), rows = codexRows(), final = JSON.stringify(rows.pop());
  await writeFile(path, jsonl(rows) + final.slice(0, 50));
  const c = config({ sources: [{ id: 'fixture', kind: 'codex', path: source }] });
  await scanCosts(state, c); let saved = JSON.parse(await readFile(join(state, 'ledger.json')));
  assert.equal(buildReport(saved, c).coverage.uniqueEvents, 0);
  await appendFile(path, final.slice(50) + '\n'); await scanCosts(state, c);
  saved = JSON.parse(await readFile(join(state, 'ledger.json'))); assert.equal(buildReport(saved, c).coverage.uniqueEvents, 1);
  await writeFile(path, '{BROKEN_SECRET}\n'); await scanCosts(state, c);
  saved = JSON.parse(await readFile(join(state, 'ledger.json'))); assert.equal(buildReport(saved, c).coverage.uniqueEvents, 1);
  assert.ok(!JSON.stringify(saved).includes('BROKEN_SECRET'));
  assert.ok(buildReport(saved, c).coverage.gaps.some(g => g.code === 'source-truncated-history-retained'));
});
test('collector serializes writes and preserves corrupted state for investigation', async t => {
  const dir = await temporary(t);
  await withCostLock(dir, async () => { await assert.rejects(withCostLock(dir, () => assert.fail()), /busy|uncertain/); });
  await writeFile(join(dir, 'ledger.json'), '{bad');
  await assert.rejects(scanCosts(dir, config()), /invalid private state/);
  assert.equal(await readFile(join(dir, 'ledger.json'), 'utf8'), '{bad');
  await writeFile(join(dir, 'collector.lock'), '');
  await assert.rejects(withCostLock(dir, () => assert.fail()), /invalid private state/);
});
test('local CLI imports config and reports without credentials; watch stops without touching workers', async t => {
  const dir = await temporary(t), state = join(dir, 'state'), path = join(dir, 'configuration.json');
  await writeFile(path, JSON.stringify(config()));
  assert.equal((await costsCommand(dir, state, ['import'], { file: path })).imported, true);
  await costsCommand(dir, state, ['scan']);
  const report = await costsCommand(dir, state, ['report']); assert.equal(report.coverage.complete, false);
  const markdown = await costsCommand(dir, state, ['report'], { format: 'markdown' }); assert.match(markdown, /unavailable/);
  assert.equal(markdown, markdownReport(report));
  assert.equal((await costsCommand(dir, state, ['status'])).available, true);
  await assert.rejects(costsCommand(dir, state, ['watch'], { interval: 0 }), /interval/);
  const abort = new AbortController(); const pending = costsCommand(dir, state, ['watch'], { interval: 10 }, { signal: abort.signal });
  await new Promise(r => setTimeout(r, 100)); abort.abort(); assert.equal((await pending).stopped, true);
  assert.equal((await costsCommand(dir, state, ['status'])).collector.state, 'stopped');
  assert.throws(() => parseCommandArgs('costs', ['scan', '--file', path]), /unknown option/);
});
test('canonical command routing loads costs lazily and stays offline in an isolated checkout', async t => {
  const dir = await temporary(t); await mkdir(join(dir, 'scripts')); await mkdir(join(dir, '.dev-state', 'costs'), { recursive: true });
  const { readdir } = await import('node:fs/promises');
  for (const f of await readdir(new URL('../scripts', import.meta.url))) if (/^linear_.*\.mjs$/.test(f)) await copyFile(new URL('../scripts/' + f, import.meta.url), join(dir, 'scripts', f));
  await writeFile(join(dir, '.dev-state', 'costs', 'config.json'), JSON.stringify(config()));
  const run = (...args) => exec(process.execPath, [join(dir, 'scripts', 'linear_agent.mjs'), 'costs', ...args], { env: { PATH: process.env.PATH } });
  assert.equal(JSON.parse((await run('scan')).stdout).files, 0);
  assert.equal(JSON.parse((await run('report')).stdout).coverage.complete, false);
  assert.match((await run('report', '--format', 'markdown')).stdout, /Subscription/);
});
test('Codex fork header precedes copied ancestor metadata; inherited history is not charged again', () => {
  const parent = codexRows({ id: 'parent' });
  const childHeader = { type: 'session_meta', timestamp: t1, payload: { id: 'child', cwd: '/project', timestamp: t1,
    forked_from_id: 'parent', subagent_history_start_ordinal: 3 } };
  parent[2].timestamp = t0;
  const childUsage = { ...parent[2], timestamp: t2 };
  const p = native([childHeader, ...parent, { ...parent[1], timestamp: t1 }, childUsage]);
  assert.equal(p.events.length, 1); assert.equal(p.events[0].session, identity('codex', 'child'));
  assert.ok(p.gaps.includes('inherited-header-excluded')); assert.ok(p.gaps.includes('inherited-history-excluded'));
});
test('truncation to an early Claude snapshot cannot erase previously observed final counters', async t => {
  const dir = await temporary(t), source = join(dir, 'source'), state = join(dir, 'costs'); await mkdir(source);
  const path = join(source, 'session.jsonl'); const c = config({ sources: [{ id: 'fixture', kind: 'claude', path: source }] });
  await writeFile(path, jsonl([claudeRow()])); await scanCosts(state, c);
  await writeFile(path, jsonl([claudeRow({ stop: null, output: 1 })])); await scanCosts(state, c);
  const r = buildReport(JSON.parse(await readFile(join(state, 'ledger.json'))), c);
  assert.equal(r.byRuntime.claude.normalized.output.value, 10);
});
test('offset dates normalize before period comparisons and duplicate-source ambiguity never allocates a bill', () => {
  const c = config({ rates: [rate({ start: '2026-09-01T01:00:00+01:00' })] });
  assert.equal(c.rates[0].start, t0);
  const event = native(codexRows()).events[0];
  assert.ok(priceEvent(event, c.rates).value > 0);
});
test('conflicting service tiers refuse pricing independently of source enumeration order', () => {
  const a = native([claudeRow()], 'claude').events[0], b = { ...a, tier: 'priority' };
  for (const pair of [[a, b], [b, a]]) {
    const e = reconcileEvents(pair)[0]; assert.equal(e.tier, null);
    assert.match(priceEvent(e, [rate({ runtime: 'claude' })]).reason, /service-tier-conflict/);
  }
});
test('adding a historical worktree root repairs derived attribution while preserving counters', async t => {
  const dir = await temporary(t), source = join(dir, 'source'), state = join(dir, 'costs'); await mkdir(source);
  const path = join(source, 'session.jsonl'); await writeFile(path, jsonl(codexRows({ cwd: '/old-worktree' })));
  const c = config({ sources: [{ id: 'fixture', kind: 'codex', path: source }] }); await scanCosts(state, c);
  c.projectRoots.push('/old-worktree'); await scanCosts(state, c);
  const r = buildReport(JSON.parse(await readFile(join(state, 'ledger.json'))), c);
  assert.equal(r.byRuntime.codex.normalized.inputTotal.value, 100); assert.equal(r.inventory[0].project, 'jaunt');
});
test('event mappings can attribute a classifier account without inventing its session or price', () => {
  const r = attempt(); r.telemetry.requested.routing = { at: t0, phase: 'planning', classifier: { observedModels: ['observed-model'], usage: { inputTokens: 5 } } };
  const events = readAttempt(JSON.stringify(r)).events, classifier = events.find(e => e.role === 'classifier');
  const c = config({ mappings: [{ runtime: 'claude', event: classifier.id, account: 'paid-account' }] });
  const report = buildReport(ledger(events), c), entry = report.inventory.find(e => e.role === 'classifier');
  assert.equal(entry.account, 'paid-account'); assert.equal(entry.session, null); assert.equal(entry.price.value, null);
});
test('context pricing bands and snapshot time boundaries refuse an unsupported short-context price', () => {
  const e = native(codexRows()).events[0];
  assert.equal(priceEvent(e, [rate({ maxInputTokens: 100 })]).value, null);
  assert.ok(priceEvent(e, [rate({ minInputTokens: 100 })]).value > 0);
  const a = native([claudeRow({ stop: null })], 'claude').events[0], b = native([claudeRow()], 'claude').events[0]; b.at = t2;
  const merged = reconcileEvents([a, b])[0]; assert.equal(merged.from, t1); assert.equal(merged.at, t2);
  assert.equal(priceEvent(merged, [rate({ runtime: 'claude', start: t2 })]).value, null);
});
