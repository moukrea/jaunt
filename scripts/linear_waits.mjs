// Post-merge obligations. This ledger never grants publication authority or
// expires an owner. Only the canonical CLI supplies the network dependencies.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson, withWorkerLock } from './linear_workers.mjs';

export const WAIT_PHASE = 'awaiting-external';
const key = id => { if (!/^[A-Z][A-Z0-9]*-\d+$/.test(id || '')) throw Error('invalid wait issue'); return id; };
const text = value => typeof value === 'string' && Boolean(value.trim());
const iso = value => typeof value === 'string' && /Z$/.test(value) && Number.isFinite(Date.parse(value));
const same = (a, b) => ['issue', 'claimedAt', 'runtime', 'session'].every(k => a?.[k] === b?.[k]);
const path = (state, id) => join(state, 'waits', `${key(id)}.json`);
const human = (c, agent) => c.user?.id && c.user.id !== agent && c.user.email && !/@oauthapp\.linear\.app$/i.test(c.user.email) && !c.botActor;

export async function readWait(state, claim) {
  const w = await readJson(path(state, claim.issue));
  if (!w || w.claimedAt !== claim.claimedAt) return null;
  if (w.version !== 1 || !same(w, claim) || !text(w.id) || !iso(w.since) || !iso(w.deadline) ||
      !['open', 'resolved'].includes(w.state) || !Array.isArray(w.attempts) || !Array.isArray(w.events) ||
      !w.proof?.head || !w.proof?.merge || !w.posts) throw Error('invalid wait evidence; preserve owner and ledger');
  return w;
}

export async function guardWaitTransition(state, record, previous) {
  const w = await readWait(state, record);
  const refresh = w && previous?.phase !== WAIT_PHASE && same(previous, record) && previous.phase === record.phase;
  if ((previous?.phase === WAIT_PHASE || w) && record.phase !== WAIT_PHASE && !refresh) throw Error('post-merge claim cannot return to implementation; reconcile its wait');
  if (record.phase === WAIT_PHASE && !w) throw Error('use wait begin with verified merged evidence');
}

export async function assertWaitResolved(state, claim) {
  const w = await readWait(state, claim);
  if ((claim.phase === WAIT_PHASE && !w) || (w && (w.state !== 'resolved' || !w.discussionResolved))) {
    throw Error('external wait unresolved; preserve claim, transcript and publication obligation');
  }
  if (w?.events.some(e => !e.acknowledged && ['wait-queued-ready', 'wait-reply'].includes(e.type))) {
    throw Error('wait routing events unacknowledged; preserve claim until recipient processing is verified');
  }
}

export function waitProgress(w, now = Date.now()) {
  return w && { state: w.state, reason: w.reason, owner: w.owner, since: w.since,
    lastProgressAt: w.lastProgressAt, deadline: w.deadline, overdue: w.state === 'open' && now >= Date.parse(w.deadline),
    nextAction: w.nextAction, resource: w.resource, attempts: w.attempts, error: w.error || null,
    pendingEvents: w.events.filter(e => !e.acknowledged), notification: w.notification || null };
}

// New words after a decision supersede it. Root replies and nested replies are
// both accepted only in this wait's thread; reactions never authorize an action.
export function waitReplies(w, comments, agent) {
  const request = w.posts.request;
  if (!request?.id) return [];
  const byId = new Map(comments.map(c => [c.id, c]));
  const inThread = c => {
    const seen = new Set();
    for (let p = c.parent?.id; p; p = byId.get(p)?.parent?.id) {
      if (p === request.id) return true;
      if (seen.has(p)) return false;
      seen.add(p);
    }
    return false;
  };
  return comments.filter(c => human(c, agent) && Date.parse(c.createdAt) > Date.parse(request.at) && inThread(c))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id));
}

export function waitDecision(w, comments, agent) {
  const latest = waitReplies(w, comments, agent).at(-1);
  const body = latest?.body.trim();
  return { verdict: !latest ? 'pending' : body === `/wait ${w.id} approve` ? 'approved' : body === `/wait ${w.id} decline` ? 'declined' : 'feedback',
    comment: latest?.id || null, action: w.nextAction, resource: w.resource };
}

export async function promoteWaitQueue(candidates, { claims, enabled, verdict, independent, ready }) {
  const results = [];
  for (const candidate of candidates) {
    let c = (await claims()).find(c => c.issue === candidate.issue);
    if (!same(c, candidate) || !['queued', 'implementing'].includes(c.phase) || !await enabled(c.issue)) continue;
    if ((await verdict(c.issue)).verdict !== 'approved' || !(await independent(c.issue)).independent) continue;
    if ((await verdict(c.issue)).verdict !== 'approved') continue;
    const fresh = (await claims()).find(x => x.issue === c.issue);
    if (JSON.stringify(fresh) !== JSON.stringify(c) || !await enabled(c.issue)) continue;
    const admitted = c.phase === 'implementing' || (await ready(c.issue)).promoted;
    if (admitted) results.push({ ticket: c.issue, claimedAt: c.claimedAt, runtime: c.runtime, session: c.session });
  }
  return results;
}

export function waitStore({ stateDir, readThread, agentId, publish, persistClaim, verifyMerge,
  verifyDelivery = async () => { throw Error('delivery verification unavailable'); }, syncDiscussion, queuedClaims = async () => [], promoteQueued = async () => [], now = () => Date.now() }) {
  const lock = action => withWorkerLock(stateDir, 'WAIT-0', action);
  const save = w => atomicJson(path(stateDir, w.issue), w);
  const stamp = () => new Date(now()).toISOString();
  const claim = async id => {
    const c = await readJson(join(stateDir, 'claims', `${key(id)}.json`));
    if (!c?.claimedAt || !text(c.session) || !['codex', 'claude'].includes(c.runtime)) throw Error('exact claimed runtime/session required');
    return c;
  };
  async function enabled(id) {
    if (!(await readJson(join(stateDir, 'linear-loop.json')))?.enabled) throw Error('loop is off');
    if (await readJson(join(stateDir, 'claims', `${id}.stop`))) throw Error('stop requested');
  }
  async function owned(id, who) {
    const c = await claim(id);
    if (who?.runtime !== c.runtime || who?.session !== c.session) throw Error('resume exact wait owner');
    await enabled(id);
    return c;
  }
  async function unchanged(c) {
    const latest = await claim(c.issue);
    if (!same(c, latest) || latest.phase !== c.phase) throw Error('claim changed during wait operation');
    await enabled(c.issue);
  }
  async function active(w) {
    if (!same(w, await claim(w.issue))) throw Error('wait owner changed');
    await enabled(w.issue);
  }
  function event(w, id, type, details = {}) {
    if (!w.events.some(e => e.id === id)) w.events.push({ id, type, ticket: w.issue, origin: w.issue, at: stamp(), ...details });
  }
  // Persist intent BEFORE sending. After an ambiguous create, search the entire
  // thread; if absent, refuse a blind second create. A label failure returns an
  // ID and is repaired separately, never by republishing.
  async function post(w, name, body, comments) {
    await active(w);
    if (w.posts[name]?.id) return;
    const marker = `<!-- jaunt-wait:${w.id}:${name} -->`;
    const found = comments.filter(c => c.user?.id === agentId && c.body.includes(marker));
    if (found.length > 1) throw Error('duplicate wait publication requires reconciliation');
    if (found.length) w.posts[name] = { id: found[0].id, at: found[0].createdAt };
    else {
      if (w.posts[name]?.attemptedAt) throw Error(`ambiguous ${name} publication; inspect Linear before retrying`);
      w.posts[name] = { attemptedAt: stamp() }; await save(w);
      const c = await publish(w.issue, `${marker}\n${body}`, name === 'request' ? undefined : w.posts.request?.id);
      if (!c?.id) throw Error('publication returned no comment ID');
      w.posts[name] = { id: c.id, at: c.createdAt || null, activity: c.activity };
    }
    await save(w);
  }
  const requestText = w => `**Attente après fusion** — ${w.reason}\nResponsable : ${w.owner}. Depuis : ${w.since}.\n` +
    `Prochaine action : ${w.nextAction}\nÉchéance : ${w.deadline}. Ressource conservée : ${w.resource}.\n` +
    `Tentatives : ${w.attempts.length ? w.attempts.map(a => `${a.action} → ${a.result}`).join('; ') : 'aucune'}.\n` +
    `Les fichiers fusionnés sont libérés ; la publication conserve son autorité exclusive.\n\n` +
    `**Attendu de toi :** répondre dans ce fil ; pour autoriser uniquement la prochaine action décrite, écrire \`/wait ${w.id} approve\`, ou \`/wait ${w.id} decline\` pour la refuser. Une réponse libre est transmise au worker. Le silence ne vaut pas accord.`;
  const attemptText = (w, a) => `**Tentative de coordination** — ${a.action}\nRésultat observé : ${a.result}\nResponsable : ${w.owner}. Prochaine action : ${w.nextAction}. Échéance : ${w.deadline}.\n\n**Rien attendu de toi de plus que la réponse demandée en tête de ce fil.**`;

  async function reconcileOne(c) {
    let w = await readWait(stateDir, c);
    if (!w) throw Error('no current wait');
    await enabled(c.issue);
    try {
      let thread = await readThread(c.issue);
      await unchanged(c);
      if (!w.posts.request?.id) {
        const matches = thread.comments.filter(comment => comment.user?.id === agentId && comment.body.includes(`<!-- jaunt-wait:${w.id}:request -->`));
        if (matches.length > 1) throw Error('duplicate wait publication requires reconciliation');
        if (matches.length === 1) w.posts.request = { id: matches[0].id, at: matches[0].createdAt };
      }
      const request = thread.comments.find(comment => comment.id === w.posts.request?.id);
      if (request) w.posts.request.at = request.createdAt;
      const replies = waitReplies(w, thread.comments, agentId);
      let newReply = false;
      for (const reply of replies) {
        if (!w.events.some(e => e.id === `reply:${reply.id}`)) newReply = true;
        event(w, `reply:${reply.id}`, 'wait-reply', { comment: reply.id, runtime: c.runtime, session: c.session });
      }
      if (w.state === 'resolved') {
        const consumed = w.events.find(e => e.id === `reply:${w.resolution.comment}`);
        if (consumed) consumed.acknowledged ||= { at: stamp(), evidence: w.resolution.evidence };
      }
      // Bounded publication retries must never disable reading Linear. A new
      // human message wakes the owner even after an exhausted retry budget.
      if (newReply) { w.failures = 0; delete w.retryAt; }
      await save(w);
      if ((w.failures || 0) >= 3 || (w.retryAt && now() < Date.parse(w.retryAt))) return w;
      await post(w, 'request', requestText(w), thread.comments);
      if (!w.posts.request.at) {
        thread = await readThread(c.issue); await unchanged(c);
        const request = thread.comments.find(comment => comment.id === w.posts.request.id);
        if (!request?.createdAt) throw Error('published request not yet readable; preserve its ID');
        w.posts.request.at = request.createdAt; await save(w);
      }
      await active(w);
      await syncDiscussion(w);
      if (c.phase !== WAIT_PHASE) {
        // A crash after saving admission but before its phase change is retryable,
        // never an excuse to release unverified files.
        await verifyMerge(c, { runtime: c.runtime, session: c.session }, w.proof.pr, w.proof.cwd);
        await unchanged(c);
        await persistClaim({ ...c, phase: WAIT_PHASE, updatedAt: stamp() });
        c = await claim(c.issue);
      }
      if (!w.swept) {
        await active(w);
        // Journal candidates before promotion: after a crash, a promoted claim
        // still produces its routing event instead of disappearing from queued.
        if (!w.candidates) { w.candidates = await queuedClaims(); await save(w); }
        const ready = await promoteQueued(w.candidates);
        for (const r of ready) event(w, `ready:${r.ticket}:${r.claimedAt}`, 'wait-queued-ready', r);
        w.swept = true; await save(w);
      }
      for (const [index, attempt] of w.attempts.entries()) {
        await post(w, `attempt-${index + 1}`, attemptText(w, attempt), thread.comments);
      }
      if (w.state === 'open' && now() >= Date.parse(w.deadline)) {
        const name = `deadline-${w.generation}`;
        await post(w, name, `**Échéance dépassée** — ${w.reason}\nResponsable : ${w.owner}. Échéance : ${w.deadline}.\n` +
          `Prochaine action : ${w.nextAction}\nTentatives : ${w.attempts.length ? w.attempts.map(a => `${a.action} → ${a.result}`).join('; ') : 'aucune'}.\n` +
          `La demande précise à traiter reste celle en tête de ce fil ; aucune reprise sur silence.\n\n**Rien attendu de toi de plus que la réponse demandée en tête de ce fil.**`, thread.comments);
        // One wake per deadline: if the watchdog already raised this generation,
        // the event is born notified and the watcher does not wake again (JAU-98).
        const raised = w.watchdog?.generation === w.generation && w.watchdog.at;
        event(w, name, 'wait-overdue', raised ? { notified: { attempts: 1, at: raised, by: 'watchdog' } } : {});
      }
      if (w.state === 'resolved') {
        const d = w.resolution.delivery;
        await post(w, 'resolution', d
          ? `**Attente résolue sur preuve de livraison** — ${w.resolution.evidence}\n` +
            `Vérifié par le CLI : reçu \`${d.status}\` pour ${d.source} (run ${d.run}), Page publique sur ${d.releaseSource}. Aucune décision humaine n'est nécessaire pour constater un résultat déjà obtenu.\n\n**Rien attendu de toi.** Pour information.`
          : `**Attente résolue** — ${w.resolution.evidence}\n` +
            `${w.resolution.ticket ? `Obligation transférée explicitement à ${w.resolution.ticket}.` : 'Résultat enregistré par la session propriétaire.'}\n\n**Rien attendu de toi.** Pour information.`, thread.comments);
        await active(w); await syncDiscussion(w);
        w.discussionResolved = true;
      }
      await unchanged(c);
      w.failures = 0; delete w.error; delete w.retryAt;
      await save(w);
    } catch (error) {
      w.failures = Math.min(3, (w.failures || 0) + 1);
      w.error = error.message; w.retryAt = new Date(now() + 300000).toISOString();
      await save(w);
    }
    return w;
  }

  return {
    async begin(id, who, input) {
      return lock(async () => {
        const c = await owned(id, who);
        if (!['implementing', 'landing', WAIT_PHASE].includes(c.phase)) throw Error('post-merge admission requires completed implementation');
        let w = await readWait(stateDir, c);
        if (!w) {
          for (const f of ['reason', 'owner', 'nextAction', 'resource']) if (!text(input[f])) throw Error(`${f} required`);
          const deadline = input.deadline || new Date(now() + 900000).toISOString();
          if (!iso(deadline) || Date.parse(deadline) <= now()) throw Error('future UTC deadline required');
          const proof = await verifyMerge(c, who, input.pr, input.cwd);
          await unchanged(c);
          w = { version: 1, ...Object.fromEntries(['issue', 'claimedAt', 'runtime', 'session'].map(k => [k, c[k]])),
            id: randomUUID(), state: 'open', generation: 1, since: stamp(), lastProgressAt: stamp(), deadline, proof,
            reason: input.reason, owner: input.owner, nextAction: input.nextAction, resource: input.resource,
            attempts: [], events: [], posts: {} };
          await save(w);
        }
        return reconcileOne(c);
      });
    },
    async read(id) { const c = await claim(id); return readWait(stateDir, c); },
    async reconcile(id) {
      return lock(async () => {
        const ids = id ? [key(id)] : (await readdir(join(stateDir, 'claims')).catch(e => { if (e.code === 'ENOENT') return []; throw e; }))
          .filter(n => n.endsWith('.json')).map(n => n.slice(0, -5));
        const results = [], events = [], errors = [];
        for (const id of ids) {
          try {
            const c = await claim(id), before = await readWait(stateDir, c);
            if (!before) {
              if (c.phase === WAIT_PHASE) throw Error('external phase has no current wait evidence');
              continue;
            }
            const w = await reconcileOne(c);
            results.push({ issue: id, ...waitProgress(w, now()) });
            if (w.error) errors.push({ issue: id, error: w.error });
            // Tracked per event, so a new reply never drags an old deadline back
            // in. An overdue deadline wakes once (its Linear comment stays);
            // replies and promotions carry a message and keep bounded retries.
            const due = w.events.filter(e => !e.acknowledged && (e.type === 'wait-overdue' ? !e.notified
              : (e.notified?.attempts || 0) < 3 && (!e.notified?.at || now() - Date.parse(e.notified.at) >= 300000)));
            if (due.length) {
              for (const e of due) e.notified = { attempts: (e.notified?.attempts || 0) + 1, at: stamp() };
              events.push(...due); await save(w);
            }
          } catch (e) { errors.push({ issue: id, error: e.message }); }
        }
        return { waits: results, events, errors };
      });
    },
    async attempt(id, who, input) {
      return lock(async () => {
        const c = await owned(id, who), w = await readWait(stateDir, c);
        if (!w || w.state !== 'open' || !text(input.action) || !text(input.result)) throw Error('open wait, action and actual result required');
        if (input.deadline && (!iso(input.deadline) || Date.parse(input.deadline) <= now() || !text(input.evidence))) throw Error('rescheduling requires future UTC deadline and progress evidence');
        w.attempts.push({ at: stamp(), action: input.action, result: input.result, evidence: input.evidence || null });
        if (input.evidence) w.lastProgressAt = stamp();
        if (input.deadline) { w.deadline = input.deadline; w.generation++; }
        // Explicit operator reconciliation allows bounded retries again, but
        // retains ambiguous publication intents and every previous attempt.
        w.failures = 0; delete w.retryAt;
        await unchanged(c); await save(w);
        const thread = await readThread(id);
        await post(w, `attempt-${w.attempts.length}`, attemptText(w, w.attempts.at(-1)), thread.comments);
        return w;
      });
    },
    async decision(id, who) {
      return lock(async () => {
        const c = await owned(id, who), w = await readWait(stateDir, c);
        if (!w || w.state !== 'open') throw Error('open wait required');
        const result = waitDecision(w, (await readThread(id)).comments, agentId);
        await unchanged(c);
        w.decision = { ...result, checkedAt: stamp() }; await save(w);
        return w.decision;
      });
    },
    async revise(id, who, input) {
      return lock(async () => {
        const c = await owned(id, who), w = await readWait(stateDir, c);
        if (!w || w.state !== 'open' || !text(input.action) || !text(input.reason)) throw Error('open wait, revised action and reason required');
        const latest = waitReplies(w, (await readThread(id)).comments, agentId).at(-1);
        if (!latest || latest.id !== input.comment) throw Error('latest Linear feedback required to revise the request');
        const deadline = input.deadline || new Date(now() + 900000).toISOString();
        if (!iso(deadline) || Date.parse(deadline) <= now()) throw Error('future UTC deadline required');
        await unchanged(c);
        (w.history ||= []).push({ id: w.id, generation: w.generation, reason: w.reason, action: w.nextAction,
          request: w.posts.request, supersededBy: latest.id });
        w.id = randomUUID(); w.generation++; w.reason = input.reason; w.nextAction = input.action;
        w.deadline = deadline; w.lastProgressAt = stamp(); w.failures = 0;
        delete w.posts.request; delete w.retryAt; delete w.decision;
        await save(w);
        return reconcileOne(c);
      });
    },
    // Acknowledges processing, not approval. The event remains durable until the
    // orchestrator observes the recipient processing it (queue acceptance is not enough).
    async acknowledge(id, eventId, evidence) {
      return lock(async () => {
        const c = await claim(id); await enabled(id);
        const w = await readWait(stateDir, c), e = w?.events.find(e => e.id === eventId);
        if (!e || !text(evidence)) throw Error('event and processing evidence required');
        e.acknowledged ||= { at: stamp(), evidence }; await save(w); return e;
      });
    },
    async resolve(id, who, input) {
      return lock(async () => {
        const c = await owned(id, who), w = await readWait(stateDir, c);
        if (!w || !text(input.evidence)) throw Error('wait and outcome evidence required');
        if (w.state === 'resolved') return reconcileOne(c);
        const thread = await readThread(id), replies = waitReplies(w, thread.comments, agentId), latest = replies.at(-1);
        // Observing a verified outcome needs no consent; consent gates actions
        // still to be done (JAU-98). Publication only, checked by the CLI, and
        // never over a human who answered anything but approval.
        if (input.delivered) {
          if (input.comment || input.ticket) throw Error('--delivered takes neither a decision comment nor a transfer');
          if (w.resource !== 'jaunt-production-release') throw Error('proof-only resolution covers publication waits only; this wait needs the human decision');
          if (latest && latest.body.trim() !== `/wait ${w.id} approve`) throw Error('a human answered this wait; follow their latest message instead of resolving on proof');
          const delivery = await verifyDelivery(w.proof.merge);
          if (delivery?.source !== w.proof.merge || delivery.status !== 'delivered') throw Error('delivery of the merged source not verified');
          const fresh = waitReplies(w, (await readThread(id)).comments, agentId).at(-1);
          if (JSON.stringify(fresh) !== JSON.stringify(latest)) throw Error('Linear thread changed during resolution');
          await unchanged(c);
          w.state = 'resolved'; w.lastProgressAt = stamp();
          w.resolution = { at: stamp(), kind: 'delivered', comment: latest?.id || null, evidence: input.evidence, delivery };
          w.failures = 0; delete w.retryAt;
          await save(w);
          return reconcileOne(c);
        }
        if (!latest || latest.id !== input.comment || latest.body.trim() !== `/wait ${w.id} approve`) throw Error('latest explicit Linear decision for this action required; silence/reactions/old approval are not consent');
        if (input.ticket) {
          key(input.ticket);
          if (input.ticket === id) throw Error('cannot transfer to self');
          const target = await readThread(input.ticket);
          const links = [...(target.relations?.nodes || []).map(r => ({ type: r.type, id: r.relatedIssue?.identifier })),
            ...(target.inverseRelations?.nodes || []).map(r => ({ type: r.type, id: r.issue?.identifier }))];
          if (!links.some(r => r.type === 'related' && r.id === id)) throw Error('transfer requires verified related target');
          // Approval is scoped to the immutable nextAction, including any named transfer target.
          if (!(w.nextAction.match(/\b[A-Z][A-Z0-9]*-\d+\b/g) || []).includes(input.ticket)) throw Error('transfer target was not part of the approved action');
        }
        const freshReplies = waitReplies(w, (await readThread(id)).comments, agentId);
        if (JSON.stringify(freshReplies.at(-1)) !== JSON.stringify(latest)) throw Error('Linear decision changed during resolution');
        await unchanged(c);
        w.state = 'resolved'; w.lastProgressAt = stamp();
        w.resolution = { at: stamp(), comment: latest.id, evidence: input.evidence, ...(input.ticket ? { ticket: input.ticket } : {}) };
        w.failures = 0; delete w.retryAt;
        await save(w);
        return reconcileOne(c);
      });
    },
  };
}

// Local-only watchdog signal. Kept separate from process health and from API
// retries; expiry never changes a claim or transfers any authority.
export async function waitWake(state, now = Date.now()) {
  if (!(await readJson(join(state, 'linear-loop.json')))?.enabled) return null;
  return withWorkerLock(state, 'WAIT-0', async () => {
    const names = await readdir(join(state, 'claims')).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    for (const name of names.filter(n => n.endsWith('.json'))) {
      const c = await readJson(join(state, 'claims', name));
      if (!c?.claimedAt || await readJson(join(state, 'claims', `${c.issue}.stop`))) continue;
      const w = await readWait(state, c);
      if (!w || w.state !== 'open' || now < Date.parse(w.deadline)) continue;
      // One wake per deadline generation, shared with the watcher's reconcile:
      // whichever raises it first, the other stays silent (JAU-98).
      if (w.posts[`deadline-${w.generation}`]?.id || w.events.some(e => e.id === `deadline-${w.generation}`)) continue;
      if (w.watchdog?.generation === w.generation) continue;
      w.watchdog = { generation: w.generation, attempts: 1, at: new Date(now).toISOString() };
      await atomicJson(path(state, c.issue), w);
      return { wake: 'wait-overdue', wait: w.id, generation: w.generation,
        events: [{ type: 'wait-overdue', ticket: c.issue }], progress: waitProgress(w, now) };
    }
    return null;
  });
}
