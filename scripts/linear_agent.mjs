#!/usr/bin/env node
// Linear access layer for the autonomous agent loop.
//
// Every write goes out as the "jaunt Agent" OAuth application (app actor), never
// as the workspace owner. Credentials live in .dev-state/ and are never staged.
//
// The client secret never expires; the 30-day app token is a cache this script
// re-mints on its own whenever it is missing, stale, or rejected with a 401.

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = join(ROOT, '.dev-state');
const CREDENTIALS_FILE = join(STATE_DIR, 'linear-credentials.json');
const TOKEN_FILE = join(STATE_DIR, 'linear-token.json');
const LOOP_FILE = join(STATE_DIR, 'linear-loop.json');
const REVIEW_FILE = join(STATE_DIR, 'linear-review.json');
const CLAIMS_DIR = join(STATE_DIR, 'claims');
const SURFACES_DIR = join(STATE_DIR, 'surfaces');

// Marks a comment as the agent's plan, so the verdict lookup knows which
// comment the human's answer applies to.
const PLAN_MARKER = '<!-- jaunt-agent:plan -->';
const APPROVE_EMOJI = new Set(['+1', 'thumbsup', 'white_check_mark', 'rocket', 'tada']);
const DECLINE_EMOJI = new Set(['-1', 'thumbsdown', 'x', 'no_entry']);

const TOKEN_ENDPOINT = 'https://api.linear.app/oauth/token';
const GRAPHQL_ENDPOINT = 'https://api.linear.app/graphql';

// Scopes requested for the app actor token. Asking for a different set revokes
// every app token already issued, so this list is deliberately stable.
const SCOPES = 'read,write,issues:create,comments:create';

// Linear priority: 0 = none, 1 = urgent … 4 = low. Sort "none" last.
const priorityRank = (p) => (p === 0 ? 5 : p);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadCredentials() {
  let creds;
  try {
    creds = await readJson(CREDENTIALS_FILE);
  } catch {
    throw new Error(`missing ${CREDENTIALS_FILE} — create it with clientId/clientSecret`);
  }
  if (!creds.clientSecret || creds.clientSecret === 'PASTE_CLIENT_SECRET_HERE') {
    throw new Error(`client secret not set in ${CREDENTIALS_FILE}`);
  }
  return creds;
}

async function mintToken() {
  const creds = await loadCredentials();
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: SCOPES,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`token request failed (${res.status}): ${text.slice(0, 300)}`);
  const payload = JSON.parse(text);
  const token = {
    access_token: payload.access_token,
    scope: payload.scope,
    // Refresh a day early so a long task never dies mid-flight.
    expires_at: Date.now() + (payload.expires_in ?? 30 * 86400) * 1000 - 86400_000,
  };
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(TOKEN_FILE, JSON.stringify(token, null, 2), { mode: 0o600 });
  return token;
}

async function getToken({ force = false } = {}) {
  if (!force) {
    try {
      const cached = await readJson(TOKEN_FILE);
      if (cached.access_token && cached.expires_at > Date.now()) return cached;
    } catch {
      // No usable cache — fall through and mint a fresh one.
    }
  }
  return mintToken();
}

async function graphql(query, variables = {}, { retried = false } = {}) {
  const token = await getToken({ force: retried });
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token.access_token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  // A rejected token is the expected failure mode after 30 days: re-mint once.
  if (res.status === 401 && !retried) return graphql(query, variables, { retried: true });

  const text = await res.text();
  if (!res.ok) throw new Error(`graphql ${res.status}: ${text.slice(0, 400)}`);
  const payload = JSON.parse(text);
  if (payload.errors?.length) {
    throw new Error(`graphql errors: ${payload.errors.map((e) => e.message).join('; ')}`);
  }
  return payload.data;
}

// The app actor is a real Linear user ("jaunt Agent"), and its comments carry a
// normal `user`, not a `botActor` — so telling the agent's own writing apart
// from a human's means comparing against this id, nothing else.
let agentUserCache = null;
async function agentUser() {
  if (!agentUserCache) {
    const data = await graphql('{ viewer { id name displayName } }');
    agentUserCache = data.viewer;
  }
  return agentUserCache;
}

async function teamRef() {
  const { team } = await loadCredentials();
  if (!team) throw new Error('no "team" set in linear-credentials.json');
  return team;
}

// Resolve the configured team by key or name, with its workflow states.
async function resolveTeam() {
  const wanted = (await teamRef()).toLowerCase();
  const data = await graphql(`
    query {
      teams(first: 50) {
        nodes { id key name states { nodes { id name type position } } }
      }
    }
  `);
  const team = data.teams.nodes.find(
    (t) => t.key.toLowerCase() === wanted || t.name.toLowerCase() === wanted,
  );
  if (!team) {
    const seen = data.teams.nodes.map((t) => `${t.key}/${t.name}`).join(', ');
    throw new Error(`team "${wanted}" not found among: ${seen || '(none visible to the app)'}`);
  }
  team.states.nodes.sort((a, b) => a.position - b.position);
  return team;
}

const ISSUE_FIELDS = `
  id identifier title description priority sortOrder url createdAt updatedAt
  state { id name type }
  labels { nodes { name } }
  assignee { name }
  relations { nodes { id type relatedIssue { identifier title state { type } } } }
  inverseRelations { nodes { id type issue { identifier title state { type } } } }
  parent { identifier title }
  children { nodes { identifier title state { type } } }
`;

const DONE_TYPES = new Set(['completed', 'canceled']);

// Issues that must land before this one can be worked. Linear splits the two
// directions: an inverse "blocks" relation is something blocking us.
function blockedBy(issue) {
  return (issue.inverseRelations?.nodes ?? [])
    .filter((r) => r.type === 'blocks' && !DONE_TYPES.has(r.issue?.state?.type))
    .map((r) => r.issue.identifier);
}

// Dependencies stated in prose rather than as relations ("should be handled by
// JAU-3"). Not authoritative — a hint for the prioritisation pass to confirm.
// Comments count: replying to a plan is exactly where a human names a dependency.
function mentionedIssues(issue) {
  const prose = [issue.description ?? '', ...(issue.comments?.nodes ?? []).map((c) => c.body)].join('\n');
  const keys = new Set(prose.match(/\b[A-Z]{2,5}-\d+\b/g) ?? []);
  keys.delete(issue.identifier);
  return [...keys];
}

async function listIssues(stateTypes) {
  const team = await resolveTeam();
  const issues = [];
  let cursor = null;
  // Paginate: a board that outgrows one page must not silently lose its tail,
  // which is where the newest tickets sit.
  do {
    const data = await graphql(
      `query($teamId: ID!, $types: [String!], $after: String) {
        issues(
          first: 100
          after: $after
          filter: { team: { id: { eq: $teamId } }, state: { type: { in: $types } } }
        ) {
          nodes { ${ISSUE_FIELDS} comments(first: 50) { nodes { body } } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { teamId: team.id, types: stateTypes, after: cursor },
    );
    issues.push(...data.issues.nodes);
    cursor = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null;
  } while (cursor);
  return { team, issues };
}

// A cheap signature of the board, for the watcher to diff between polls. One
// query, no ledger, no claims — just enough to answer "has anything moved?".
async function pulse() {
  const team = await resolveTeam();
  const data = await graphql(
    `query($teamId: ID!) {
      issues(first: 100, filter: { team: { id: { eq: $teamId } } }) {
        nodes {
          identifier updatedAt
          state { name }
          comments(first: 1, orderBy: updatedAt) { nodes { id createdAt } }
        }
      }
    }`,
    { teamId: team.id },
  );
  const tickets = {};
  for (const i of data.issues.nodes) {
    tickets[i.identifier] = {
      u: i.updatedAt,
      s: i.state.name,
      c: i.comments.nodes[0]?.id ?? null,
    };
  }
  return { at: new Date().toISOString(), tickets };
}

// --- review ledger ----------------------------------------------------------
// What the prioritisation pass concluded, and for which version of each ticket.
// Without this the analysis is recomputed from nothing every tick and a ticket
// that arrives after the first pass is never compared against the board.

async function readLedger() {
  try {
    return await readJson(REVIEW_FILE);
  } catch {
    return { tickets: {} };
  }
}

async function markReviewed(identifier, rationale, group) {
  const issue = await getIssue(identifier);
  const ledger = await readLedger();
  const previous = ledger.tickets[issue.identifier];
  ledger.tickets[issue.identifier] = {
    reviewedAt: new Date().toISOString(),
    // Pinning the ticket's own updatedAt is what makes an edited ticket come
    // back for review instead of staying silently "already analysed".
    issueUpdatedAt: issue.updatedAt,
    rationale: rationale || previous?.rationale || null,
    // Root-cause group: tickets sharing one are the same defect and must never
    // be worked in parallel, however unrelated their relations look.
    group: group ?? previous?.group ?? null,
  };
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(REVIEW_FILE, JSON.stringify(ledger, null, 2));
  return { reviewed: issue.identifier, ...ledger.tickets[issue.identifier] };
}

// The agent owns the board: "next" is the best-ranked *unblocked* ticket that is
// ready to start. Todo wins over Backlog, so triage promoting a ticket is what
// puts it at the front.
//
// The sortOrder tiebreaker is a last resort, not a ranking: Linear assigns it
// per column (a ticket moved to In Progress is renumbered), so between two
// unprioritised tickets it encodes nothing anyone decided. When every open
// ticket sits at priority 0, `board().unprioritised` is true and the caller is
// expected to prioritise before claiming rather than trust this order.
async function nextIssue() {
  const { issues } = await listIssues(['unstarted', 'backlog']);
  const stateRank = (i) => (i.state.type === 'unstarted' ? 0 : 1);
  const ranked = issues
    .filter((i) => blockedBy(i).length === 0)
    .sort(
      (a, b) =>
        stateRank(a) - stateRank(b) ||
        priorityRank(a.priority) - priorityRank(b.priority) ||
        a.sortOrder - b.sortOrder,
    );
  return ranked[0] ?? null;
}

// The whole open board in one call, with everything needed to decide an order:
// priorities, blockers, and dependencies named in prose. `unprioritised` is the
// signal that `next` is about to fall back to sortOrder — an arbitrary sequence
// nobody chose — and that a prioritisation pass must run first.
async function board() {
  const { issues } = await listIssues(['unstarted', 'backlog', 'started']);
  const ledger = await readLedger();
  const tickets = issues
    .map((i) => ({
      review: (() => {
        const seen = ledger.tickets[i.identifier];
        if (!seen) return { state: 'never-reviewed' };
        const known = { reviewedAt: seen.reviewedAt, rationale: seen.rationale, group: seen.group ?? null };
        if (seen.issueUpdatedAt !== i.updatedAt) return { state: 'changed-since-review', ...known };
        return { state: 'reviewed', ...known };
      })(),
      identifier: i.identifier,
      title: i.title,
      state: i.state.name,
      priority: i.priority,
      sortOrder: i.sortOrder,
      blockedBy: blockedBy(i),
      blocks: (i.relations?.nodes ?? [])
        .filter((r) => r.type === 'blocks')
        .map((r) => r.relatedIssue.identifier),
      mentions: mentionedIssues(i),
      url: i.url,
    }))
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.sortOrder - b.sortOrder);
  const open = tickets.filter((t) => t.state !== 'Done');
  const needsReview = open.filter((t) => t.review.state !== 'reviewed').map((t) => t.identifier);
  return {
    count: tickets.length,
    // Informational only. This was once the trigger for the analysis pass, which
    // was a bug: it can only ever fire while every ticket is at priority 0, so
    // the first pass turned it off forever and nothing arriving afterwards could
    // switch it back on.
    unprioritised: open.length > 1 && open.every((t) => t.priority === 0),
    // The real trigger. A ticket that was never analysed, or that changed since
    // it was, has to be compared against the board before anything is claimed.
    needsPass: needsReview.length > 0,
    needsReview,
    tickets,
  };
}

async function getIssue(identifier) {
  const data = await graphql(
    `query($id: String!) {
      issue(id: $id) {
        ${ISSUE_FIELDS}
        comments(first: 100) {
          nodes {
            id body createdAt
            user { id name }
            reactions { emoji }
          }
        }
      }
    }`,
    { id: identifier },
  );
  if (!data.issue) throw new Error(`issue ${identifier} not found`);
  return data.issue;
}

async function addComment(identifier, body) {
  const issue = await getIssue(identifier);
  const data = await graphql(
    `mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success comment { id url }
      }
    }`,
    { issueId: issue.id, body },
  );
  if (!data.commentCreate.success) throw new Error('commentCreate failed');
  return data.commentCreate.comment;
}

async function moveIssue(identifier, stateName) {
  const issue = await getIssue(identifier);
  const team = await resolveTeam();
  const wanted = stateName.toLowerCase();
  const state = team.states.nodes.find((s) => s.name.toLowerCase() === wanted);
  if (!state) {
    const names = team.states.nodes.map((s) => s.name).join(', ');
    throw new Error(`state "${stateName}" not found. Available: ${names}`);
  }
  const data = await graphql(
    `mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success issue { identifier state { name } }
      }
    }`,
    { id: issue.id, stateId: state.id },
  );
  if (!data.issueUpdate.success) throw new Error('issueUpdate failed');
  return data.issueUpdate.issue;
}

async function setPriority(identifier, priority) {
  const issue = await getIssue(identifier);
  const data = await graphql(
    `mutation($id: String!, $priority: Int!) {
      issueUpdate(id: $id, input: { priority: $priority }) {
        success issue { identifier priority }
      }
    }`,
    { id: issue.id, priority },
  );
  if (!data.issueUpdate.success) throw new Error('issueUpdate failed');
  return data.issueUpdate.issue;
}

// --- writing structure ------------------------------------------------------
// A dependency the agent can see but not record is useless: the prioritisation
// pass has to be able to write what it worked out, not just describe it.

const RELATION_TYPES = new Set(['blocks', 'duplicate', 'related', 'similar']);

// `relate A blocks B` reads in that direction: A blocks B, so B is the one that
// cannot start. blockedBy() picks it up from B's inverseRelations.
async function relate(fromId, type, toId) {
  if (!RELATION_TYPES.has(type)) {
    throw new Error(`relation type must be one of: ${[...RELATION_TYPES].join(', ')}`);
  }
  const [from, to] = await Promise.all([getIssue(fromId), getIssue(toId)]);
  if (from.id === to.id) throw new Error('an issue cannot relate to itself');
  const data = await graphql(
    `mutation($issueId: String!, $relatedIssueId: String!, $type: IssueRelationType!) {
      issueRelationCreate(input: { issueId: $issueId, relatedIssueId: $relatedIssueId, type: $type }) {
        success issueRelation { id type }
      }
    }`,
    { issueId: from.id, relatedIssueId: to.id, type },
  );
  if (!data.issueRelationCreate.success) throw new Error('issueRelationCreate failed');
  return {
    ...data.issueRelationCreate.issueRelation,
    from: from.identifier,
    to: to.identifier,
    meaning: type === 'blocks' ? `${to.identifier} cannot start until ${from.identifier} is done` : undefined,
  };
}

// Relation ids come from `show`/`board` (relations[].id, inverseRelations[].id).
async function unrelate(relationId) {
  const data = await graphql(
    `mutation($id: String!) { issueRelationDelete(id: $id) { success } }`,
    { id: relationId },
  );
  if (!data.issueRelationDelete.success) throw new Error('issueRelationDelete failed');
  return { deleted: relationId };
}

// Splitting a ticket is part of planning, not something to describe in prose and
// hope a human retypes. `--parent` makes the new issue a sub-issue.
async function createIssue({ title, description, parent, priority }) {
  const team = await resolveTeam();
  const input = { teamId: team.id, title };
  if (description) input.description = description;
  if (priority !== undefined) input.priority = Number(priority);
  if (parent) input.parentId = (await getIssue(parent)).id;
  const data = await graphql(
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { identifier title url parent { identifier } } }
    }`,
    { input },
  );
  if (!data.issueCreate.success) throw new Error('issueCreate failed');
  return data.issueCreate.issue;
}

// --- attachments ------------------------------------------------------------
// Display bugs come with screenshots, and the image is usually the clearest
// statement of the defect. Linear's upload URLs need the app token, so they are
// fetched here and written to disk for the agent to open.
async function attachments(identifier, outDir) {
  const issue = await getIssue(identifier);
  const prose = [issue.description ?? '', ...issue.comments.nodes.map((c) => c.body)].join('\n');
  const urls = [...new Set(prose.match(/https:\/\/uploads\.linear\.app\/[^\s)"']+/g) ?? [])];
  if (urls.length === 0) return { issue: issue.identifier, attachments: [] };

  const dir = outDir || join(STATE_DIR, 'attachments', issue.identifier);
  await mkdir(dir, { recursive: true });
  const token = await getToken();
  const saved = [];
  for (const [index, url] of urls.entries()) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token.access_token}` } });
    if (!res.ok) {
      saved.push({ url, error: `HTTP ${res.status}` });
      continue;
    }
    const type = res.headers.get('content-type') ?? '';
    const ext = type.includes('png') ? 'png' : type.includes('jpeg') ? 'jpg' : type.includes('gif') ? 'gif' : 'bin';
    const path = join(dir, `${issue.identifier}-${index + 1}.${ext}`);
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
    saved.push({ path, type });
  }
  return { issue: issue.identifier, attachments: saved };
}

// Retracting a plan the agent itself posted — a flawed plan left on a ticket is
// read by whoever plans it next. Scoped to the agent's own comments on purpose:
// it must not be able to erase what a human wrote.
async function uncomment(commentId) {
  const me = await agentUser();
  const data = await graphql(
    `query($id: String!) { comment(id: $id) { id user { id name } } }`,
    { id: commentId },
  );
  if (!data.comment) throw new Error(`comment ${commentId} not found`);
  if (data.comment.user?.id !== me.id) {
    throw new Error(`comment ${commentId} was written by ${data.comment.user?.name ?? 'a human'} — refusing to delete it`);
  }
  const del = await graphql(
    `mutation($id: String!) { commentDelete(id: $id) { success } }`,
    { id: commentId },
  );
  if (!del.commentDelete.success) throw new Error('commentDelete failed');
  return { deleted: commentId };
}

// Comments written by humans since a cutoff — the triage loop's input. The
// agent's own comments are filtered out by author id.
async function humanFeedback(sinceIso) {
  const since = sinceIso ? new Date(sinceIso) : new Date(Date.now() - 7 * 86400_000);
  const team = await resolveTeam();
  const data = await graphql(
    `query($teamId: ID!, $since: DateTimeOrDuration!) {
      comments(
        first: 100
        filter: { issue: { team: { id: { eq: $teamId } } }, createdAt: { gt: $since } }
      ) {
        nodes {
          id body createdAt url
          user { id name }
          issue { identifier title state { name } }
        }
      }
    }`,
    { teamId: team.id, since: since.toISOString() },
  );
  const me = await agentUser();
  return data.comments.nodes.filter((c) => c.user?.id !== me.id);
}

// --- claims ----------------------------------------------------------------
// One file per claimed ticket, not one global lock. Each carries the UUID of the
// worker session that holds it, which is a durable address: the session lives on
// disk, so a claim whose orchestrator died is resumable, never orphaned.

const claimPath = (identifier) => join(CLAIMS_DIR, `${identifier}.json`);

async function listClaims() {
  let files = [];
  try {
    files = (await readdir(CLAIMS_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const claims = [];
  for (const file of files) {
    try {
      claims.push(await readJson(join(CLAIMS_DIR, file)));
    } catch {
      // A half-written claim is not a reason to refuse every other one.
    }
  }
  return claims;
}

async function claim(identifier, phase = 'planning', session) {
  const issue = await getIssue(identifier);
  const existing = await listClaims().then((c) => c.find((x) => x.issue === issue.identifier));
  const record = {
    issue: issue.identifier,
    title: issue.title,
    phase,
    // The worker session UUID — `claude -p --resume <session>` reopens it with
    // its context, which is how a comment reaches the worker that owns a ticket.
    session: session ?? existing?.session ?? null,
    url: issue.url,
    claimedAt: existing?.claimedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(CLAIMS_DIR, { recursive: true });
  await writeFile(claimPath(issue.identifier), JSON.stringify(record, null, 2));
  return record;
}

async function release(identifier) {
  const target = identifier ?? (await listClaims())[0]?.issue;
  if (!target) return { released: false, reason: 'no claim held' };
  await rm(claimPath(target), { force: true });
  await rm(join(CLAIMS_DIR, `${target}.stop`), { force: true });
  return { released: true, was: target };
}

// Cooperative stop. SendMessage reaches a worker session but only drains at its
// next tool round — it never preempts work already in flight. So the stop is a
// flag the worker is told to check at phase boundaries, and the message is the
// courtesy that explains why.
async function requestStop(identifier, reason) {
  await mkdir(CLAIMS_DIR, { recursive: true });
  const record = { issue: identifier, reason: reason || 'orchestrator asked for a clean wrap-up', at: new Date().toISOString() };
  await writeFile(join(CLAIMS_DIR, `${identifier}.stop`), JSON.stringify(record, null, 2));
  return record;
}

async function stopRequested(identifier) {
  try {
    return { stop: true, ...(await readJson(join(CLAIMS_DIR, `${identifier}.stop`))) };
  } catch {
    return { stop: false };
  }
}

async function lockStatus() {
  const claims = await listClaims();
  return { busy: claims.length > 0, claimed: claims.length, claims };
}

// --- change surfaces --------------------------------------------------------
// What a plan commits to touching. Declared by the worker, read by the
// orchestrator: overlap is what turns two "independent" tickets into one merge
// conflict, and it is only detectable if plans say what they will change.

async function declareSurface(identifier, files, symbols) {
  await mkdir(SURFACES_DIR, { recursive: true });
  const record = {
    ticket: identifier,
    files: (files ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    symbols: (symbols ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    declaredAt: new Date().toISOString(),
  };
  await writeFile(join(SURFACES_DIR, `${identifier}.json`), JSON.stringify(record, null, 2));
  return record;
}

async function readSurface(identifier) {
  try {
    return await readJson(join(SURFACES_DIR, `${identifier}.json`));
  } catch {
    return null;
  }
}

// --- loop switch -----------------------------------------------------------
// The crons re-arm themselves on every tick (which resets the scheduler's 7-day
// expiry), so this flag is the only thing that stops them: a tick that finds the
// loop off tears its own schedule down instead of rescheduling.

async function loopState() {
  try {
    return await readJson(LOOP_FILE);
  } catch {
    return { enabled: false };
  }
}

async function setLoop(enabled) {
  await mkdir(STATE_DIR, { recursive: true });
  const state = {
    enabled,
    [enabled ? 'startedAt' : 'stoppedAt']: new Date().toISOString(),
  };
  await writeFile(LOOP_FILE, JSON.stringify(state, null, 2));
  return state;
}

// --- independence gate ------------------------------------------------------
// Whether a ticket may be worked ALONGSIDE the ones already claimed. Deny by
// default: an indeterminate answer is a refusal, because the cost of serialising
// wrongly is a wait, and the cost of parallelising wrongly is two workers
// rewriting the same code and a board that says both succeeded.

// Blocking is transitive. A blocks B, B blocks C means C must not run with A,
// which a direct-relation check would happily allow.
function blockingClosure(tickets) {
  const byId = new Map(tickets.map((t) => [t.identifier, t]));
  const closure = new Map();
  for (const t of tickets) {
    const seen = new Set();
    const walk = (id) => {
      for (const dep of byId.get(id)?.blockedBy ?? []) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        walk(dep);
      }
    };
    walk(t.identifier);
    closure.set(t.identifier, seen);
  }
  return closure;
}

async function independent(identifier) {
  const state = await board();
  const claims = (await listClaims()).filter((c) => c.issue !== identifier);
  const ticket = state.tickets.find((t) => t.identifier === identifier);
  if (!ticket) throw new Error(`${identifier} is not on the open board`);

  const against = claims.map((c) => c.issue);
  const reasons = [];

  // Test 1 — analysed in its current version.
  if (ticket.review.state !== 'reviewed') {
    reasons.push(`${identifier} is ${ticket.review.state}: run the analysis pass before dispatching it`);
  }

  if (against.length > 0) {
    const closure = blockingClosure(state.tickets);
    const mine = closure.get(identifier) ?? new Set();
    const mySurface = await readSurface(identifier);

    for (const other of against) {
      // Test 2 — no blocking path, in either direction.
      const theirs = closure.get(other) ?? new Set();
      if (mine.has(other)) reasons.push(`${identifier} is blocked by ${other} (transitively)`);
      if (theirs.has(identifier)) reasons.push(`${other} is blocked by ${identifier} (transitively)`);

      // Test 3 — no shared root cause.
      const otherTicket = state.tickets.find((t) => t.identifier === other);
      const myGroup = ticket.review.group;
      const theirGroup = otherTicket?.review?.group;
      if (myGroup && theirGroup && myGroup === theirGroup) {
        reasons.push(`${identifier} and ${other} share root-cause group "${myGroup}"`);
      }

      // Test 4 — no overlapping change surface.
      const theirSurface = await readSurface(other);
      if (!theirSurface) {
        reasons.push(`${other} has declared no change surface — overlap with ${identifier} cannot be ruled out`);
      } else if (mySurface) {
        const files = mySurface.files.filter((f) => theirSurface.files.includes(f));
        const symbols = mySurface.symbols.filter((s) => theirSurface.symbols.includes(s));
        if (files.length) reasons.push(`${identifier} and ${other} both change ${files.join(', ')}`);
        if (symbols.length) reasons.push(`${identifier} and ${other} both touch ${symbols.join(', ')}`);
      }
    }
  }

  return {
    ticket: identifier,
    independent: reasons.length === 0,
    against: against.length ? against : '(nothing claimed)',
    reasons,
  };
}

// --- approval verdict ------------------------------------------------------
// Reads the thread under the agent's most recent plan comment and decides what
// the human said: approved, declined, feedback to fold in, or nothing yet.

async function verdict(identifier) {
  const issue = await getIssue(identifier);
  const me = await agentUser();
  const isAgent = (c) => c.user?.id === me.id;
  const comments = issue.comments.nodes;

  // Only a plan posted during the current claim counts. A plan left on the
  // ticket by an earlier cycle is stale, and treating it as live would let an
  // old approval (or a stray 👍) launch an implementation of something nobody
  // planned this time round.
  const held = (await listClaims()).find((c) => c.issue === issue.identifier);
  const claimedAt = held?.claimedAt ? new Date(held.claimedAt) : null;

  const plans = comments.filter(
    (c) =>
      isAgent(c) &&
      c.body.includes(PLAN_MARKER) &&
      (!claimedAt || new Date(c.createdAt) > claimedAt),
  );
  const plan = plans[plans.length - 1];
  if (!plan) {
    const stale = comments.some((c) => isAgent(c) && c.body.includes(PLAN_MARKER));
    return {
      verdict: 'no-plan',
      issue: issue.identifier,
      ...(stale ? { note: 'ticket carries a plan from an earlier claim; ignored as stale' } : {}),
    };
  }

  const planAt = new Date(plan.createdAt);
  const reactions = (plan.reactions ?? []).map((r) => r.emoji?.replace(/:/g, ''));
  if (reactions.some((e) => APPROVE_EMOJI.has(e))) {
    return { verdict: 'approved', issue: issue.identifier, via: 'reaction', messages: [] };
  }
  if (reactions.some((e) => DECLINE_EMOJI.has(e))) {
    return { verdict: 'declined', issue: issue.identifier, via: 'reaction', messages: [] };
  }

  const replies = comments
    .filter((c) => !isAgent(c) && new Date(c.createdAt) > planAt)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (replies.length === 0) {
    return { verdict: 'pending', issue: issue.identifier, planCommentId: plan.id };
  }

  const messages = replies.map((c) => ({ author: c.user?.name ?? 'user', body: c.body, at: c.createdAt }));
  const commands = replies.map((c) => c.body.trim().toLowerCase());
  if (commands.some((b) => b.startsWith('/approve'))) {
    return { verdict: 'approved', issue: issue.identifier, via: 'comment', messages };
  }
  if (commands.some((b) => b.startsWith('/decline'))) {
    return { verdict: 'declined', issue: issue.identifier, via: 'comment', messages };
  }
  return { verdict: 'feedback', issue: issue.identifier, messages };
}

async function whoami() {
  const data = await graphql('{ organization { id name urlKey } viewer { id name displayName } }');
  const token = await getToken();
  return {
    organization: data.organization,
    actingAs: data.viewer,
    scopes: token.scope,
    tokenExpiresAt: new Date(token.expires_at).toISOString(),
  };
}

const COMMANDS = {
  whoami: async () => whoami(),
  team: async () => {
    const team = await resolveTeam();
    return {
      id: team.id,
      key: team.key,
      name: team.name,
      states: team.states.nodes.map((s) => ({ name: s.name, type: s.type })),
    };
  },
  next: async () => nextIssue(),
  board: async () => board(),
  pulse: async () => pulse(),
  reviewed: async ([id, ...rest]) => {
    const { flags, rest: words } = parseFlags(rest);
    return markReviewed(
      required(id, 'reviewed <ISSUE-ID> <why it sits where it sits> [--group <root-cause>]'),
      words.join(' '),
      flags.group,
    );
  },
  independent: async ([id]) => independent(required(id, 'independent <ISSUE-ID>')),
  claims: async () => listClaims(),
  surface: async ([id, ...rest]) => {
    const { flags } = parseFlags(rest);
    return declareSurface(
      required(id, 'surface <ISSUE-ID> --files a,b --symbols x,y'),
      required(flags.files, '--files'),
      flags.symbols,
    );
  },
  stop: async ([id, ...reason]) =>
    requestStop(required(id, 'stop <ISSUE-ID> [reason]'), reason.join(' ')),
  'stop-requested': async ([id]) => stopRequested(required(id, 'stop-requested <ISSUE-ID>')),
  list: async ([type = 'unstarted']) => (await listIssues([type])).issues,
  show: async ([id]) => getIssue(required(id, 'show <ISSUE-ID>')),
  comment: async ([id, ...rest]) => {
    const body = rest.join(' ') || (await readStdin());
    return addComment(required(id, 'comment <ISSUE-ID> <body>'), required(body.trim(), 'comment body'));
  },
  move: async ([id, ...state]) =>
    moveIssue(required(id, 'move <ISSUE-ID> <state>'), required(state.join(' '), 'target state')),
  priority: async ([id, p]) => setPriority(required(id, 'priority <ISSUE-ID> <0-4>'), Number(p)),
  relate: async ([from, type, to]) =>
    relate(
      required(from, 'relate <ISSUE-A> <blocks|duplicate|related|similar> <ISSUE-B>'),
      required(type, 'relation type'),
      required(to, 'target issue'),
    ),
  unrelate: async ([id]) => unrelate(required(id, 'unrelate <RELATION-ID> (from show/board)')),
  attachments: async ([id, ...rest]) => {
    const { flags } = parseFlags(rest);
    return attachments(required(id, 'attachments <ISSUE-ID> [--out <dir>]'), flags.out);
  },
  uncomment: async ([id]) => uncomment(required(id, 'uncomment <COMMENT-ID> (agent-authored only)')),
  create: async (args) => {
    const { flags, rest } = parseFlags(args);
    const title = rest.join(' ') || flags.title;
    const description = flags.desc === '-' ? await readStdin() : flags.desc;
    return createIssue({
      title: required(title, 'create <TITLE> [--parent <ID>] [--priority <0-4>] [--desc <text>|-]'),
      description,
      parent: flags.parent,
      priority: flags.priority,
    });
  },
  feedback: async ([since]) => humanFeedback(since),
  // Lets callers locate the checkout without hardcoding a path: the script
  // resolves its own root, wherever the repo happens to live.
  repo: async () => ROOT,
  status: async () => ({ ...(await lockStatus()), loop: await loopState() }),
  'loop-on': async () => setLoop(true),
  'loop-off': async () => setLoop(false),
  claim: async ([id, phase, ...rest]) => {
    const { flags } = parseFlags(rest);
    return claim(required(id, 'claim <ISSUE-ID> [phase] [--session <uuid>]'), phase, flags.session);
  },
  release: async ([id]) => release(id),
  verdict: async ([id]) => verdict(required(id, 'verdict <ISSUE-ID>')),
  plan: async ([id, ...rest]) => {
    const body = rest.join(' ') || (await readStdin());
    return addComment(
      required(id, 'plan <ISSUE-ID> <body>'),
      `${PLAN_MARKER}\n${required(body.trim(), 'plan body')}`,
    );
  },
  'refresh-token': async () => {
    const t = await mintToken();
    return { scopes: t.scope, expiresAt: new Date(t.expires_at).toISOString() };
  },
};

// Splits `--flag value` pairs out of an argument list, leaving the positional
// words in `rest`.
function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--')) {
      flags[args[i].slice(2)] = args[i + 1];
      i += 1;
    } else {
      rest.push(args[i]);
    }
  }
  return { flags, rest };
}

function required(value, what) {
  if (!value) throw new Error(`missing argument: ${what}`);
  return value;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const [command, ...args] = process.argv.slice(2);
const handler = COMMANDS[command];
if (!handler) {
  console.error(`usage: linear_agent.mjs <${Object.keys(COMMANDS).join('|')}>`);
  process.exit(2);
}

try {
  const result = await handler(args);
  // Plain strings print raw so they can be used directly in shell substitution.
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
