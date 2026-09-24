// Metadata-only readers. Provider text is never retained, returned or logged.
import { createHash } from 'node:crypto';
import { resolve, relative, sep, basename } from 'node:path';
import { attemptTelemetry } from './linear_telemetry.mjs';

export const digest = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex');
export const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const label = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(value) ? value : null;
export const identity = (runtime, value) => typeof value === 'string' && value.length > 0 && value.length <= 512 ? digest(`${runtime}:${value}`) : null;
export const TOKEN_FIELDS = ['input', 'cached', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h', 'output', 'reasoning'];
export function projectOf(cwd, roots) {
  if (typeof cwd !== 'string' || !cwd.startsWith('/')) return 'unknown';
  return roots.some(root => { const r = relative(resolve(root), resolve(cwd)); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !r.startsWith(sep)); }) ? 'jaunt' : 'other';
}
export function tokens(raw, runtime) {
  const u = raw || {};
  return runtime === 'codex'
    ? { input: count(u.input_tokens), cached: count(u.cached_input_tokens), cacheWrite: count(u.cache_write_input_tokens),
      cacheWrite5m: null, cacheWrite1h: null, output: count(u.output_tokens), reasoning: count(u.reasoning_output_tokens) }
    : { input: count(u.input_tokens), cached: count(u.cache_read_input_tokens), cacheWrite: count(u.cache_creation_input_tokens),
      cacheWrite5m: count(u.cache_creation?.ephemeral_5m_input_tokens), cacheWrite1h: count(u.cache_creation?.ephemeral_1h_input_tokens),
      output: count(u.output_tokens), reasoning: null };
}
const hasTokens = u => TOKEN_FIELDS.some(k => u[k] !== null);
const sameTokens = (a, b) => ['input', 'cached', 'output', 'cacheWrite', 'reasoning'].every(k => a[k] === b[k]);
const issueOf = value => typeof value === 'string' && /^[A-Z][A-Z0-9]*-\d+$/.test(value) ? value : null;
function base(runtime, source, session, at, project) {
  return { runtime, source, session, at, from: at, project, role: 'unknown', issue: null, model: null, parent: null,
    partial: false, priceGaps: [], usage: null, reportedEstimate: null };
}
// Full-file parsing is used only for changed files. Repeated snapshots are
// reconciled later, across all copies as well as within a file.
export function readNative(text, { runtime, path, projectRoots }) {
  const events = [], gaps = new Set();
  let session = null, parent = null, fork = false, started = null, model = null, project = 'unknown', previous = null, previousAt = null;
  let role = 'unknown', sawUsage = false, sawMeta = false, tier = null;
  const lines = text.split('\n');
  if (lines.at(-1)?.trim()) gaps.add('incomplete-tail');
  // A non-newline-terminated record may still be in the middle of a write.
  lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { gaps.add('malformed-jsonl'); continue; }
    if (!e || typeof e !== 'object') { gaps.add('unsupported-record'); continue; }
    const p = e.payload && typeof e.payload === 'object' ? e.payload : {};
    const at = time(e.timestamp);
    if (runtime === 'codex') {
      if (e.type === 'session_meta') {
        const next = identity(runtime, p.id);
        if (sawMeta && next !== session) {
          // Codex forks prepend their own header to copied ancestor headers.
          // Only explicitly older headers in a declared fork are inherited.
          const inheritedAt = time(p.timestamp) || at;
          if (fork && inheritedAt && started && inheritedAt < started) { gaps.add('inherited-header-excluded'); continue; }
          gaps.add('multiple-session-identities'); return { events: [], gaps: [...gaps] };
        }
        if (sawMeta) continue;
        sawMeta = true; session = next; started = time(p.timestamp) || at;
        const spawn = p.source?.subagent?.thread_spawn;
        parent = identity(runtime, p.parent_thread_id || spawn?.parent_thread_id || p.forked_from_id);
        fork = Boolean(p.forked_from_id || p.subagent_history_start_ordinal !== undefined);
        role = parent || p.source?.subagent ? 'subagent' : 'unknown';
        project = projectOf(p.cwd, projectRoots);
      }
      if (e.type === 'turn_context' && (!started || !at || at >= started)) {
        model = label(p.model); tier = label(p.service_tier);
        if (p.cwd !== undefined) project = projectOf(p.cwd, projectRoots);
      }
      if (e.type !== 'event_msg' || p.type !== 'token_count') continue;
      sawUsage = true;
      if (!session || !at || !p.info?.total_token_usage) { gaps.add('codex-usage-without-identity-or-total'); continue; }
      if (started && at < started) { gaps.add('inherited-history-excluded'); continue; }
      const total = tokens(p.info.total_token_usage, runtime), last = tokens(p.info.last_token_usage, runtime);
      if (!['input', 'output'].every(k => total[k] !== null && last[k] !== null)) { gaps.add('unsupported-codex-counter'); continue; }
      if (previous && sameTokens(total, previous)) continue;
      let u = last, from = previousAt || at, partial = false, effectiveModel = model;
      if (!previous) {
        if (fork || !sameTokens(total, last)) { gaps.add('missing-cumulative-baseline'); partial = true; }
        // A fork's first snapshot can be inherited even with a new timestamp.
        if (fork && !sameTokens(total, last)) { previous = total; previousAt = at; continue; }
      } else {
        const decreased = TOKEN_FIELDS.some(k => total[k] !== null && previous[k] !== null && total[k] < previous[k]);
        if (decreased) { gaps.add('cumulative-counter-reset'); previous = total; previousAt = at; continue; }
        const delta = Object.fromEntries(TOKEN_FIELDS.map(k => [k, total[k] !== null && previous[k] !== null ? total[k] - previous[k] : null]));
        if (!sameTokens(delta, last)) { u = delta; partial = true; effectiveModel = null; gaps.add('cumulative-gap-model-unallocated'); }
      }
      previous = total; previousAt = at;
      const event = { ...base(runtime, 'native', session, at, project),
        id: digest(`codex:${session}:${at}:${JSON.stringify(total)}`), parent, role, model: effectiveModel, tier,
        from, partial, usage: u, priceGaps: [] };
      if (!tier) event.priceGaps.push('service-tier-unavailable');
      if (u.cacheWrite === null || u.cacheWrite > 0) event.priceGaps.push('codex-cache-write-scope-unverified');
      events.push(event);
    } else {
      if (e.type !== 'assistant') continue;
      const m = e.message;
      if (!m?.usage) continue;
      sawUsage = true;
      session = identity(runtime, e.sessionId || e.session_id);
      const message = identity(runtime, m.id);
      if (!session || !message || !at) { gaps.add('claude-usage-without-identity'); continue; }
      const u = tokens(m.usage, runtime);
      if (!hasTokens(u)) { gaps.add('unsupported-claude-counter'); continue; }
      // A terminal message snapshot is stronger evidence than output=1 at start.
      const final = ['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'].includes(m.stop_reason);
      if (!final) u.output = null;
      const isChild = Boolean(e.isSidechain || e.agentId || path.split(sep).includes('subagents'));
      const agent = e.agentId || (isChild ? basename(path, '.jsonl') : null);
      const child = agent ? identity(runtime, `${e.sessionId || e.session_id}:agent:${agent}`) : session;
      const event = { ...base(runtime, 'native', child, at, projectOf(e.cwd, projectRoots)),
        id: digest(`claude:message:${message}`), parent: isChild ? session : null,
        role: isChild ? 'subagent' : 'unknown', model: label(m.model), tier: label(m.usage.service_tier),
        partial: !final, usage: u, priceGaps: [] };
      if (!event.tier) event.priceGaps.push('service-tier-unavailable');
      if (m.usage.inference_geo && m.usage.inference_geo !== 'global') event.priceGaps.push('regional-pricing-unverified');
      if (m.usage.speed && m.usage.speed !== 'standard') event.priceGaps.push('speed-pricing-unverified');
      if (Object.values(m.usage.server_tool_use || {}).some(v => number(v) > 0)) event.priceGaps.push('tool-fees-excluded');
      events.push(event);
    }
  }
  if (!sawUsage) gaps.add('no-supported-usage');
  return { events, gaps: [...gaps] };
}

const runtimeOwner = owner => ['codex', 'claude'].includes(owner?.runtime) ? identity(owner.runtime, owner.thread) : null;
export function readAttempt(text) {
  let r;
  try { r = JSON.parse(text); } catch { return { events: [], gaps: ['malformed-attempt'] }; }
  if (!r || !['codex', 'claude'].includes(r.runtime) || !issueOf(r.issue) || !label(r.attempt) || !time(r.startedAt)) {
    return { events: [], gaps: ['unsupported-attempt-identity'] };
  }
  const gaps = [], events = [];
  let a;
  try { a = attemptTelemetry(r); } catch { return { events, gaps: ['unsupported-attempt-telemetry'] }; }
  const u = { input: count(a.usage.inputTokens.value), cached: count(a.usage.cachedInputTokens.value),
    cacheWrite: count(a.usage.cacheCreationInputTokens.value), output: count(a.usage.outputTokens.value),
    cacheWrite5m: null, cacheWrite1h: null, reasoning: null };
  const session = identity(r.runtime, r.session), at = time(r.endedAt) || time(r.startedAt);
  const event = { ...base(r.runtime, 'attempt', session, at, 'jaunt'),
    id: digest(`attempt:${r.issue}:${r.claimedAt}:${r.attempt}`), issue: r.issue, role: 'worker', from: time(r.startedAt),
    model: a.observed.models.value?.length === 1 ? label(a.observed.models.value[0]) : null,
    partial: a.outcome.coverage !== 'reported terminal usage', usage: u, tier: null,
    priceGaps: ['attempt-price-context-unavailable'],
    ownerSession: runtimeOwner(r.owner),
    reportedEstimate: number(a.reportedCost.value) === null ? null : { value: a.reportedCost.value, currency: 'USD',
      kind: 'estimated', scope: a.reportedCost.scope, source: 'client-price-table', includesSubagents: true } };
  if (!hasTokens(u)) gaps.push('attempt-usage-unavailable');
  if (!session) gaps.push('attempt-session-unavailable');
  events.push(event);
  const routing = r.telemetry?.requested?.routing, c = routing?.classifier;
  if (c) {
    const stamp = time(routing.at), phase = label(routing.phase);
    const cu = c.usage || {};
    const usage = { input: count(cu.inputTokens), cached: count(cu.cacheReadInputTokens), cacheWrite: count(cu.cacheCreationInputTokens),
      output: count(cu.outputTokens), cacheWrite5m: null, cacheWrite1h: null, reasoning: null };
    const ce = { ...base('claude', 'classifier', null, stamp, 'jaunt'),
      id: digest(`classifier:${r.issue}:${stamp || r.attempt}:${phase || 'unknown'}`), issue: r.issue,
      role: 'classifier', usage, partial: !stamp || !phase,
      model: c.observedModels?.length === 1 ? label(c.observedModels[0]) : null, tier: null,
      priceGaps: ['classifier-price-context-unavailable'],
      reportedEstimate: number(c.costUsd?.value) === null ? null : { value: c.costUsd.value, currency: 'USD', kind: 'estimated', scope: 'classification', source: 'client-price-table', includesSubagents: false } };
    if (!stamp || !phase) { ce.excluded = 'classifier-identity-unavailable'; gaps.push(ce.excluded); }
    events.push(ce);
  }
  return { events, gaps };
}

// Event identities deduplicate transcript copies and copied classifier results.
// Conflicting counters never choose whichever source happened to be read last.
export function reconcileEvents(input, mappings = []) {
  const unique = new Map();
  for (const raw of input) {
    const e = structuredClone(raw), prior = unique.get(e.id);
    if (!prior) { unique.set(e.id, e); continue; }
    if (prior.runtime !== e.runtime || prior.source !== e.source) { prior.excluded = 'identity-conflict'; continue; }
    if (prior.session !== e.session && e.runtime === 'codex') prior.excluded = 'session-conflict';
    for (const k of TOKEN_FIELDS) {
      const a = prior.usage?.[k], b = e.usage?.[k];
      if (a === null && b !== null) prior.usage[k] = b;
      else if (a !== null && b !== null && a !== b) {
        // Only output grows over Claude native streaming snapshots.
        if (e.runtime === 'claude' && e.source === 'native' && k === 'output') prior.usage[k] = Math.max(a, b);
        else prior.excluded = 'counter-conflict';
      }
    }
    if (prior.project !== e.project) { prior.project = 'unknown'; prior.attributionConflict = true; }
    if (prior.session !== e.session) { prior.role = 'unknown'; prior.parent = null; }
    if (prior.tier !== e.tier) { prior.tier = null; prior.priceGaps.push('service-tier-conflict'); }
    if (prior.model !== e.model) { prior.model = null; prior.priceGaps.push('model-conflict'); }
    if (e.at && (!prior.at || e.at > prior.at)) prior.at = e.at;
    if (e.from && (!prior.from || e.from < prior.from)) prior.from = e.from;
    prior.partial = prior.partial && e.partial;
    prior.priceGaps = [...new Set([...prior.priceGaps, ...e.priceGaps])];
  }
  const events = [...unique.values()];
  const nativeSessions = new Set(events.filter(e => e.source === 'native').map(e => e.session));
  const attempts = events.filter(e => e.source === 'attempt');
  const owners = new Set(attempts.map(e => e.ownerSession).filter(Boolean));
  for (const e of events) {
    const mapping = mappings.find(m => m.runtime === e.runtime && m.event === e.id) || mappings.find(m => m.runtime === e.runtime && m.session && m.session === e.session);
    e.account = mapping?.account || null;
    if (mapping?.role) e.role = mapping.role;
    if (mapping?.project) e.project = mapping.project;
    if (e.source === 'attempt') {
      if (!e.session) e.excluded ||= 'attempt-session-unavailable';
      else if (nativeSessions.has(e.session)) e.excluded ||= 'native-source-preferred';
      else if (attempts.some(a => a.id !== e.id && a.runtime === e.runtime && a.session === e.session && a.from <= e.at && a.at >= e.from)) e.excluded ||= 'overlapping-attempts';
    } else if (e.source === 'native' && e.role === 'unknown') {
      const matching = attempts.filter(a => a.runtime === e.runtime && a.session === e.session && a.from <= e.at && a.at >= e.from);
      if (matching.length === 1) { e.role = 'worker'; e.issue = matching[0].issue; if (!e.attributionConflict) e.project = 'jaunt'; }
      else if (owners.has(e.session)) e.role = 'orchestrator';
    }
  }
  // Parent evidence only supplies missing project/role, never a billing account.
  for (let n = 0; n < 10; n++) {
    let changed = false;
    for (const e of events) {
      if (!e.parent || e.project !== 'unknown' || e.attributionConflict) continue;
      const projects = new Set(events.filter(p => p.runtime === e.runtime && p.session === e.parent).map(p => p.project));
      if (projects.size === 1 && !projects.has('unknown')) { e.project = [...projects][0]; changed = true; }
    }
    if (!changed) break;
  }
  return events.sort((a, b) => (a.at || '').localeCompare(b.at || '') || a.id.localeCompare(b.id));
}
