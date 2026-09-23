// Deterministic routing only. No approval writes, model calls or polling on import.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, readJson, hash, runtimeOf, withWorkerLock } from './linear_workers.mjs';

const idOK = id => /^[A-Z][A-Z0-9]*-\d+$/.test(id || '');
export const bindingOf = c => ({ issue: c.issue, claimedAt: c.claimedAt, runtime: runtimeOf(c), session: c.session });
export const sameBinding = (a, b) => Boolean(a && b && ['issue', 'claimedAt', 'runtime', 'session'].every(k => a[k] === b[k]));
export const routeReceiptPath = (state, key) => {
  if (!/^[a-f0-9]{64}$/.test(key || '')) throw Error('invalid route key');
  return join(state, 'routing', 'receipts', `${key}.json`);
};
const actionable = new Set(['approved', 'declined', 'feedback']);
const commentEvent = e => ['comment', 'comment-updated'].includes(e.type);

// Hash content rather than retaining it in the route ledger. Unknown attribution
// is not proof of a human, and an app/bot's update is not a new human answer.
export function humanInput(thread, claim) {
  if (!thread?.agentId || thread.identifier !== claim.issue || !Array.isArray(thread.comments)) throw Error('incomplete routing thread');
  if (!thread.state?.type || ['completed', 'canceled'].includes(thread.state.type)) throw Error('ticket needs state/closure reconciliation');
  const since = Date.parse(claim.claimedAt);
  if (!Number.isFinite(since)) throw Error('invalid claim cycle');
  const human = user => {
    if (user?.id === thread.agentId) return false;
    if (!user?.id || !user.email) throw Error('ambiguous author identity');
    return !/@oauthapp\.linear\.app$/i.test(user.email);
  };
  const entries = [];
  for (const c of thread.comments) {
    if (!c.id || !Number.isFinite(Date.parse(c.createdAt))) throw Error('incomplete comment');
    if (Date.parse(c.createdAt) >= since && !c.botActor && human(c.user)) {
      if (typeof c.body !== 'string') throw Error('incomplete comment body');
      entries.push(['comment', c.id, c.user.id, c.createdAt, hash(c.body)]);
    }
    for (const r of c.reactions || []) {
      if (!Number.isFinite(Date.parse(r.createdAt))) throw Error('incomplete reaction');
      if (Date.parse(r.createdAt) >= since && human(r.user)) {
        entries.push(['reaction', c.id, r.user.id, r.createdAt, r.emoji]);
      }
    }
  }
  return entries.length ? hash(JSON.stringify(entries.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))) : null;
}

// Called again inside the launch lock. A router classification is not launch
// authority; all mutable inputs must still match immediately before acceptance.
export async function routePreflight({ state, route, claim, record, owner, alive, agent, health, prState }) {
  if (!sameBinding(route.binding, bindingOf(claim))) throw Error('route claim/session/runtime changed');
  if (!alive(owner) || JSON.stringify(record?.owner) !== JSON.stringify(owner)) throw Error('route owner changed or gone');
  if (!(await readJson(join(state, 'linear-loop.json')))?.enabled) throw Error('loop is off');
  if (await readJson(join(state, 'claims', `${claim.issue}.stop`))) throw Error('stop requested');
  if (claim.phase === 'awaiting-external') throw Error('external wait belongs to reconciliation');
  if (record?.attempt !== route.sourceAttempt) throw Error('route worker attempt changed');
  const status = health(claim, record).state;
  if (route.kind === 'reply') {
    if (!['resting', 'finished'].includes(status) || record.failure || record.cancelled || record.code !== 0) throw Error('reply needs a successfully resting worker; use guarded recovery for interruption');
    const thread = await agent('routing-thread', claim.issue);
    if (humanInput(thread, claim) !== route.input) throw Error('human input changed during routing');
    const answer = await agent('verdict', claim.issue, '--peek');
    if (!actionable.has(answer.verdict)) throw Error('verdict no longer actionable');
    if (await prState() === 'MERGED') throw Error('PR merged; reconcile closure');
  } else if (route.kind !== 'recovery' || status !== 'interrupted') throw Error('invalid recovery route');
  const fresh = (await agent('claims')).find(c => c.issue === claim.issue);
  if (JSON.stringify(fresh) !== JSON.stringify(claim)) throw Error('claim changed during routing');
  if (!alive(owner) || !(await readJson(join(state, 'linear-loop.json')))?.enabled || await readJson(join(state, 'claims', `${claim.issue}.stop`))) throw Error('loop/stop/owner changed during routing');
  return true;
}

export function routingStore({ state, agent, launch, enabled = async () => (await readJson(join(state, 'linear-loop.json')))?.enabled === true }) {
  const dir = join(state, 'routing', 'pending');
  const path = id => { if (!idOK(id)) throw Error('invalid routing ticket'); return join(dir, `${id}.json`); };
  async function ids() {
    try { return (await readdir(dir)).filter(f => /^[A-Z][A-Z0-9]*-\d+\.json$/.test(f)).map(f => f.slice(0, -5)); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  }
  async function routeEvent(id, incoming, blocked = false) {
    return withWorkerLock(join(state, 'routing'), id, async () => {
      let saved = await readJson(path(id));
      if (!incoming && !saved?.pending) return null;
      const finish = async (outcome, reason, pending = null) => {
        saved = { ...saved, issue: id, pending, outcome, reason, at: new Date().toISOString() };
        await atomicJson(path(id), saved);
        return { ticket: id, outcome, reason };
      };
      try {
        if (blocked) return finish('escalate', 'ticket has structural events; reconcile before routing');
        if (!await enabled()) return finish('deferred', 'loop or owner unavailable', saved?.pending || incoming);
        const claim = (await agent('claims')).find(c => c.issue === id);
        if (!claim?.session || !claim.claimedAt || !['codex', 'claude'].includes(runtimeOf(claim))) return finish('escalate', 'no exact worker identity');
        const binding = bindingOf(claim);
        // Only an outstanding route is bound to the old identity. With nothing
        // pending, a new session (JAU-37: fresh implementation) is the address.
        if (saved?.pending && saved.binding && !sameBinding(saved.binding, binding)) return finish('escalate', 'claim identity changed; old route retained for reconciliation');
        saved = { ...saved, binding };
        if (claim.phase === 'awaiting-external') return finish('escalate', 'external wait belongs to reconciliation');
        if ((await agent('stop-requested', id)).stop) return finish('deferred', 'stop requested', saved?.pending || incoming);
        const report = (await agent('workers')).find(w => w.issue === id);
        if (!report?.attempt || ['suspect', 'unknown', 'suspended'].includes(report.state)) return finish('escalate', 'uncertain worker evidence');
        const kind = incoming?.kind || saved.pending.kind;
        let input;
        if (kind === 'reply') {
          input = humanInput(await agent('routing-thread', id), claim);
          if (!input) return finish('escalate', 'no attributable human input; ordinary board reconciliation');
          const verdict = await agent('verdict', id, '--peek');
          if (!actionable.has(verdict.verdict)) return finish('escalate', 'no actionable verdict; no automatic resume');
        } else if (kind === 'recovery') {
          input = incoming?.sourceAttempt || saved.pending.sourceAttempt;
        } else return finish('escalate', 'unknown route kind');
        const key = hash(JSON.stringify({ binding, kind, input }));
        const route = { binding, kind, input, key, sourceAttempt: report.attempt };
        // Durable before pulse advances or a subprocess can launch. This key
        // stays stable while a busy worker finishes its current attempt.
        saved.pending = route;
        await atomicJson(path(id), saved);
        const receipt = await readJson(routeReceiptPath(state, key));
        if (receipt?.state === 'accepted') return finish('handled', 'route already accepted');
        if (kind === 'recovery' && input !== report.attempt && !receipt) return finish('escalate', 'recovery attempt changed');
        if (receipt) {
          const result = await launch(route);
          if (result?.outcome !== 'handled') throw Error('uncertain route acceptance');
          return finish('handled', result.reason);
        }
        if (report.state === 'running') return finish('deferred', 'worker active', route);
        if (kind === 'reply' && report.state === 'interrupted') return finish('escalate', 'interrupted worker requires recovery, never ordinary resume');
        if (kind === 'recovery' && (report.state !== 'interrupted' || report.schedule?.blocked)) return finish('escalate', report.schedule?.blocked || 'recovery no longer applicable');
        if (kind === 'recovery' && !report.schedule?.due) return finish('deferred', 'recovery cooldown', route);
        const result = await launch(route);
        if (result?.outcome === 'deferred') return finish('deferred', result.reason, route);
        if (result?.outcome !== 'handled') throw Error(result?.reason || 'launch not acknowledged');
        return finish('handled', result.reason || 'direct worker launch');
      } catch (error) {
        // Failed/uncertain actions stay visible. No automatic retry of an
        // ambiguous launch; the worker receipt and lifecycle retain its evidence.
        return finish('escalate', error.message);
      }
    });
  }
  async function drainPendingRoutes(event = { wake: 'board-changed', events: [] }) {
    const original = event.events || [];
    const outcomes = [], leftovers = [];
    if (!['board-changed', 'worker-recovery-due'].includes(event.wake)) return { event, outcomes };
    const incoming = new Map();
    if (event.wake === 'worker-recovery-due') {
      if (!Array.isArray(event.workers) || event.workers.some(w => !idOK(w.issue) || !w.attempt)) return { event, outcomes };
      for (const w of event.workers || []) if (idOK(w.issue)) incoming.set(w.issue, { kind: 'recovery', sourceAttempt: w.attempt });
      if (!incoming.size) return { event, outcomes };
    } else {
      for (const e of original) if (idOK(e.ticket) && commentEvent(e)) incoming.set(e.ticket, { kind: 'reply' });
    }
    const structural = new Set(original.filter(e => !commentEvent(e)).map(e => e.ticket));
    for (const id of new Set([...incoming.keys(), ...await ids()])) {
      let result;
      try { result = await routeEvent(id, incoming.get(id), structural.has(id)); }
      catch (e) { result = { ticket: id, outcome: 'escalate', reason: e.message }; }
      if (result) outcomes.push(result);
    }
    const byTicket = new Map(outcomes.map(o => [o.ticket, o]));
    for (const e of original) {
      const result = byTicket.get(e.ticket);
      if (!commentEvent(e) || !result || result.outcome === 'escalate') leftovers.push(e);
    }
    for (const o of outcomes.filter(o => o.outcome === 'escalate')) {
      if (!leftovers.some(e => e.ticket === o.ticket)) leftovers.push({ type: 'routing-escalated', ticket: o.ticket, reason: o.reason });
    }
    return { event: leftovers.length ? { ...event,
      ...(event.workers ? { workers: event.workers.filter(w => byTicket.get(w.issue)?.outcome === 'escalate') } : {}),
      events: leftovers, routing: outcomes } : null, outcomes };
  }
  return { routeEvent, drainPendingRoutes };
}

// Must run under the launcher's worker lock. Write the intent before creating an
// attempt; a crash in the tiny acceptance gap is an escalation, not a retry.
export async function acceptRoute({ state, route, current, check, begin, start }) {
  const path = routeReceiptPath(state, route.key);
  const previous = await readJson(path);
  if (previous?.state === 'accepted') return { outcome: 'handled', reason: 'route already accepted' };
  if (previous) {
    if (current?.routeKey === route.key && current.wrapper && current.heartbeatAt) {
      await atomicJson(path, { ...previous, state: 'accepted', attempt: current.attempt });
      return { outcome: 'handled', reason: 'accepted attempt recovered from lifecycle' };
    }
    throw Error('uncertain route acceptance; preserve receipt and reconcile worker');
  }
  await check();
  await atomicJson(path, { state: 'launching', binding: route.binding, key: route.key, at: new Date().toISOString() });
  const record = await begin();
  await atomicJson(path, { state: 'launching', binding: route.binding, key: route.key, attempt: record.attempt });
  await start(record);
  await atomicJson(path, { state: 'accepted', binding: route.binding, key: route.key, attempt: record.attempt });
  return { outcome: 'handled', reason: 'direct worker launch' };
}
