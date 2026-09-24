// Pre-merge human trials. A receipt never grants a landing turn or publishes a build.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, readJson, withWorkerLock, hash } from './linear_workers.mjs';

export const VALIDATION_PHASE = 'awaiting-validation';
const fields = ['issue', 'claimedAt', 'runtime', 'session'];
const same = (a, b) => fields.every(k => a?.[k] === b?.[k]);
const text = s => typeof s === 'string' && Boolean(s.trim());
const sha = s => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s);
const iso = s => typeof s === 'string' && Number.isFinite(Date.parse(s));
const digest = value => hash(JSON.stringify(value));
const file = (dir, id) => {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(id || '')) throw Error('invalid validation ticket');
  return join(dir, 'validations', `${id}.json`);
};
const human = (c, agent) => c?.user?.id && c.user.id !== agent && text(c.user.email) && !/@oauthapp\.linear\.app$/i.test(c.user.email) && !c.botActor;
const stamp = c => Math.max(Date.parse(c.createdAt), Date.parse(c.updatedAt));
const commentProof = c => ({ id: c.id, body: hash(c.body), author: c.user.id, createdAt: c.createdAt, updatedAt: c.updatedAt, parent: c.parent?.id || null });
const requests = v => [...(v?.history || []), ...(v?.request ? [v.request] : [])];
export function validationRequirement(required, reason) {
  if (!['required', 'not-required'].includes(required) || !text(reason)) throw Error('plan requires --validation required|not-required and --validation-reason');
  return { required, reason: reason.trim() };
}
export async function readValidation(stateDir, c) {
  const v = await readJson(file(stateDir, c.issue));
  if (!v || v.claimedAt !== c.claimedAt) return null;
  if (!same(v, c) || v.version !== 1 || !['reviewed', 'waiting', 'approved', 'correcting'].includes(v.state) ||
      !text(v.snapshot) || !v.plan || !sha(v.head) || !Number.isInteger(v.pr) || !Array.isArray(v.history)) throw Error('invalid validation evidence; preserve claim and receipts');
  return v;
}
export async function guardValidationTransition(stateDir, c, previous) {
  if (previous?.claimedAt === c.claimedAt && !same(c, previous)) {
    const saved = await readJson(file(stateDir, c.issue));
    if (saved && (!iso(saved.claimedAt) || saved.claimedAt === c.claimedAt)) throw Error('validation owner cannot change through claim');
  }
  const v = await readValidation(stateDir, c);
  const refresh = previous && same(c, previous) && c.phase === previous.phase;
  if (!refresh && c.phase === VALIDATION_PHASE && (!v?.request?.post?.id || v.state !== 'waiting')) throw Error('use validation begin with a published candidate request');
  if (v?.state === 'waiting' && c.phase !== VALIDATION_PHASE && !(previous && same(c, previous) && c.phase === previous.phase)) throw Error('validation pending; direct phase change cannot consume it');
  if (previous?.phase === VALIDATION_PHASE && c.phase !== VALIDATION_PHASE && !['approved', 'correcting'].includes(v?.state)) throw Error('read the current validation decision before resuming');
}
export async function assertValidationResolved(stateDir, c) {
  const v = await readValidation(stateDir, c);
  if (c.phase === VALIDATION_PHASE || v?.state === 'waiting' || requests(v).some(r => !r.discussionResolved)) throw Error('validation obligation unresolved; preserve the claim');
}
export function validationProgress(v) {
  return v && { state: v.state, pr: v.pr, head: v.head, requirement: v.plan.validation.required,
    request: v.request?.id || null, reviewer: v.request?.reviewer.name || null,
    action: v.state === 'waiting' ? 'Try the published candidate and reply in its request thread' : 'Resume the exact worker; landing admission remains required' };
}
export function checkThread(thread, id) {
  if (thread?.identifier !== id || typeof thread.description !== 'string' || typeof thread.title !== 'string' || !Array.isArray(thread.comments)) throw Error('incomplete validation thread');
  const ids = new Set();
  for (const c of thread.comments) {
    if (!text(c.id) || ids.has(c.id) || typeof c.body !== 'string' || !iso(c.createdAt) || !iso(c.updatedAt) ||
        !text(c.user?.id) || !text(c.user.email)) throw Error('incomplete/ambiguous validation comment');
    ids.add(c.id);
  }
  return thread;
}
function inThread(c, request, comments) {
  const byId = new Map(comments.map(c => [c.id, c])), seen = new Set();
  for (let id = c.parent?.id; id; id = byId.get(id)?.parent?.id) {
    if (id === request) return true;
    if (seen.has(id)) throw Error('cyclic comment ancestry');
    seen.add(id);
    if (!byId.has(id)) throw Error('incomplete comment ancestry');
  }
  return false;
}
function verifiedPosts(thread, v, agent, strict = true) {
  const ids = new Set();
  for (const r of requests(v)) {
    for (const post of [r.post, r.receipt].filter(p => p?.id)) {
      const c = thread.comments.find(c => c.id === post.id);
      if (!c || c.user.id !== agent || hash(c.body) !== post.hash || (post.parent !== undefined && (c.parent?.id || null) !== post.parent)) {
        if (strict && !r.superseded) throw Error('validation publication changed or disappeared');
        continue;
      }
      ids.add(c.id);
    }
  }
  return ids;
}
export function validationSnapshot(thread, v, agent) {
  checkThread(thread, thread.identifier);
  const posts = verifiedPosts(thread, v, agent, false);
  const changedPosts = requests(v).flatMap(r => [r.post, r.receipt]).filter(p => p?.id && !posts.has(p.id)).map(p => p.id).sort();
  const comments = thread.comments.filter(c => !posts.has(c.id) &&
    !(v?.request?.post?.id && human(c, agent) && inThread(c, v.request.post.id, thread.comments)));
  return digest({ title: thread.title, description: thread.description, changedPosts, comments: comments.map(commentProof).sort((a, b) => a.id.localeCompare(b.id)) });
}
export function validationDecision(v, thread, agent) {
  checkThread(thread, v.issue); verifiedPosts(thread, v, agent);
  const r = v.request;
  if (!r?.post?.id) return { verdict: 'pending', stage: 'validation', issue: v.issue };
  const replies = thread.comments.filter(c => human(c, agent) && inThread(c, r.post.id, thread.comments) &&
    Date.parse(c.createdAt) > Date.parse(r.post.createdAt)).sort((a, b) => stamp(a) - stamp(b) || a.id.localeCompare(b.id));
  const c = replies.at(-1), body = c?.body.trim().normalize('NFC').toLocaleLowerCase('fr');
  const verdict = !c ? 'pending' : c.user.id !== r.reviewer.id ? 'feedback' : body === 'testé et validé' ? 'approved' : body === 'refusé' ? 'declined' : 'feedback';
  return { verdict, stage: 'validation', issue: v.issue, request: r.id, comment: c ? commentProof(c) : null,
    messages: replies.map(c => ({ id: c.id, author: c.user.name || c.user.id, body: c.body, at: c.updatedAt })) };
}

// Both the authoritative package ledger and the public Page must name the same candidate.
export function channelCandidate(state, pr, index, document, { repository, page }) {
  const name = `${pr.author?.login?.toLowerCase()}_${pr.number}`;
  if (!/^(?!main_|beta_)[a-z][a-z0-9]{0,31}_[1-9][0-9]{0,5}$/.test(name)) throw Error('invalid per-PR channel');
  if (state?.schema !== 1 || !state.channels || Object.values(state.channels).filter(c => c.pr === pr.number && c.status === 'live').length !== 1) throw Error('ambiguous or absent live channel');
  const ch = state.channels[name];
  if (ch?.pr !== pr.number || ch.status !== 'live' || !Array.isArray(ch.candidates)) throw Error('channel is absent or removed');
  const ns = ch.candidates.map(c => c.n);
  if (ns.some(n => !Number.isInteger(n) || n < 1) || new Set(ns).size !== ns.length) throw Error('ambiguous candidate inventory');
  const c = ch.candidates.filter(c => c.status === 'delivered').sort((a, b) => b.n - a.n)[0];
  if (!c || !sha(c.sha) || !sha(c.source) || c.source !== pr.headRefOid || c.sha === c.source || !text(String(c.run || ''))) throw Error('current delivered candidate does not match PR source');
  if (index?.version !== 1 || index.repository !== repository || index.page !== page || !Array.isArray(index.channels)) throw Error('invalid public channel index');
  const rows = index.channels.filter(r => r.name === name);
  if (rows.length !== 1 || rows[0].pr !== pr.number || rows[0].n !== c.n || rows[0].releaseSource !== c.source ||
      document?.version !== 1 || document.channel !== name || document.repository !== repository || document.page !== page || document.releaseSource !== c.source) throw Error('public channel is stale or inconsistent');
  const components = { host: ['release', 'v'], desktop: ['desktopRelease', 'desktop-v'], android: ['androidRelease', 'android-v'] };
  for (const [component, [field, prefix]] of Object.entries(components)) {
    const tag = c.tags?.[component], receipt = c.receipts?.[component];
    const pattern = new RegExp(`^${prefix}\\d+\\.\\d+\\.\\d+-(alpha|beta|rc)\\.\\d+\\.ch\\.${name.replace('_', '\\.')}\\.${c.n}$`);
    if (!text(tag) || !pattern.test(tag) || rows[0][field] !== tag || document[field] !== tag ||
        receipt?.tag !== tag || receipt.sha !== c.sha || receipt.url !== `https://github.com/${repository}/releases/tag/${tag}` ||
        !receipt.hashes || !Object.keys(receipt.hashes).length || Object.entries(receipt.hashes).some(([n, h]) => !/^[^/\\]+$/.test(n) || !/^[a-f0-9]{64}$/.test(h))) throw Error(`invalid ${component} candidate receipt`);
  }
  return { channel: name, pr: pr.number, n: c.n, source: c.source, sha: c.sha, tags: c.tags, receipts: c.receipts, run: c.run,
    url: new URL(`ch/${name}/`, page).href };
}

export function validationStore({ stateDir, agentId, readThread, readPlan, planVerdict, readPr, readCandidate, readReviewer,
  publish, persistClaim, park, assertCanWait, releaseLanding, syncDiscussion, now = () => new Date().toISOString() }) {
  const lock = action => withWorkerLock(stateDir, 'VALIDATION-0', action);
  const save = v => atomicJson(file(stateDir, v.issue), v);
  const claim = async id => {
    const c = await readJson(join(stateDir, 'claims', `${id}.json`));
    if (!same(c, { ...c, issue: id }) || !text(c?.session) || !iso(c?.claimedAt) || !['codex', 'claude'].includes(c?.runtime)) throw Error('exact validation claim required');
    return c;
  };
  const active = async c => {
    if (!same(c, await claim(c.issue))) throw Error('validation owner changed');
    if (!(await readJson(join(stateDir, 'linear-loop.json')))?.enabled || await readJson(join(stateDir, 'claims', `${c.issue}.stop`))) throw Error('validation stopped or loop off');
  };
  const owned = async (id, who) => {
    const c = await claim(id);
    if (who?.runtime !== c.runtime || who?.session !== c.session) throw Error('resume exact validation runtime/session');
    await active(c); return c;
  };
  const thread = async c => checkThread(await readThread(c.issue), c.issue);
  async function approvedPlan(c, t, v) {
    const p = await readPlan(c);
    if (p?.claimedAt !== c.claimedAt || !p.comment || !p.documentHash || !p.validation) throw Error('plan has no validation classification; publish an explicit plan amendment');
    validationRequirement(p.validation.required, p.validation.reason);
    if (p.validation.required === 'not-required' && p.scopeHash !== digest({ title: t.title, description: t.description }))
      throw Object.assign(Error('exempt plan scope changed; publish an approved replacement classification'), { code: 'PLAN_FEEDBACK' });
    const plans = t.comments.filter(x => x.user.id === agentId && x.body.startsWith('<!-- jaunt-agent:plan -->') && Date.parse(x.createdAt) > Date.parse(c.claimedAt))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const current = plans.at(-1);
    if (current?.id !== p.comment || hash(current.body) !== p.commentHash || hash(p.content) !== p.documentHash) throw Error('published plan changed');
    // A replacement plan can itself answer feedback inside an archived trial.
    const filtered = t.comments.filter(x => x.id === current.id || inThread(x, current.id, t.comments) ||
      !requests(v).some(r => r.post?.id && (x.id === r.post.id || inThread(x, r.post.id, t.comments))));
    const safe = filtered.filter(x => x.user.id === agentId || human(x, agentId)).map(x => ({ ...x,
      createdAt: x.user.id === agentId ? x.createdAt : new Date(stamp(x)).toISOString(),
      reactions: (x.reactions || []).filter(r => human({ user: r.user }, agentId)) }));
    const answer = planVerdict(t, current, safe);
    if (answer.verdict !== 'approved') throw Object.assign(Error('current plan is not approved'), { code: ['feedback', 'declined'].includes(answer.verdict) ? 'PLAN_FEEDBACK' : 'PLAN_PENDING' });
    return { comment: p.comment, commentHash: p.commentHash, document: p.document, documentHash: p.documentHash, scopeHash: p.scopeHash, validation: p.validation };
  }
  async function matchingPr(c, number) {
    const p = await readPr(number);
    if (p.state !== 'OPEN' || p.isCrossRepository !== false || p.baseRefName !== 'main' || !sha(p.headRefOid) ||
        !p.headRefName?.split(/[^A-Za-z0-9-]+/).includes(c.issue) || p.number !== Number(number)) throw Error('validation PR does not match ticket/branch/base');
    return p;
  }
  async function evidence(c, v, p, t) {
    if (!v || v.pr !== p.number || v.head !== p.headRefOid) throw Error('head changed or validation not reviewed');
    if (v.requiresPlan) throw Error('new instructions require an approved replacement plan');
    if (digest(await approvedPlan(c, t, v)) !== digest(v.plan)) throw Error('validation plan superseded');
    if (validationSnapshot(t, v, agentId) !== v.snapshot) throw Error('new or edited instructions; review validation again');
  }
  async function post(c, v, slot, body, parent) {
    const r = v.request;
    if (r[slot]?.id && r[slot].updatedAt) return;
    const marker = `<!-- jaunt-validation:${r.id}:${slot} -->`;
    const wanted = `${marker}\n${body}`;
    let t = await thread(c);
    const found = t.comments.filter(x => x.user.id === agentId && x.body.startsWith(marker));
    if (found.length > 1) throw Error('duplicate validation publication');
    let posted = found[0];
    if (!posted) {
      if (r[slot]?.attemptedAt) throw Error('ambiguous validation publication; inspect Linear before retrying');
      r[slot] = { attemptedAt: now(), hash: hash(wanted) }; await save(v);
      await active(c);
      const result = await publish(c.issue, wanted, parent);
      if (!result?.id) throw Error('validation publication returned no ID');
      r[slot].id = result.id; await save(v);
      t = await thread(c); posted = t.comments.find(x => x.id === result.id);
    }
    if (!posted || posted.user.id !== agentId || (posted.parent?.id || null) !== (parent || null) || hash(posted.body) !== hash(wanted)) throw Error('validation publication not verified; preserve its ID');
    r[slot] = { id: posted.id, hash: hash(posted.body), parent: posted.parent?.id || null, createdAt: posted.createdAt, updatedAt: posted.updatedAt };
    await save(v);
  }
  const beginText = v => {
    const r = v.request, p = r.candidate;
    return `**Essai avant fusion — PR ${v.pr}, candidat ${p.n}**\nCanal : ${p.channel} — ${p.url}\nSource : ${p.source}\nBuild : ${p.sha}\n` +
      Object.values(p.receipts).map(x => x.url).join('\n') + `\n\nProcédure : ${r.procedure}\nRésultat attendu : ${r.expected}\n` +
      `Responsable : ${r.reviewer.name}. La CI et l'accord sur le plan ne valident pas cet essai.\n\n` +
      '**Attendu de toi :** essayer ce candidat puis répondre « testé et validé » dans ce fil, ou « refusé » / décrire le problème. Un autre candidat exigera un nouvel accord.';
  };
  return {
    async read(id) {
      const c = await claim(id), v = await readValidation(stateDir, c), t = await thread(c);
      return { ...(validationProgress(v) || {}), snapshot: validationSnapshot(t, v, agentId), thread: t, record: v };
    },
    async review(id, who, { pr, snapshot, reason, comment }) {
      return lock(async () => {
        const c = await owned(id, who), old = await readValidation(stateDir, c), t = await thread(c);
        if (!text(reason) || snapshot !== validationSnapshot(t, old, agentId)) throw Error('review needs current snapshot and explicit reason');
        // Retry archived-subject reconciliation before replacing its only journal.
        for (const r of old?.history || []) if (r.superseded && !r.discussionResolved) {
          await syncDiscussion({ ...old, request: r }, { superseded: true, evidence: r.superseded });
          r.discussionResolved = true; await save(old);
        }
        const p = await matchingPr(c, pr);
        if (old?.state === 'waiting') {
          const changed = snapshot !== old.snapshot;
          let d;
          try { d = validationDecision(old, t, agentId); }
          catch (e) { if (!changed) throw e; d = { verdict: 'feedback' }; }
          const changedDecision = old.request?.decision && digest(old.request.decision) !== digest(d.comment);
          const feedback = ['feedback', 'declined'].includes(d.verdict) && d.comment?.id === comment;
          const replaced = old.head !== p.headRefOid || (!changed && !changedDecision && !feedback && digest(await readCandidate(p)) !== digest(old.request.candidate));
          if (!(changed || changedDecision || replaced || feedback)) throw Error('validation still pending; read feedback or verify a changed head before correcting');
          if (feedback) old.request.feedback = d.comment;
        }
        if (old?.request && old.state !== 'waiting' && comment) {
          const d = validationDecision(old, t, agentId);
          if (!['feedback', 'declined'].includes(d.verdict) || d.comment?.id !== comment) throw Error('correction must name the latest trial feedback');
          old.request.feedback = d.comment;
        }
        let plan, requiresPlan = false;
        try { plan = await approvedPlan(c, t, old); }
        catch (e) {
          if (!old || e.code !== 'PLAN_FEEDBACK') throw e;
          plan = old.plan; requiresPlan = true;
        }
        if (old?.request) old.request.superseded = reason;
        const v = { version: 1, ...Object.fromEntries(fields.map(k => [k, c[k]])), state: 'correcting', plan, pr: p.number, head: p.headRefOid,
          history: requests(old), reviewedAt: now(), reason, requiresPlan };
        v.snapshot = validationSnapshot(t, v, agentId);
        await active(c); await save(v);
        if (c.phase === VALIDATION_PHASE) await persistClaim({ ...c, phase: requiresPlan ? 'planning' : 'implementing', updatedAt: now() }, { unpark: true });
        if (old?.request) {
          await syncDiscussion(old, { superseded: true, evidence: reason });
          v.history.at(-1).discussionResolved = true; await save(v);
        }
        return validationProgress(v);
      });
    },
    async begin(id, who, { reviewer, procedure, expected }) {
      return lock(async () => {
        const c = await owned(id, who), v = await readValidation(stateDir, c);
        if (!v || !['implementing', 'landing', VALIDATION_PHASE].includes(c.phase)) throw Error('review validation before requesting a trial');
        if (v.state === 'approved') return validationProgress(v);
        await assertCanWait(c);
        // Reconcile a publication whose create response was lost before comparing the thread.
        if (v.request) await post(c, v, 'post', beginText(v));
        const p = await matchingPr(c, v.pr), t = await thread(c);
        await evidence(c, v, p, t);
        if (v.plan.validation.required !== 'required') throw Error('approved plan does not request a product trial');
        const candidate = await readCandidate(p);
        if (!v.request) {
          if (!text(procedure) || !text(expected)) throw Error('trial requires procedure and expected result');
          const user = await readReviewer(reviewer);
          if (!human({ user }, agentId)) throw Error('trial reviewer must be an identified human');
          v.request = { id: randomUUID(), candidate, reviewer: user, procedure, expected };
          await active(c); await save(v);
        } else if (digest(candidate) !== digest(v.request.candidate)) throw Error('candidate changed; review and request a new trial');
        await post(c, v, 'post', beginText(v));
        await active(c); v.state = 'waiting'; await save(v);
        if (c.phase !== VALIDATION_PHASE) await park(c);
        // Ordered and explicit: a failure retains all evidence and is retried by begin.
        await releaseLanding(c, `human validation ${v.request.id}`);
        v.request.released = true; await save(v);
        return validationProgress(v);
      });
    },
    async decision(id, who, { peek = false } = {}) {
      const work = async () => {
        const c = peek ? await claim(id) : await owned(id, who), v = await readValidation(stateDir, c);
        if (!v?.request) return { verdict: 'pending', stage: 'validation', issue: id };
        const currentPr = await readPr(v.pr);
        if (currentPr.state === 'MERGED' && currentPr.number === v.pr && currentPr.headRefOid === v.head) return { verdict: 'pending', stage: 'merged', issue: id, note: 'reconcile verified merge and closure; no new candidate action' };
        const t = await thread(c);
        if (validationSnapshot(t, v, agentId) !== v.snapshot) return { verdict: 'feedback', stage: 'validation', issue: id, reason: 'new or edited instructions; review validation', messages: t.comments.map(c => ({ id: c.id, body: c.body, at: c.updatedAt })) };
        const d = validationDecision(v, t, agentId);
        if (d.verdict !== 'approved') return d;
        if (!v.request.released) {
          if (peek) return { ...d, verdict: 'feedback', reason: 'validation admission incomplete; retry validation begin before consuming the reply' };
          throw Error('validation admission incomplete; retry validation begin before consuming the reply');
        }
        const p = await matchingPr(c, v.pr); await evidence(c, v, p, t);
        if (digest(await readCandidate(p)) !== digest(v.request.candidate)) throw Error('candidate changed; approval is stale');
        if (v.request.decision && digest(v.request.decision) !== digest(d.comment)) return { ...d, verdict: 'feedback', reason: 'human decision edited; request validation again' };
        if (peek) return d;
        await active(c); v.request.decision = d.comment; await save(v);
        await post(c, v, 'receipt', `**Validation humaine reçue** — PR ${v.pr}, candidat ${v.request.candidate.n}, réponse ${d.comment.id}.\n\n**Rien attendu de toi.** Pour information.`, v.request.post.id);
        await syncDiscussion(v, { evidence: d.comment.id });
        v.request.discussionResolved = true; v.state = 'approved'; await save(v);
        if (c.phase === VALIDATION_PHASE) await persistClaim({ ...c, phase: 'implementing', updatedAt: now() }, { unpark: true });
        return { ...d, registered: { phase: c.phase === VALIDATION_PHASE ? 'implementing' : c.phase, landing: 'acquire required' } };
      };
      return peek ? work() : lock(work);
    },
    async verify(c, p) {
      // Called under LANDING-0; no phase writes or reverse lock acquisition here.
      await active(c);
      const v = await readValidation(stateDir, c), t = await thread(c);
      await evidence(c, v, p, t);
      if (v.plan.validation.required === 'not-required') return { requirement: 'not-required', plan: v.plan.comment, snapshot: v.snapshot };
      if (v.state !== 'approved' || !v.request?.released || !v.request.decision || !v.request.discussionResolved) throw Error('human candidate validation not recorded');
      const d = validationDecision(v, t, agentId);
      if (d.verdict !== 'approved' || digest(d.comment) !== digest(v.request.decision)) throw Error('human validation changed or withdrawn');
      if (digest(await readCandidate(p)) !== digest(v.request.candidate)) throw Error('current channel candidate differs from human validation');
      await active(c);
      return { requirement: 'required', plan: v.plan.comment, request: v.request.id, decision: v.request.decision, candidate: v.request.candidate, snapshot: v.snapshot };
    },
  };
}
