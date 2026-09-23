// Ticket discussion state survives worker claims. All network writes are called
// by the canonical linear_agent CLI; tests inject an isolated API and state dir.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, readJson, withWorkerLock } from './linear_workers.mjs';
import { readReply, decideAnswer } from './linear_answers.mjs';

export const ACTIVITY_LABELS = {
  origin: 'Créé par le harnais', unread: 'Du neuf du harnais', active: 'Discussion active',
};
export const ORIGIN_MARKER = '<!-- jaunt-agent:created -->';
const PROVENANCE_MARKER = '<!-- jaunt-agent:provenance -->';
const ACK_MARKER = '<!-- jaunt-agent:ack -->';
const PLAN_MARKER = '<!-- jaunt-agent:plan -->';
const READ_EMOJI = new Set(['eyes', '👀', '+1', 'thumbsup', '👍', 'white_check_mark', 'rocket', 'tada', '-1', 'thumbsdown', 'x', 'no_entry']);
const APPROVE = new Set(['+1', 'thumbsup', '👍', 'white_check_mark', 'rocket', 'tada']);
const DECLINE = new Set(['-1', 'thumbsdown', 'x', 'no_entry']);
const ackText = body => /^(?:lu|vu|merci|\/approve|\/decline)[.!\s]*$/i.test(body.trim());
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nonempty = value => typeof value === 'string' && Boolean(value.trim());
const originLabel = issue => issue.labels.nodes.some(l => l.name === ACTIVITY_LABELS.origin);
const keyOf = id => { if (!/^[A-Z][A-Z0-9]*-\d+$/.test(id)) throw new Error('invalid discussion identifier'); return id; };
// The watcher's incremental sync re-reads a tracked ticket only when Linear's
// `updatedAt` moved (comments and reactions bump it), plus a full sweep this
// often. Reading every comment and reaction of every tracked ticket twice per
// 30 s poll cost ~50 000 complexity points, ~4.4 M/h against Linear's 2 M/h,
// and the API cut the loop off for an hour on 23/09 (JAU-62).
export const FULL_SWEEP_MS = 30 * 60_000;
const human = (user, me) => Boolean(user?.id && user.id !== me && user.email && !/@oauthapp\.linear\.app$/i.test(user.email));

// Connections must be complete before deciding that there is nothing left.
export async function connectionPages(fetchPage) {
  const nodes = [], seen = new Set();
  let cursor = null;
  for (;;) {
    const page = await fetchPage(cursor);
    if (!Array.isArray(page?.nodes) || !page.pageInfo) throw new Error('incomplete activity connection');
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return nodes;
    const next = page.pageInfo.endCursor;
    if (!next || seen.has(next)) throw new Error('activity pagination did not advance');
    seen.add(next); cursor = next;
  }
}

function validate(record, id) {
  if (!record || record.issue !== id || record.version !== 1 || !iso(record.since) ||
      !Number.isInteger(record.revision) || !Array.isArray(record.subjects) || !Array.isArray(record.technical)) {
    throw new Error(`${id}: unreadable discussion ledger; preserve it and reconcile`);
  }
  const keys = new Set();
  for (const s of record.subjects) {
    if (!nonempty(s.key) || keys.has(s.key) || !nonempty(s.title) || !nonempty(s.owner) || !nonempty(s.source) ||
        !['open', 'resolved', 'transferred'].includes(s.state) ||
        (s.state !== 'open' && (!nonempty(s.reason) || !nonempty(s.evidence))) ||
        (s.state === 'transferred' && !/^[A-Z][A-Z0-9]*-\d+$/.test(s.ticket || ''))) throw new Error(`${id}: invalid discussion subject`);
    keys.add(s.key);
  }
  return record;
}

export function discussionStore(stateDir) {
  const dir = join(stateDir, 'discussions');
  return {
    async read(id) { keyOf(id); const record = await readJson(join(dir, `${id}.json`)); return record && validate(record, id); },
    async save(record) { validate(record, record.issue); await atomicJson(join(dir, `${keyOf(record.issue)}.json`), record); },
    async ids() {
      try { return (await readdir(dir)).filter(f => /^[A-Z][A-Z0-9]*-\d+\.json$/.test(f)).map(f => f.slice(0, -5)); }
      catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    },
    // Separate lock namespace from launch/cleanup. Uncertain process identity is
    // never stolen. A busy operation is retryable, without publishing twice.
    lock(id, run) { return withWorkerLock(join(stateDir, 'discussion-locks'), keyOf(id), run); },
  };
}

export function observeActivity(record, issue, me) {
  const next = structuredClone(record);
  const subjects = new Map(next.subjects.map(s => [s.key, s]));
  const add = (key, title, owner, source) => {
    if (!subjects.has(key)) subjects.set(key, { key, title, owner, source, state: 'open' });
  };
  const comments = issue.comments.filter(c => iso(c.createdAt) && !(record.baseline || []).includes(c.id) && Date.parse(c.createdAt) >= Date.parse(record.since));
  const publications = comments.filter(c => c.user?.id === me && !c.botActor &&
    !record.technical.includes(c.id) && !c.body.startsWith(ACK_MARKER));
  let acknowledged = -Infinity;
  for (const c of comments) {
    if (!c.botActor && human(c.user, me)) {
      acknowledged = Math.max(acknowledged, Date.parse(c.createdAt));
      // An approval or a cheer is an answer, not a new question for the worker.
      if (!ackText(c.body) && readReply(c.body) === 'correction') add(`feedback:${c.id}`, c.body.slice(0, 180), 'worker', c.id);
    }
  }
  for (const c of publications) {
    if (c.body.startsWith(PLAN_MARKER)) {
      add(`plan:${c.id}`, 'Décision sur le plan', 'human', c.id);
      add(`work:${c.id}`, 'Réalisation et livraison du plan', 'worker', c.id);
    } else if (c.body.includes('**Attendu de toi :**')) {
      add(`expect:${c.id}`, c.body.split('**Attendu de toi :**').at(-1).trim().slice(0, 180) || 'Réponse attendue', 'human', c.id);
    }
    for (const r of c.reactions || []) {
      const emoji = r.emoji?.replace(/:/g, '');
      if (human(r.user, me) && iso(r.createdAt) && Date.parse(r.createdAt) >= Date.parse(c.createdAt) && READ_EMOJI.has(emoji)) {
        // Reacting to an old message cannot acknowledge a newer publication.
        acknowledged = Math.max(acknowledged, Date.parse(c.createdAt));
      }
    }
  }
  // Plan decisions can close their own question, never the promised work or
  // another question. Later prose wins; skills reconcile it explicitly.
  for (const c of publications.filter(c => c.body.startsWith(PLAN_MARKER))) {
    const answers = comments.filter(h => !h.botActor && human(h.user, me) && Date.parse(h.createdAt) > Date.parse(c.createdAt))
      .map(h => ({ at: h.createdAt, kind: readReply(h.body), evidence: h.id }));
    for (const on of publications.filter(p => Date.parse(p.createdAt) >= Date.parse(c.createdAt))) {
      for (const r of on.reactions || []) {
        const emoji = r.emoji?.replace(/:/g, '');
        if (human(r.user, me) && iso(r.createdAt) && (APPROVE.has(emoji) || DECLINE.has(emoji))) {
          answers.push({ at: r.createdAt, kind: APPROVE.has(emoji) ? 'approve' : 'decline', evidence: on.id });
        }
      }
    }
    // Same reading as `verdict` (JAU-80): the newest decisive answer, looking
    // through cheers, so the registry and the claim never disagree.
    const last = decideAnswer(answers), subject = subjects.get(`plan:${c.id}`);
    if (subject.state === 'open' && ['approve', 'decline'].includes(last?.kind)) Object.assign(subject, {
      state: 'resolved', reason: last.kind === 'approve' ? 'Plan approuvé' : 'Plan refusé', evidence: last.evidence,
    });
  }
  const unread = publications.some(c => Date.parse(c.body.startsWith(PROVENANCE_MARKER) ? issue.createdAt : c.createdAt) > acknowledged);
  next.subjects = [...subjects.values()];
  next.unread = unread;
  next.active = unread || next.subjects.some(s => s.state === 'open');
  return next;
}

export function updateSubjects(record, patch, comments) {
  if (!patch || patch.revision !== record.revision) throw new Error('discussion revision changed; read before updating');
  if (!Array.isArray(patch.subjects) || !patch.subjects.length) throw new Error('subjects patch required');
  const next = structuredClone(record), subjects = new Map(next.subjects.map(s => [s.key, s]));
  const seen = new Set();
  for (const item of patch.subjects) {
    if (seen.has(item.key)) throw new Error('duplicate subject key');
    seen.add(item.key);
    const previous = subjects.get(item.key);
    if (previous && (previous.source !== item.source || (previous.ticket && previous.ticket !== item.ticket))) throw new Error('preserve subject source and transfer target');
    if (!previous && item.source !== 'issue' && !comments.some(c => c.id === item.source)) throw new Error('subject source comment not found');
    subjects.set(item.key, { ...item });
  }
  next.subjects = [...subjects.values()];
  return validate(next, record.issue);
}

export function activityService({ stateDir, graphql, team, agent }) {
  const store = discussionStore(stateDir);
  let labelsPromise;
  const pageInfo = 'pageInfo { hasNextPage endCursor }';
  const labels = () => labelsPromise ||= store.lock('LABEL-0', async () => {
    const t = await team();
    const found = await connectionPages(async cursor => (await graphql(
      `query($teamId: ID!, $cursor: String) { issueLabels(first: 100, after: $cursor, filter: { team: { id: { eq: $teamId } } }) { nodes { id name } ${pageInfo} } }`,
      { teamId: t.id, cursor })).issueLabels);
    const ids = {};
    for (const [kind, name] of Object.entries(ACTIVITY_LABELS)) {
      let matches = found.filter(l => l.name === name);
      if (matches.length > 1) throw new Error(`ambiguous activity label: ${name}`);
      if (!matches.length) {
        const data = await graphql('mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success issueLabel { id name } } }',
          { input: { teamId: t.id, name, description: `jaunt managed: ${kind}`, color: { origin: '#6B7280', unread: '#F59E0B', active: '#3B82F6' }[kind] } });
        if (!data.issueLabelCreate.success) throw new Error(`cannot create activity label: ${name}`);
        matches = [data.issueLabelCreate.issueLabel];
      }
      ids[kind] = matches[0].id;
    }
    return ids;
  });
  async function readIssue(id) {
    keyOf(id);
    let issue;
    const comments = await connectionPages(async cursor => {
      const data = await graphql(`query($id: String!, $cursor: String) { issue(id: $id) {
        id identifier title description createdAt updatedAt team { id } labels { nodes { id name } }
        comments(first: 100, after: $cursor) { nodes { id body createdAt parent { id } botActor { id }
          user { id email } reactions { emoji createdAt user { id email } } } ${pageInfo} }
      } }`, { id, cursor });
      if (!data.issue) throw new Error(`${id}: issue not found`);
      issue ||= data.issue;
      return data.issue.comments;
    });
    if (issue.team.id !== (await team()).id) throw new Error('discussion outside configured team');
    return { ...issue, comments };
  }
  async function initial(issue, { recovery = false } = {}) {
    let record = await store.read(issue.identifier);
    if (record) return record;
    recovery ||= Boolean(issue.labels.nodes.some(l => Object.values(ACTIVITY_LABELS).includes(l.name)));
    record = { version: 1, issue: issue.identifier, revision: 0, since: issue.createdAt, baseline: recovery ? [] : issue.comments.map(c => c.id), technical: [], subjects: [] };
    if (!recovery && issue.comments.length) record.subjects.push({ key: 'review:baseline', title: 'Vérifier les sujets déjà ouverts au début du suivi', owner: 'worker', source: 'issue', state: 'open' });
    if (recovery) record.subjects.push({ key: 'recovery', title: 'Vérifier les sujets après récupération du registre', owner: 'worker', source: 'issue', state: 'open' });
    await store.save(record);
    return record;
  }
  async function saveChanged(before, next) {
    if (JSON.stringify(before) !== JSON.stringify(next)) {
      next.revision = before.revision + 1;
      await store.save(next);
    }
    return next;
  }
  async function apply(issue, record) {
    const ids = await labels();
    const have = new Set(issue.labels.nodes.map(l => l.id));
    const desired = { unread: record.unread, active: record.active };
    if (record.origin || originLabel(issue)) desired.origin = true;
    for (const [kind, wanted] of Object.entries(desired)) {
      if (have.has(ids[kind]) === Boolean(wanted)) continue;
      const mutation = wanted ? 'issueAddLabel' : 'issueRemoveLabel';
      const data = await graphql(`mutation($id: String!, $labelId: String!) { ${mutation}(id: $id, labelId: $labelId) { success } }`, { id: issue.id, labelId: ids[kind] });
      if (!data[mutation].success) throw new Error(`${mutation} failed for ${issue.identifier}`);
    }
  }
  async function reconcile(issue, record) {
    const me = (await agent()).id;
    const observed = observeActivity(record, issue, me);
    if (originLabel(issue)) observed.origin = true;
    const next = await saveChanged(record, observed);
    // Durable facts precede API mutations, so a failed label write is repairable.
    await apply(issue, next);
    return next;
  }
  async function rawComment(issue, body, parent) {
    // Linear only accepts the root parent. Follow the actual parent chain rather
    // than retrying a failed create (an ambiguous failure could duplicate it).
    const visited = new Set();
    while (parent) {
      if (visited.has(parent)) throw new Error('cyclic comment parent');
      visited.add(parent);
      const c = issue.comments.find(c => c.id === parent);
      if (!c) throw new Error('reply comment not found on issue');
      if (!c.parent?.id) break;
      parent = c.parent.id;
    }
    const data = await graphql(`mutation($issueId: String!, $body: String!, $parentId: String) {
      commentCreate(input: { issueId: $issueId, body: $body, parentId: $parentId }) { success comment { id url } }
    }`, { issueId: issue.id, body, parentId: parent || null });
    if (!data.commentCreate.success) throw new Error('commentCreate failed');
    return data.commentCreate.comment;
  }
  async function provenance(issue, record) {
    if (!(record.origin || originLabel(issue)) || !issue.description?.includes(ORIGIN_MARKER)) return;
    const me = (await agent()).id;
    if (issue.comments.some(c => c.user?.id === me && c.body.startsWith(PROVENANCE_MARKER))) return;
    const reason = issue.description.replace(ORIGIN_MARKER, '').trim();
    // Recovery republishes no new facts: unread chronology uses issue.createdAt
    // for this marker, so a delayed provenance repair cannot undo a human reply.
    await rawComment(issue, `${PROVENANCE_MARKER}\nTicket créé par le harnais. Motif et origine fournis :\n\n${reason}`, null);
    return true;
  }
  return {
    labels,
    async creationInput(description) { const ids = await labels(); return { description: `${description}\n\n${ORIGIN_MARKER}`, labelIds: Object.values(ids) }; },
    async created(id) {
      return store.lock(id, async () => {
        let issue = await readIssue(id);
        const record = await initial(issue, { recovery: true });
        record.since = issue.createdAt;
        record.origin = true;
        record.subjects = record.subjects.filter(s => s.key !== 'recovery');
        if (!record.subjects.some(s => s.key === 'work:creation')) record.subjects.push({ key: 'work:creation', title: issue.title, owner: 'worker', source: 'issue', state: 'open' });
        await store.save(record);
        await provenance(issue, record);
        issue = await readIssue(id);
        return reconcile(issue, record);
      });
    },
    async publish(id, body, parent, { technical = false } = {}) {
      return store.lock(id, async () => {
        const issue = await readIssue(id);
        const record = await initial(issue);
        const comment = await rawComment(issue, body, parent);
        try {
          if (technical) { record.technical.push(comment.id); record.revision++; await store.save(record); }
          const activity = await reconcile(await readIssue(id), record);
          return { ...comment, activity: { ok: true, unread: activity.unread, active: activity.active } };
        } catch (e) { return { ...comment, activity: { ok: false, error: e.message, retry: `sync-activity ${id}; do not republish the comment` } }; }
      });
    },
    async read(id) { return store.read(keyOf(id)); },
    async update(id, patch) {
      return store.lock(id, async () => {
        const issue = await readIssue(id), before = await initial(issue);
        const next = updateSubjects(before, patch, issue.comments);
        for (const s of patch.subjects.filter(s => s.state === 'transferred')) {
          if (s.ticket === id) throw new Error('cannot transfer a subject to itself');
          const target = await graphql(`query($id: String!) { issue(id: $id) { id relations { nodes { type relatedIssue { identifier } } } inverseRelations { nodes { type issue { identifier } } } } }`, { id: s.ticket });
          const t = target.issue;
          if (!t || ![...(t.relations?.nodes || []).map(r => ({ type: r.type, id: r.relatedIssue.identifier })), ...(t.inverseRelations?.nodes || []).map(r => ({ type: r.type, id: r.issue.identifier }))].some(r => r.type === 'related' && r.id === id)) throw new Error('transfer needs a verified related ticket');
          await store.lock(s.ticket, async () => {
            const targetIssue = await readIssue(s.ticket), targetRecord = await initial(targetIssue);
            const key = `transfer:${id}:${s.key}`;
            if (!targetRecord.subjects.some(item => item.key === key)) {
              const changed = structuredClone(targetRecord);
              changed.subjects.push({ key, title: s.title, owner: s.owner, source: 'issue', state: 'open', origin: id });
              await reconcile(targetIssue, await saveChanged(targetRecord, changed));
            }
          });
        }
        return reconcile(issue, await saveChanged(before, next));
      });
    },
    // `incremental` (the watcher): skip tracked tickets whose `updatedAt` has
    // not moved since their last successful sync, except on a full sweep.
    async sync(id, { incremental = false, now = Date.now() } = {}) {
      let ids;
      const discovered = new Map();
      const cursorPath = join(stateDir, 'activity-sync.json');
      const cursor = (id ? null : await readJson(cursorPath).catch(() => null)) || { fullAt: 0, seen: {} };
      const full = !incremental || now - cursor.fullAt >= FULL_SWEEP_MS;
      if (id) ids = [keyOf(id)];
      else {
        const t = await team();
        const issues = await connectionPages(async cursor => (await graphql(`query($teamId: ID!, $cursor: String) {
          issues(first: 100, after: $cursor, includeArchived: true, filter: { team: { id: { eq: $teamId } } }) {
            nodes { identifier updatedAt description labels { nodes { name } } } ${pageInfo}
          }
        }`, { teamId: t.id, cursor })).issues);
        for (const i of issues) discovered.set(i.identifier, i.updatedAt);
        ids = [...new Set([...(await store.ids()), ...issues.filter(i => i.labels.nodes.some(l => Object.values(ACTIVITY_LABELS).includes(l.name))).map(i => i.identifier)])];
      }
      const results = [], failures = [], seen = full ? {} : { ...cursor.seen };
      let skipped = 0;
      for (const key of ids) {
        // A ticket missing from discovery (deleted) is always retried: that is
        // how its error stays visible.
        if (!full && discovered.has(key) && cursor.seen[key] === discovered.get(key)) { skipped += 1; continue; }
        try {
          results.push(await store.lock(key, async () => {
            let issue = await readIssue(key);
            const existing = await store.read(key);
            const tracked = issue.labels.nodes.some(l => Object.values(ACTIVITY_LABELS).includes(l.name));
            const record = existing || await initial(issue, { recovery: Boolean(tracked) });
            // Read again only when provenance actually wrote a comment.
            if (await provenance(issue, record)) issue = await readIssue(key);
            const next = await reconcile(issue, record);
            return { issue: key, unread: next.unread, active: next.active, revision: next.revision };
          }));
          // The discovery date, not the post-sync one: a label written just now
          // moves `updatedAt`, which costs one more read next poll, then settles.
          if (discovered.has(key)) seen[key] = discovered.get(key);
        } catch (e) { failures.push({ issue: key, error: e.message }); delete seen[key]; }
      }
      if (!id) await atomicJson(cursorPath, { fullAt: full ? now : cursor.fullAt, seen });
      return { ok: failures.length === 0, tickets: results, errors: failures, ...(id ? {} : { full, skipped }) };
    },
  };
}
