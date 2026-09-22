// Durable, local accounting. No provider text or routing decisions are replayed.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const hash = text => createHash('sha256').update(text).digest('hex');
const numeric = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const label = x => typeof x === 'string' && /^[a-zA-Z0-9_.:/-]{1,160}$/.test(x) ? x : null;
const fields = ['inputTokens', 'cachedInputTokens', 'cacheCreationInputTokens', 'outputTokens', 'costUsd'];
const ms = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;
const duration = (start, end) => ms(start) !== null && ms(end) !== null && ms(end) >= ms(start) ? ms(end) - ms(start) : null;
const unavailable = reason => ({ value: null, kind: 'unavailable', reason });
const measured = (value, source) => ({ value, kind: 'measured', source });
async function read(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function entries(path) {
  try { return await readdir(path, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
}
export function telemetryArchivePath(state, claim) {
  return join(state, 'workers', claim.issue, hash(claim.claimedAt), 'telemetry-claim.json');
}

// History shares the claim's atomic commit. Wrapper updates own attempt files,
// so a late final event cannot overwrite a claim transition or release archive.
export function phaseHistory(record, previous) {
  const known = previous?.telemetryHistory;
  const history = known ? structuredClone(known) : { version: 1, complete: !previous, transitions: [] };
  if (history.version !== 1 || !Array.isArray(history.transitions)) throw Error('unsupported phase telemetry history');
  if (!history.transitions.length && previous) {
    history.transitions.push({ phase: previous.phase, at: record.updatedAt, source: 'first observation; earlier history unavailable' });
  }
  if (history.transitions.at(-1)?.phase !== record.phase) {
    history.transitions.push({ phase: record.phase, at: record.updatedAt, source: 'claim transition' });
  }
  return history;
}
export function archiveClaim(claim, receipt, issue) {
  return { version: 1, issue: claim.issue, claimedAt: claim.claimedAt,
    runtime: claim.runtime || 'claude', session: claim.session || null,
    history: claim.telemetryHistory || null,
    release: { at: receipt.releasedAt, mode: receipt.mode, state: issue.state.type,
      source: 'verified Linear state at release; not a PR merge assertion' } };
}

// Keep the launch contract unchanged; provenance is additional evidence only.
export function settingSources(runtime, previous, options, env, mode) {
  const prefix = runtime === 'claude' ? 'JAUNT_CLAUDE' : 'JAUNT_CODEX';
  const source = key => mode === 'recovery' || mode === 'routed-resume' ? mode
    : options[key] ? 'explicit option' : previous?.[key] ? 'saved setting'
      : env[`${prefix}_${key.toUpperCase()}`] ? 'runtime environment' : 'runtime default (not observed)';
  return { model: source('model'), effort: source('effort'),
    // Explicit operator metadata, never copied from a prompt or provider output.
    rationale: typeof options.rationale === 'string' ? options.rationale.slice(0, 1000) : null };
}
export function startTelemetry(record) {
  return { version: 1, requested: { model: label(record.model), effort: label(record.effort),
    sources: record.settingSources || null }, models: [], runtimeVersion: null, reportedCost: null, crashedResult: false, turn: 0, turns: {}, messages: {}, result: null };
}
function usage(value, runtime, source) {
  const result = { source };
  const names = runtime === 'codex'
    ? { inputTokens: 'input_tokens', cachedInputTokens: 'cached_input_tokens', outputTokens: 'output_tokens' }
    : { inputTokens: 'input_tokens', cachedInputTokens: 'cache_read_input_tokens', cacheCreationInputTokens: 'cache_creation_input_tokens', outputTokens: 'output_tokens' };
  for (const [key, name] of Object.entries(names)) if (Number.isSafeInteger(value?.[name]) && value[name] >= 0) result[key] = value[name];
  return result;
}
// Consume only supported metadata shapes. A Claude result supersedes message
// snapshots; Codex totals are per turn, not the resumed thread's lifetime total.
export function observeTelemetry(record, event) {
  if (!record.telemetry || !event || typeof event !== 'object') return;
  const t = record.telemetry;
  if (record.runtime === 'codex') {
    if (event.type === 'turn.started') t.turn++;
    if (event.type === 'turn.completed') t.turns[t.turn] = usage(event.usage, 'codex', 'codex turn.completed.usage');
  } else if (record.runtime === 'claude') {
    if (event.type === 'system' && event.subtype === 'init' && /^\d+\.\d+\.\d+$/.test(event.claude_code_version || '')) {
      t.runtimeVersion = event.claude_code_version;
    }
    if (event.type === 'assistant' && !event.parent_tool_use_id) {
      const model = label(event.message?.model);
      if (model && !t.models.includes(model)) t.models.push(model);
      // No message id means no safe way to reconcile repeated snapshots.
      const id = label(event.message?.id);
      if (id && event.message?.usage && !Object.hasOwn(t.messages, id)) {
        const snapshot = usage(event.message.usage, 'claude', 'claude assistant.message.usage (partial)');
        delete snapshot.outputTokens; // placeholder at message_start, not final output
        t.messages = { ...t.messages, [id]: snapshot }; // computed key cannot mutate the prototype
      }
    }
    if (event.type === 'result') {
      if (event.subtype === 'error_during_execution') { t.crashedResult = true; return; }
      t.result = usage(event.usage, 'claude', 'claude result.usage');
      t.reportedCost = numeric(event.total_cost_usd) ? event.total_cost_usd : null;
    }
  }
}
function metric(samples, key, complete) {
  const values = samples.filter(s => numeric(s[key]));
  if (!values.length) return unavailable('runtime did not report this metric');
  return { ...measured(values.reduce((sum, s) => sum + s[key], 0), [...new Set(values.map(s => key === 'costUsd' ? 'claude result.total_cost_usd' : s.source))]),
    complete: complete && values.length === samples.length,
    reportedSamples: values.length, totalSamples: samples.length };
}
export function attemptTelemetry(record) {
  const t = record.telemetry;
  if (t && t.version !== 1) throw Error('unsupported attempt telemetry version');
  const samples = !t ? [] : record.runtime === 'claude' ? t.result ? [t.result] : Object.values(t.messages) : Object.values(t.turns);
  const terminal = Boolean(t && (record.runtime === 'claude' ? t.result : Object.keys(t.turns).length));
  const allTurns = !t || record.runtime !== 'codex' || (t.turn > 0 && Object.keys(t.turns).length >= t.turn);
  const complete = Boolean(allTurns && record.childExited && record.code === 0 && !record.failure && !record.cancelled && !t?.crashedResult && terminal);
  return { attempt: record.attempt, runtime: record.runtime, runtimeVersion: t?.runtimeVersion || null, session: record.session || null,
    mode: record.launchMode || (record.resume ? 'resume (legacy; recovery unknown)' : 'legacy; launch mode unknown'),
    phaseAtStart: record.phaseAtStart || null, startedAt: record.startedAt, endedAt: record.endedAt || null,
    executionElapsedMs: duration(record.startedAt, record.endedAt),
    outcome: { exitCode: record.code ?? null, failure: record.failure?.kind || null, cancelled: record.cancelled || null,
      terminalUsageReceived: terminal, coverage: complete ? 'reported terminal usage' : 'partial or unavailable' },
    requested: t?.requested || { model: label(record.model), effort: label(record.effort), sources: null },
    observed: { models: t?.models?.length ? measured(t.models, 'claude assistant.message.model') : unavailable('no effective model evidence in supported stream'),
      effort: unavailable('effective effort not reported by supported stream') },
    reportedCost: numeric(t?.reportedCost) ? { value: t.reportedCost, kind: 'estimated',
      source: 'claude result.total_cost_usd; client price table', scope: claudeCostScope(t.runtimeVersion) }
      : unavailable('no trustworthy runtime cost result'),
    usage: Object.fromEntries(fields.map(key => [key, metric(samples, key, complete)])),
    phaseAllocation: unavailable('usage is reported per turn/invocation; no verified phase boundaries') };
}
function subtotal(attempts, key) {
  const known = attempts.filter(a => numeric(a.usage[key].value));
  return { value: known.length ? known.reduce((s, a) => s + a.usage[key].value, 0) : null,
    kind: known.length ? key === 'costUsd' ? 'estimated' : 'measured' : 'unavailable',
    complete: attempts.length > 0 && known.length === attempts.length && known.every(a => a.usage[key].complete),
    reportedAttempts: known.length, totalAttempts: attempts.length };
}
function claudeCostScope(version) {
  const parts = typeof version === 'string' && /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!parts || +parts[1] !== 2) return 'unknown';
  return +parts[2] > 1 || (+parts[2] === 1 && +parts[3] >= 277) ? 'session' : 'invocation';
}
// Costs are client estimates. New Claude restores session totals on resume;
// only a consecutive, normally exited baseline supports an attempt delta.
function reconcileCosts(records, attempts) {
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i], r = records[i], cost = a.reportedCost;
    if (!numeric(cost.value)) continue;
    const previous = attempts[i - 1], previousRecord = records[i - 1];
    const fresh = r.launchMode === 'start' && !r.resume;
    let value = null, source = null;
    if (cost.scope === 'invocation' || fresh) {
      value = cost.value; source = fresh ? 'new session result estimate' : 'pre-2.1.277 invocation result estimate';
    } else if (cost.scope === 'session' && a.session && previous?.session === a.session &&
        previous.reportedCost.scope === 'session' && numeric(previous.reportedCost.value) &&
        previousRecord.childExited && previousRecord.code === 0 && !previousRecord.failure && !previousRecord.cancelled &&
        !previousRecord.telemetry?.crashedResult && duration(previous.endedAt, a.startedAt) !== null &&
        cost.value >= previous.reportedCost.value) {
      value = cost.value - previous.reportedCost.value;
      source = `session estimate delta from attempt ${previous.attempt}`;
    }
    a.usage.costUsd = value === null ? unavailable('cost scope or consecutive restored baseline unavailable')
      : { value, kind: 'estimated', source, complete: a.outcome.coverage === 'reported terminal usage' };
  }
}
export async function telemetryReport(state, id, now = new Date().toISOString()) {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(id || '')) throw Error('telemetry requires an issue identifier');
  const active = await read(join(state, 'claims', `${id}.json`));
  const dirs = new Set((await entries(join(state, 'workers', id))).filter(e => e.isDirectory() && /^[a-f0-9]{64}$/.test(e.name)).map(e => e.name));
  if (active?.claimedAt) dirs.add(hash(active.claimedAt));
  const generations = [];
  for (const dir of [...dirs].sort()) {
    const path = join(state, 'workers', id, dir);
    const archived = await read(join(path, 'telemetry-claim.json'));
    if (archived && (archived.version !== 1 || archived.issue !== id || hash(archived.claimedAt) !== dir)) throw Error('invalid telemetry archive');
    const current = active && hash(active.claimedAt) === dir ? active : null;
    const records = [];
    for (const file of await entries(path)) {
      if (!file.isFile() || !/^[a-f0-9-]{36}\.json$/.test(file.name)) continue;
      const r = await read(join(path, file.name));
      if (!r || r.issue !== id || hash(r.claimedAt) !== dir || `${r.attempt}.json` !== file.name) throw Error('invalid attempt identity');
      records.push(r);
    }
    const attempts = records.sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map(attemptTelemetry);
    reconcileCosts(records, attempts);
    const history = current?.telemetryHistory || archived?.history;
    const release = current ? null : archived?.release || null;
    const phases = (history?.transitions || []).map((p, i, transitions) => {
      const end = transitions[i + 1]?.at || release?.at || (current ? now : null);
      return { ...p, sequence: i, until: end, elapsedMs: duration(p.at, end),
        attempts: attempts.filter(a => ms(a.startedAt) !== null && ms(end) !== null && ms(a.startedAt) <= ms(end) &&
          (!a.endedAt || ms(a.endedAt) >= ms(p.at))).map(a => a.attempt) };
    });
    for (const attempt of attempts) {
      const containing = phases.filter(p => duration(attempt.startedAt, attempt.endedAt) !== null &&
        ms(p.at) !== null && ms(p.until) !== null && ms(attempt.startedAt) >= ms(p.at) && ms(attempt.endedAt) <= ms(p.until));
      if (containing.length === 1) attempt.phaseAllocation = { kind: 'measured', phase: containing[0].phase,
        at: containing[0].at, sequence: containing[0].sequence, source: 'attempt interval entirely inside one observed phase interval' };
    }
    for (const phase of phases) {
      const allocated = attempts.filter(a => a.phaseAllocation.kind === 'measured' && a.phaseAllocation.sequence === phase.sequence);
      phase.allocatedAttempts = allocated.map(a => a.attempt);
      phase.knownUsageSubtotal = Object.fromEntries(fields.map(key => [key, subtotal(allocated, key)]));
      phase.unallocatedAttempts = phase.attempts.filter(id => !phase.allocatedAttempts.includes(id));
      if (phase.unallocatedAttempts.length) for (const metric of Object.values(phase.knownUsageSubtotal)) metric.complete = false;
    }
    generations.push({ claimedAt: current?.claimedAt || archived?.claimedAt || records[0]?.claimedAt || null,
      active: Boolean(current), historyComplete: history?.complete === true, phases, release, attempts });
  }
  generations.sort((a, b) => (a.claimedAt || '').localeCompare(b.claimedAt || ''));
  const attempts = generations.flatMap(g => g.attempts);
  return { version: 1, issue: id, generatedAt: now, generations,
    counts: { attempts: attempts.length, resumes: attempts.filter(a => a.mode === 'resume' || a.mode === 'routed-resume').length,
      recoveries: attempts.filter(a => a.mode === 'recovery').length,
      unknownModes: attempts.filter(a => a.mode.includes('legacy')).length },
    knownUsageSubtotal: Object.fromEntries(fields.map(key => [key, subtotal(attempts, key)])),
    scope: 'Recorded worker attempts only. Not the complete cost of a ticket or evidence of savings.',
    gaps: ['Orchestrator evaluations are not accounted for. Claude main-loop tokens exclude subagents; its reported USD estimate includes them.',
      'Pre-telemetry usage and deleted claim histories cannot be reconstructed.',
      'Elapsed phase/attempt time is wall time, not billable or CPU time.',
      'Claude USD fields are client estimates, not billing measurements. No local pricing calculation is added.',
      'Claude input excludes cache reads/creation; Codex input includes cached input. Do not compare input alone across runtimes.'] };
}
