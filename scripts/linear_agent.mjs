#!/usr/bin/env node
// Linear access layer for the autonomous agent loop.
//
// Every write goes out as the "jaunt Agent" OAuth application (app actor), never
// as the workspace owner. Credentials live in .dev-state/ and are never staged.
//
// The client secret never expires; the 30-day app token is a cache this script
// re-mints on its own whenever it is missing, stale, or rejected with a 401.

import { readFile, writeFile, mkdir, readdir, rm, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { phaseHistory, archiveClaim, telemetryArchivePath, telemetryReport } from './linear_telemetry.mjs';
import { skillStore } from './linear_skills.mjs';
import { landingStore, assertLandingAdmission, assertLandingReleased } from './linear_landing.mjs';
import { WAIT_PHASE, guardWaitTransition, assertWaitResolved, waitStore, promoteWaitQueue } from './linear_waits.mjs';
import { connectionPages } from './linear_activity.mjs';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// The watcher owns the shape of its own pulse, so the liveness verdict is read
// from there rather than reimplemented here. Importing it starts nothing: its
// entry point is guarded on argv[1], which is this file.
import { WATCH_FILE, WATCHDOG_FILE, watcherHealth, livePid } from './linear_watch.mjs';

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { workerReports, currentAttempt, cleanupWorktree, withWorkerLock, lifecyclePaths, hash } from './linear_workers.mjs';
const exec = promisify(execFile);
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
// Marks the one-line receipt posted when an approval is read. Its own marker,
// because the acknowledgement has to be recognisable later: posting it twice is
// how a ticket ends up saying "approbation reçue" three times and meaning none.
const ACK_MARKER = '<!-- jaunt-agent:ack -->';
const APPROVE_EMOJI = new Set(['+1', 'thumbsup', 'white_check_mark', 'rocket', 'tada']);
const DECLINE_EMOJI = new Set(['-1', 'thumbsdown', 'x', 'no_entry']);

// The column that means "this ticket is waiting on a human". *In Progress* used
// to cover three situations the human could not tell apart — the agent is
// planning, the agent is waiting for an answer, the agent is implementing — and
// the only one where the human had something to do was the only one that did
// not announce itself (JAU-18).
export const WAITING_STATE = 'Waiting for human';

// A claim's phase used to be a free-form string nothing ever read, which is how
// `implementing` came to be a value no code and no skill had ever written. A
// closed list turns a drifting field into one that fails loudly.
//
// `queued` means "approved, and not writing yet": the human has answered, so the
// ticket owes them nothing, but another worker holds a file this one declared.
// It exists because none of the other four could say that without lying —
// staying `awaiting-approval` would put *Waiting for human* on a ticket where
// the human is done (the exact confusion JAU-18 removed), and going straight to
// `implementing` is the race this phase avoids.
export const PHASES = ['planning', 'awaiting-approval', 'queued', 'implementing', 'landing', WAIT_PHASE];

// The phases that actually hold the working tree. `planning` reads, greps and
// surveys; `awaiting-approval` is a session that finished its turn; `queued` is
// waiting for one of these two to release. None of them can collide with
// anything, and comparing a candidate against them is how a board with one
// parked worker refused to dispatch anything else for sixteen hours (JAU-46).
export const CONTENDING_PHASES = ['implementing', 'landing'];

export const contendingClaims = (claims) =>
  (claims ?? []).filter((c) => CONTENDING_PHASES.includes(c?.phase));

const TOKEN_ENDPOINT = 'https://api.linear.app/oauth/token';
const GRAPHQL_ENDPOINT = 'https://api.linear.app/graphql';

// Scopes requested for the app actor token. Asking for a different set revokes
// every app token already issued, so this list is deliberately stable.
const SCOPES = 'read,write,issues:create,comments:create';

// Linear priority: 0 = none, 1 = urgent … 4 = low. Sort "none" last.
const priorityRank = (p) => (p === 0 ? 5 : p);

const PRIORITIES = new Map([['urgent', 1], ['high', 2], ['medium', 3], ['low', 4], ['none', 0]]);
const PRIORITY_USAGE = 'urgent|high|medium|low|none';

// Omission is allowed only when creating an issue. Numeric CLI values are
// deliberately rejected: Linear's 0 means no priority, not "P0 urgent".
export function parsePriority(value, { optional = false } = {}) {
  if (optional && value === undefined) return undefined;
  if (!PRIORITIES.has(value)) {
    throw new Error(`priority must be one of ${PRIORITY_USAGE}; numeric priorities are not accepted (0 means no priority; use none, or urgent for urgency)`);
  }
  return PRIORITIES.get(value);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

// Every agent comment has to end by saying what the human owes in return, so a
// ticket can be triaged without reading the whole thread. `--expects none` is
// the explicit way to say "nothing" — silence is not an option, because a
// comment nobody has to act on is usually a comment that should not exist.
const EXPECTS_MARKER = '**Attendu de toi :**';

function expectsLine(expects) {
  if (!expects || expects === 'none' || expects === 'rien') {
    return '**Rien attendu de toi.** Pour information.';
  }
  return `${EXPECTS_MARKER} ${expects}`;
}

// Creation must distinguish an explicit absence of a request from an omitted
// decision. Status cannot tell us whether a backlog arbitration or test is due.
export function issueDescription(description = '', expects) {
  if (typeof expects !== 'string' || !expects.trim() || /[\r\n]/.test(expects)) {
    throw new Error('create requires --expects <action|none> on one line');
  }
  if (typeof description !== 'string') throw new Error('--desc needs text or -');
  const line = expectsLine(expects.trim());
  const lines = description.split(/\r?\n/);
  const existing = lines.filter((s) => s.includes(EXPECTS_MARKER) || s.includes('**Rien attendu de toi.**'));
  if (existing.length > 1 || (existing.length === 1 && existing[0].trim() !== line)) {
    throw new Error('description has a conflicting or duplicate expectation; use --expects');
  }
  return existing.length ? description : [description.trim(), line].filter(Boolean).join('\n\n');
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

// Linear notifies subscribers, and nothing else. A ticket the harness opened
// carried an empty subscriber list, so it announced itself to nobody — eight in
// a row, including the ones parked waiting for an approval. The single moment
// the human has to act was the single moment that stayed silent (JAU-44).
//
// Who to notify is *derived*, not configured. Measured on this workspace: the
// app actor is not a member of the team, so a team's members are exactly its
// humans and a fresh clone needs no extra setup step to be notified. The
// optional `owner` in linear-credentials.json is the override for a team with
// more than one human on it.
const APP_ACTOR_EMAIL = /@oauthapp\.linear\.app$/i;

const namesUser = (member, wanted) =>
  [member.id, member.email, member.displayName, member.name].some(
    (v) => typeof v === 'string' && v.toLowerCase() === wanted,
  );

export function pickOwners(members, owner, agentId = null) {
  // The agent is never notified of its own writing, however it is designated —
  // by id, by its @oauthapp address, or by an `owner` line naming it.
  const candidates = (members ?? []).filter(
    (m) => m && m.id !== agentId && !APP_ACTOR_EMAIL.test(m.email ?? ''),
  );
  if (owner) {
    const wanted = (Array.isArray(owner) ? owner : [owner])
      .map((o) => String(o).trim().toLowerCase())
      .filter(Boolean);
    // An explicit owner outranks the filters below: naming a guest account is an
    // odd thing to do, and overruling it in silence would be the worse answer.
    return candidates.filter((m) => wanted.some((w) => namesUser(m, w)));
  }
  // Nobody named: every human on the team. A deactivated account and a guest are
  // the two that would be notified of work they cannot act on.
  return candidates.filter((m) => m.active !== false && !m.guest);
}

// `issueUpdate` *replaces* the subscriber list rather than adding to it, so
// subscribing an existing issue has to union with what is already there. Writing
// only when somebody is genuinely missing is the other half: a re-claim that
// re-asserts the same list posts an activity entry saying nothing changed.
export function subscribersToAdd(current, wanted) {
  const have = new Set(current ?? []);
  return [...new Set(wanted ?? [])].filter((id) => !have.has(id));
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

// Cached like agentUser(): a team's membership does not change inside one run.
let boardHumansCache = null;
async function boardHumans() {
  if (boardHumansCache) return boardHumansCache;
  const [{ owner }, team, me] = await Promise.all([loadCredentials(), resolveTeam(), agentUser()]);
  const data = await graphql(
    `query($id: String!) {
      team(id: $id) {
        members(first: 50) { nodes { id name displayName email active guest } }
      }
    }`,
    { id: team.id },
  );
  boardHumansCache = pickOwners(data.team?.members?.nodes ?? [], owner, me.id);
  return boardHumansCache;
}

// Subscribing an issue that already exists — the parking path. It must never be
// able to abort what it decorates, which is the rule parking itself already
// follows, so every caller wraps it and reports the failure instead of throwing.
async function notifyOwners(issueId) {
  const humans = await boardHumans();
  if (!humans.length) return { ok: false, reason: 'no human member found on the team' };
  const data = await graphql(
    `query($id: String!) { issue(id: $id) { subscribers { nodes { id name } } } }`,
    { id: issueId },
  );
  const current = data.issue?.subscribers?.nodes ?? [];
  const missing = subscribersToAdd(
    current.map((n) => n.id),
    humans.map((m) => m.id),
  );
  if (!missing.length) return { ok: true, added: 0, who: current.map((n) => n.name) };
  const updated = await graphql(
    `mutation($id: String!, $ids: [String!]) {
      issueUpdate(id: $id, input: { subscriberIds: $ids }) {
        success issue { subscribers { nodes { name } } }
      }
    }`,
    { id: issueId, ids: [...current.map((n) => n.id), ...missing] },
  );
  if (!updated.issueUpdate.success) throw new Error('issueUpdate failed (subscribers)');
  return {
    ok: true,
    added: missing.length,
    who: updated.issueUpdate.issue.subscribers.nodes.map((n) => n.name),
  };
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
          comments(first: 1, orderBy: updatedAt) { nodes { id createdAt updatedAt } }
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
      // Reacting to a comment creates no comment and changes no state, so `c`
      // and `s` cannot see a 👍. It does bump the issue, so the watcher was not
      // blind — it was worse: it reported every reaction as `ticket-edited` and
      // sent the ticket through the prioritisation pass instead of re-reading
      // the answer it had just been given. Measured, by posting one and
      // watching: the reaction also bumps the *comment* (JAU-29, 10:25:11.592 →
      // comment updatedAt 10:25:11.617), and this query already sorts by that
      // field without ever keeping it. Retaining it is what tells the two apart.
      cu: i.comments.nodes[0]?.updatedAt ?? null,
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
    // The question "what is waiting on me" answered as a list rather than as a
    // reading of every comment thread. Empty is the normal state of the board.
    waitingOnHuman: open.filter((t) => t.state === WAITING_STATE).map((t) => t.identifier),
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

// `comments.nodes` comes back newest-first, whatever `orderBy` is asked for, so
// nothing downstream may read it as a chronology: sort by `createdAt` before
// treating the first or the last node as "the recent one".
async function getIssue(identifier) {
  const data = await graphql(
    `query($id: String!) {
      issue(id: $id) {
        ${ISSUE_FIELDS}
        comments(first: 100) {
          nodes {
            id body createdAt
            user { id name }
            reactions { emoji createdAt user { id name } }
          }
        }
      }
    }`,
    { id: identifier },
  );
  if (!data.issue) throw new Error(`issue ${identifier} not found`);
  return data.issue;
}

// `parent` threads the reply under an existing comment instead of starting a new
// root comment. Without it every answer lands at the bottom of the ticket and the
// conversation becomes impossible to follow.
let activityPromise;
async function activity() {
  return activityPromise ||= import('./linear_activity.mjs').then(({ activityService }) =>
    activityService({ stateDir: STATE_DIR, graphql, team: resolveTeam, agent: agentUser }));
}
async function addComment(identifier, body, parent, options) {
  return (await activity()).publish(identifier, body, parent, options);
}

// Explicitly fetch each tracked ticket, including old Done issues outside pulse's
// first page. Complete comment history is required before consuming a decision.
export async function readWaitThread(id, query = graphql) {
  let issue;
  const comments = await connectionPages(async cursor => {
    const data = await query(`query($id: String!, $cursor: String) { issue(id: $id) {
      id identifier relations { nodes { type relatedIssue { identifier } } }
      inverseRelations { nodes { type issue { identifier } } }
      comments(first: 100, after: $cursor) { nodes { id body createdAt parent { id } botActor { id } user { id email } }
        pageInfo { hasNextPage endCursor } }
    } }`, { id, cursor });
    if (!data.issue || data.issue.identifier !== id) throw new Error('wait issue not found');
    issue ||= data.issue;
    return data.issue.comments;
  });
  return { ...issue, comments };
}

// Complete, read-only routing evidence. Do not reuse the bounded show query or
// activity reconciliation here: routing neither writes labels nor consumes replies.
export async function readRoutingThread(id, query = graphql) {
  let issue;
  const comments = await connectionPages(async cursor => {
    const data = await query(`query($id: String!, $cursor: String) { issue(id: $id) {
      identifier state { type }
      comments(first: 100, after: $cursor) { nodes {
        id body createdAt botActor { id } user { id email }
        reactions { emoji createdAt user { id email } }
      } pageInfo { hasNextPage endCursor } }
    } }`, { id, cursor });
    if (data.issue?.identifier !== id) throw new Error('routing issue not found');
    issue ||= data.issue;
    return data.issue.comments;
  });
  return { ...issue, comments };
}

export async function syncWaitDiscussion(w, { service, check = async () => {
  const c = (await listClaims()).find(c => c.issue === w.issue);
  if (!c || ['claimedAt', 'runtime', 'session'].some(k => c[k] !== w[k])) throw new Error('wait owner changed');
  if (!(await loopState()).enabled || (await stopRequested(w.issue)).stop) throw new Error('wait stopped or loop off');
} } = {}) {
  service ||= await activity();
  await check();
  const result = await service.sync(w.issue);
  if (!result.ok) throw new Error(`wait discussion sync failed: ${JSON.stringify(result.errors)}`);
  const record = await service.read(w.issue);
  const source = w.posts.request.id;
  const own = record.subjects.find(s => s.key === `expect:${source}`);
  if (!own) throw new Error('wait expectation subject missing');
  const subjects = [];
  for (const previous of w.history || []) {
    for (const key of [`expect:${previous.request.id}`, `feedback:${previous.supersededBy}`]) {
      const old = record.subjects.find(s => s.key === key);
      if (old) subjects.push({ ...old, state: 'resolved', reason: 'Wait request superseded by explicit feedback', evidence: previous.supersededBy });
    }
  }
  if (w.state === 'resolved') subjects.push({ ...own, state: w.resolution.ticket ? 'transferred' : 'resolved',
    reason: 'External wait outcome verified', evidence: w.resolution.evidence,
    ...(w.resolution.ticket ? { ticket: w.resolution.ticket } : {}) });
  // Only the decision consumed by this wait; unrelated feedback remains open.
  const answer = w.resolution && record.subjects.find(s => s.key === `feedback:${w.resolution.comment}`);
  if (answer) subjects.push({ ...answer, state: 'resolved', reason: 'Wait decision applied', evidence: w.resolution.evidence });
  if (!subjects.length) return;
  await check();
  await service.update(w.issue, { revision: record.revision, subjects });
}

async function externalWaits() {
  return waitStore({ stateDir: STATE_DIR, readThread: readWaitThread, agentId: (await agentUser()).id,
    publish: addComment, persistClaim: writeClaim, syncDiscussion: syncWaitDiscussion,
    verifyMerge: (c, who, pr, cwd) => landingStore({ root: ROOT }).verifyMerged(c.issue, who, pr, cwd),
    queuedClaims: async () => (await listClaims()).filter(c => c.phase === 'queued'),
    promoteQueued: candidates => promoteWaitQueue(candidates, { claims: listClaims,
      enabled: async id => (await loopState()).enabled && !(await stopRequested(id)).stop,
      verdict: id => verdict(id, { peek: true }), independent, ready: readyToImplement }),
  });
}

// A document holds the long form; the ticket comment holds only the digest. The
// app token already carries the scope for this — verified against the API, no
// scope change, so no existing token is revoked.
async function addDocument(identifier, title, content) {
  const issue = await getIssue(identifier);
  const data = await graphql(
    `mutation($input: DocumentCreateInput!) {
      documentCreate(input: $input) {
        success document { id title url }
      }
    }`,
    { input: { title, content, issueId: issue.id } },
  );
  if (!data.documentCreate.success) throw new Error('documentCreate failed');
  return data.documentCreate.document;
}

// Resolve a workflow state by name, case-insensitively. `optional` is what lets
// the loop keep running on a workspace that has not got the waiting column: a
// missing state is reported, never thrown, because parking a ticket decorates a
// claim and must not be able to abort it.
async function findState(stateName, { optional = false } = {}) {
  const team = await resolveTeam();
  const wanted = stateName.toLowerCase();
  const state = team.states.nodes.find((s) => s.name.toLowerCase() === wanted);
  if (!state && !optional) {
    const names = team.states.nodes.map((s) => s.name).join(', ');
    throw new Error(`state "${stateName}" not found. Available: ${names}`);
  }
  return state ?? null;
}

// Takes the issue rather than its identifier: every caller here already holds
// one, and re-fetching it would also lose `issue.state.name` — the state we are
// moving away from, which is exactly what has to be remembered to move back.
async function setState(issue, stateName, opts) {
  const state = await findState(stateName, opts);
  if (!state) return { moved: false, reason: `state "${stateName}" does not exist in this team` };
  const data = await graphql(
    `mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) {
        success issue { identifier state { name } }
      }
    }`,
    { id: issue.id, stateId: state.id },
  );
  if (!data.issueUpdate.success) throw new Error('issueUpdate failed');
  return { moved: true, from: issue.state?.name ?? null, ...data.issueUpdate.issue };
}

async function moveIssue(identifier, stateName) {
  return setState(await getIssue(identifier), stateName);
}

// Creating the waiting column, once. `started`, not `unstarted`, and the choice
// is load-bearing on both sides: `next` only ever picks from unstarted/backlog
// (so a parked ticket can never be re-dispatched while its worker sleeps), and
// `board` reads started (so it stays visible instead of vanishing off the top).
async function ensureWaitingState() {
  const existing = await findState(WAITING_STATE, { optional: true });
  if (existing) {
    return { created: false, note: 'already present', state: existing };
  }
  const team = await resolveTeam();
  const started = team.states.nodes.filter((s) => s.type === 'started').map((s) => s.position);
  let data;
  try {
    data = await graphql(
      `mutation($input: WorkflowStateCreateInput!) {
        workflowStateCreate(input: $input) {
          success workflowState { id name type position }
        }
      }`,
      {
        input: {
          teamId: team.id,
          name: WAITING_STATE,
          type: 'started',
          color: '#F2C94C',
          position: (started.length ? Math.max(...started) : 0) + 1,
          description: 'The agent posted a plan and cannot continue until a human answers it.',
        },
      },
    );
  } catch (error) {
    // Measured, not guessed: the app token carries write scope and Linear still
    // answers "not allowed to take action" — editing a team's workflow is an
    // administrator's act, and the app is not one. There is nothing to retry, so
    // the useful output is the instruction, not the API's wording.
    return {
      created: false,
      reason: error.message,
      todo: `create a "${WAITING_STATE}" state of type "started" on team ${team.key} by hand: Linear → Team settings → Workflow → add state, position it after "In Progress". Everything else works without it; until then parking is skipped.`,
    };
  }
  if (!data.workflowStateCreate.success) throw new Error('workflowStateCreate failed');
  return { created: true, state: data.workflowStateCreate.workflowState };
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
async function createIssue({ title, description, parent, priority, expects }) {
  description = issueDescription(description, expects);
  const team = await resolveTeam();
  const input = { teamId: team.id, title };
  Object.assign(input, await (await activity()).creationInput(description));
  if (priority !== undefined) input.priority = priority;
  if (parent) input.parentId = (await getIssue(parent)).id;
  // Subscribers go in with the issue rather than being added a call later: there
  // is then no window in which the ticket exists and notifies nobody, and no
  // second request that can fail on its own. Looking them up, on the other hand,
  // must not be able to stop a ticket being opened — a board that cannot say who
  // to notify still needs its ticket.
  let humans = [];
  let lookupFailed = null;
  try {
    humans = await boardHumans();
  } catch (error) {
    lookupFailed = error.message;
  }
  if (humans.length) input.subscriberIds = humans.map((m) => m.id);
  const data = await graphql(
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success issue { identifier title url parent { identifier } subscribers { nodes { name } } }
      }
    }`,
    { input },
  );
  if (!data.issueCreate.success) throw new Error('issueCreate failed');
  const { subscribers, ...issue } = data.issueCreate.issue;
  // Who was notified is part of the result, deliberately: a defect about tickets
  // nobody hears of does not get fixed by a correction nobody can see either.
  let notified;
  if (lookupFailed) notified = { ok: false, reason: lookupFailed };
  else if (!humans.length) notified = { ok: false, reason: 'no human member found on the team' };
  else notified = { ok: true, who: subscribers.nodes.map((n) => n.name) };
  let activityResult;
  try { await (await activity()).created(issue.identifier); activityResult = { ok: true }; }
  catch (error) { activityResult = { ok: false, error: error.message, retry: `sync-activity ${issue.identifier}; do not recreate the ticket` }; }
  return { ...issue, notified, activity: activityResult };
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

// A phase outside the list is a typo, and a typo used to be indistinguishable
// from an intent: nothing validated the field and nothing read it back.
export function validatePhase(phase) {
  if (!PHASES.includes(phase)) {
    throw new Error(`unknown phase "${phase}". Use one of: ${PHASES.join(', ')}`);
  }
  return phase;
}

export function claimIdentity(existing, session, runtime) {
  const owner = runtime || existing?.runtime || 'claude';
  if (!['claude', 'codex'].includes(owner)) throw new Error(`unknown runtime "${owner}"`);
  if (existing && owner !== (existing.runtime || 'claude')) {
    throw new Error('claim belongs to another runtime; resume its owner rather than replacing it');
  }
  return { session: session || existing?.session || null, runtime: owner };
}

async function claim(identifier, phase = 'planning', session, runtime) {
  validatePhase(phase);
  const issue = await getIssue(identifier);
  const existing = await listClaims().then((c) => c.find((x) => x.issue === issue.identifier));
  const identity = claimIdentity(existing, session, runtime);
  // Refuse forbidden post-merge transitions before parking or notifying Linear.
  if (existing) await guardWaitTransition(STATE_DIR, { ...existing, ...identity, phase }, existing);

  // Entering `awaiting-approval` is the moment the ticket stops being the
  // agent's business and becomes the human's, and it is the only transition the
  // loop is entitled to write — git owns *In Progress* and *Done*, the loop owns
  // what git cannot see. The claim is already made here on the approval path, so
  // parking rides along with it rather than being one more step to forget.
  //
  // `parkedFrom` is the state to come back to. A re-plan claims
  // `awaiting-approval` a second time while the ticket is already parked: that
  // must not overwrite the remembered state with the waiting column itself.
  let parkedFrom = existing?.parkedFrom ?? null;
  let parking = null;
  let notified = null;
  if (phase === 'awaiting-approval') {
    // Parking and notifying are the same event seen from two sides, but they are
    // not conditional on each other, so this sits outside the state guard below
    // rather than inside it. A workspace whose app cannot create the waiting
    // column (ensureWaitingState is refused — it is an administrator's act) skips
    // the parking and still has to tell somebody that a plan is waiting.
    //
    // It also catches what creation cannot: a ticket a human opened and the
    // harness picked up gets its subscriber here, not at birth (JAU-44).
    try {
      notified = await notifyOwners(issue.id);
    } catch (error) {
      notified = { ok: false, reason: error.message };
    }
    if (issue.state?.name !== WAITING_STATE) {
      const result = await setState(issue, WAITING_STATE, { optional: true });
      parking = result.moved
        ? { parked: true, from: result.from }
        : { parked: false, reason: result.reason };
      if (result.moved) parkedFrom = result.from;
    }
  }

  const record = {
    issue: issue.identifier,
    title: issue.title,
    phase,
    // The exact worker session address; runtime selects the CLI used to resume
    // its context when a comment reaches the worker that owns this ticket.
    // `||`, not `??`: an unset shell variable expands to an empty string, and
    // that must fall back to the address already on file rather than erase it.
    ...identity,
    url: issue.url,
    // Where the ticket was before it was parked, so leaving the waiting column
    // restores the state it actually had instead of asserting a new one.
    parkedFrom,
    claimedAt: existing?.claimedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeClaim(record);
  // Neither belongs in the claim on disk — they describe what this call did, not
  // what the claim is — but both belong in what the caller gets to read.
  const extras = { ...(parking ? { parking } : {}), ...(notified ? { notified } : {}) };
  return Object.keys(extras).length ? { ...record, ...extras } : record;
}

// All phase writers use this boundary, including direct claims and queue promotion.
// Restore remotely before committing the local phase; a failed restore leaves the
// old claim available for retry. Dependencies keep persistence tests off the board.
export async function writeClaim(record, { stateDir = STATE_DIR, readIssue = getIssue,
  moveState = setState, unpark = false, onUnpark = () => {} } = {}) {
  const path = join(stateDir, 'claims', `${record.issue}.json`);
  const previous = await optionalJson(path);
  await guardWaitTransition(stateDir, record, previous);
  if (record.phase === 'landing') await assertLandingAdmission(stateDir, record, previous);
  if (previous && previous.claimedAt !== record.claimedAt) throw new Error('claim cycle changed; retry transition');
  const unchanged = async () => {
    if (JSON.stringify(await optionalJson(path)) !== JSON.stringify(previous)) {
      throw new Error('claim changed during restoration; retry transition');
    }
  };
  if (previous && previous.claimedAt === record.claimedAt &&
      (unpark || (record.phase !== 'awaiting-approval' &&
        (previous.phase === 'awaiting-approval' || previous.parkedFrom)))) {
    const issue = await readIssue(record.issue);
    await unchanged();
    const result = await restoreClaimState(issue, previous, { moveState });
    await unchanged();
    record.parkedFrom = null;
    onUnpark(result);
  }
  Object.assign(record, preserveWorkHistory(record, previous));
  record.telemetryHistory = phaseHistory(record, previous);
  await atomicJson(path, record);
  return record;
}

// No guessed fallback: losing the destination while still waiting requires repair,
// not deletion of the only surviving claim. Already moved issues are left alone.
export async function restoreClaimState(issue, held, { moveState = setState } = {}) {
  if (issue?.identifier !== held.issue || !issue.state?.name) {
    throw new Error('cannot verify current state; preserving claim');
  }
  if (issue.state.name !== WAITING_STATE) return null;
  const target = nextClaimState({ currentState: issue.state.name, parkedFrom: held.parkedFrom });
  if (!target) throw new Error('cannot restore waiting ticket without parkedFrom; preserving claim');
  const result = await moveState(issue, target, { optional: true });
  if (!result.moved) throw new Error(`cannot restore waiting ticket: ${result.reason}; preserving claim`);
  return target;
}

async function release(identifier, reason) {
  const target = identifier ?? (await listClaims())[0]?.issue;
  if (!target) return { released: false, reason: 'no claim held' };
  return closureStore().release(target, reason);
}

// Remember actual work across re-planning and queuing, without replacing the
// runtime/session fields owned by each runtime's claim adapter.
export function preserveWorkHistory(record, previous) {
  const sameCycle = previous?.claimedAt === record.claimedAt;
  const started = record.workStartedAt || (sameCycle && (previous.workStartedAt ||
    (CONTENDING_PHASES.includes(previous.phase) && previous.updatedAt)));
  return {
    ...record,
    workStartedAt: started || (CONTENDING_PHASES.includes(record.phase) ? record.updatedAt : null),
  };
}

async function optionalJson(path) {
  try { return await readJson(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}

const hasText = (value) => typeof value === 'string' && Boolean(value.trim());
const issueKey = (value) => typeof value === 'string' && /^[A-Z][A-Z0-9]*-\d+$/.test(value);

// Drafts can lack evidence. They cannot accidentally erase known leftovers or
// lose the issue ID saved between creation and relation creation.
export function closureInventory(input, previous) {
  if (!input || !Array.isArray(input.items)) throw new Error('closure needs {"items": [...]} (use [] explicitly when none remain)');
  const keys = new Set();
  for (const item of input.items) {
    if (!item || !hasText(item.key) || keys.has(item.key)) throw new Error('closure entries need unique, stable keys');
    keys.add(item.key);
    if (!['pending', 'ticket', 'discarded'].includes(item.disposition)) throw new Error(`${item.key}: disposition must be pending, ticket or discarded`);
    for (const field of ['observation', 'location', 'excludedBecause', 'decision', 'expects', 'reason', 'ticket']) {
      if (item[field] !== undefined && typeof item[field] !== 'string') throw new Error(`${item.key}: ${field} must be text`);
    }
    if (item.ticket !== undefined && !issueKey(item.ticket)) throw new Error(`${item.key}: invalid ticket identifier`);
  }
  for (const old of previous?.items ?? []) {
    const next = input.items.find((item) => item.key === old.key);
    if (!next) throw new Error(`${old.key}: keep the entry and explicitly discard it with a reason`);
    if (old.ticket && next.ticket !== old.ticket) throw new Error(`${old.key}: preserve recorded ticket ${old.ticket}; add a new entry if needed`);
  }
  return { items: input.items };
}

export function closureProblems(inventory, claim) {
  if (!inventory) return ['no closure inventory'];
  if (inventory.issue !== claim.issue || inventory.claimedAt !== claim.claimedAt) return ['closure belongs to another claim cycle'];
  closureInventory(inventory);
  return inventory.items.flatMap((item) => {
    const problems = [];
    if (!hasText(item.observation)) problems.push('observation missing');
    if (!hasText(item.expects)) problems.push('explicit human expectation missing');
    if (item.disposition === 'pending') problems.push('unresolved');
    if (item.disposition === 'discarded') {
      if (!hasText(item.reason)) problems.push('discard reason missing (include missing evidence for an intuition)');
    } else {
      for (const field of ['location', 'excludedBecause', 'decision']) {
        if (!hasText(item[field])) problems.push(`${field} missing`);
      }
      if (item.disposition === 'ticket' && !issueKey(item.ticket)) problems.push('follow-up ticket missing');
      if (item.ticket === claim.issue) problems.push('follow-up cannot be the origin');
    }
    return problems.map((p) => `${item.key}: ${p}`);
  });
}

function relatedTo(issue, target) {
  return (issue.relations?.nodes ?? []).some((r) => r.type === 'related' && r.relatedIssue?.identifier === target) ||
    (issue.inverseRelations?.nodes ?? []).some((r) => r.type === 'related' && r.issue?.identifier === target);
}

// Explicit injection keeps tests away from the real board and canonical state.
// No creation retries live here: workers retain IDs, verify the board after an
// ambiguous create, and finish the relation before requesting release.
export function closureStore({ stateDir = STATE_DIR, readIssue = getIssue, moveState = setState } = {}) {
  const paths = (id) => {
    if (!issueKey(id)) throw new Error('closure/release requires an issue identifier such as JAU-50');
    return {
      claim: join(stateDir, 'claims', `${id}.json`),
      stop: join(stateDir, 'claims', `${id}.stop`),
      inventory: join(stateDir, 'closures', `${id}.json`),
      receipt: join(stateDir, 'closures', `${id}.release.json`),
    };
  };
  return {
    async read(id) {
      const p = paths(id);
      const claim = await optionalJson(p.claim);
      const inventory = await optionalJson(p.inventory);
      return { issue: id, inventory, current: Boolean(claim && inventory?.claimedAt === claim.claimedAt),
        problems: claim ? closureProblems(inventory, claim) : ['no claim held'] };
    },
    async save(id, input) {
      const p = paths(id), claim = await optionalJson(p.claim);
      if (!claim?.claimedAt || claim.issue !== id) throw new Error(`no valid claim held for ${id}`);
      const previous = await optionalJson(p.inventory);
      const data = closureInventory(input, previous?.claimedAt === claim.claimedAt ? previous : null);
      const inventory = { ...data, issue: id, claimedAt: claim.claimedAt, recordedAt: new Date().toISOString() };
      await atomicJson(p.inventory, inventory);
      return { ...inventory, problems: closureProblems(inventory, claim) };
    },
    async release(id, reason, beforeRelease) {
      return withWorkerLock(stateDir, 'WAIT-0', async () => {
        const p = paths(id), claim = await optionalJson(p.claim);
        if (!claim) return { released: false, reason: 'no claim held' };
        if (!claim.claimedAt || claim.issue !== id) throw new Error('invalid claim; refusing release');
        await assertWaitResolved(stateDir, claim);
        await assertLandingReleased(stateDir, id);
        const issue = await readIssue(id);
        if (issue?.identifier !== id || !issue.state?.type) throw new Error('cannot verify origin; preserving claim');
        const inventory = await optionalJson(p.inventory);
        const requiresInventory = issue.state.type === 'completed' || Boolean(claim.workStartedAt) || CONTENDING_PHASES.includes(claim.phase);
        const cleanup = !requiresInventory && hasText(reason);
        if (reason !== undefined && !cleanup) throw new Error('release --reason is only for claims without completed or started work; record a closure instead');
        if (cleanup && inventory?.claimedAt === claim.claimedAt && inventory.items?.length) {
          throw new Error('recorded leftovers require normal closure verification, not unstarted cleanup');
        }
        if (!cleanup) {
          const problems = closureProblems(inventory, claim);
          if (problems.length) throw new Error(`${problems.join('; ')}. Use jaunt-linear closure ${id} --file <json|->; see docs/LINEAR_FOLLOWUPS.md`);
          for (const item of inventory.items.filter((i) => i.disposition === 'ticket')) {
            const target = await readIssue(item.ticket);
            if (target?.identifier !== item.ticket) throw new Error(`${item.key}: follow-up does not exist`);
            if (!relatedTo(issue, item.ticket) && !relatedTo(target, id)) throw new Error(`${item.key}: missing related link to ${item.ticket}; preserve its ID and finish the relation`);
          }
        }
        // Re-check local inputs after remote reads; never delete a replacement
        // claim or release using an inventory edited while verification ran.
        if (JSON.stringify(await optionalJson(p.claim)) !== JSON.stringify(claim) ||
            JSON.stringify(await optionalJson(p.inventory)) !== JSON.stringify(inventory)) throw new Error('claim or closure changed during verification; retry release');
        // Restore before destructive cleanup, after all closure checks. Re-read the
        // board so a human move during verification is not overwritten.
        if (claim.phase === 'awaiting-approval' || claim.parkedFrom || issue.state.name === WAITING_STATE) {
          const current = await readIssue(id);
          if (JSON.stringify(await optionalJson(p.claim)) !== JSON.stringify(claim) ||
              JSON.stringify(await optionalJson(p.inventory)) !== JSON.stringify(inventory)) throw new Error('claim or closure changed during restoration; preserving claim');
          await restoreClaimState(current, claim, { moveState });
          if (JSON.stringify(await optionalJson(p.claim)) !== JSON.stringify(claim) ||
              JSON.stringify(await optionalJson(p.inventory)) !== JSON.stringify(inventory)) throw new Error('claim or closure changed during restoration; preserving claim');
        }
        if (beforeRelease) {
          await beforeRelease();
          if (JSON.stringify(await optionalJson(p.claim)) !== JSON.stringify(claim) || JSON.stringify(await optionalJson(p.inventory)) !== JSON.stringify(inventory)) throw new Error('claim or closure changed during removal; preserving claim');
        }
        const receipt = { issue: id, claimedAt: claim.claimedAt, releasedAt: new Date().toISOString(),
          mode: cleanup ? 'unstarted' : 'closure', ...(cleanup ? { reason } : { inventory }) };
        const archivePath = telemetryArchivePath(stateDir, claim);
        const archived = await optionalJson(archivePath);
        if (archived && (archived.version !== 1 || archived.claimedAt !== claim.claimedAt || archived.issue !== claim.issue)) throw Error('invalid telemetry archive; preserving claim');
        await atomicJson(archivePath, archiveClaim(claim, receipt, issue));
        await atomicJson(p.receipt, receipt);
        await rm(p.stop, { force: true });
        await rm(p.claim);
        return { released: true, was: id, mode: receipt.mode };
      });
    },
  };
}

// Getting a claim out of `queued`. A read that records, like `verdict`: the one
// command anybody runs to ask "can I start writing?" is also the one that makes
// it true, so there is no second step to forget. Idempotent — a claim already
// writing answers yes without touching anything.
//
// Called by the orchestrator after a release (a file just came free) and by a
// worker that finds itself queued.
async function readyToImplement(identifier) {
  const held = (await listClaims()).find((c) => c.issue === identifier);
  if (!held) return { ticket: identifier, ready: false, reason: 'no claim held' };
  if (CONTENDING_PHASES.includes(held.phase)) {
    return { ticket: identifier, ready: true, phase: held.phase, note: 'already writing' };
  }
  if (held.phase !== 'queued') {
    // Nothing to promote: the human has not answered yet, so the wait is theirs
    // and not a file's. Saying "not ready" without saying why is how a worker
    // ends up polling a question nobody will ever answer here.
    return {
      ticket: identifier,
      ready: false,
      phase: held.phase,
      reason: `only a queued claim is promoted here — ${identifier} is ${held.phase}`,
    };
  }
  const decision = await approvalPhase(identifier);
  if (decision.phase !== 'implementing') {
    return { ticket: identifier, ready: false, phase: 'queued', queuedBehind: decision.queuedBehind, why: decision.why };
  }
  await writeClaim({ ...held, phase: 'implementing', updatedAt: new Date().toISOString() });
  return { ticket: identifier, ready: true, phase: 'implementing', promoted: true };
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
// The orchestrator forecasts an unclaimed candidate's scope before dispatch;
// the worker replaces it with verified plan scope before asking for approval.
// Both gates compare these declarations. Refresh forecasts before dispatch:
// records survive claim release and carry no automatic freshness guarantee.

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

// Whether the loop is actually being watched, as opposed to flagged on. The two
// were the same sentence until a watcher died unnoticed for 1 h 40 (JAU-52): the
// flag is a human's intent from days ago, and only the pulse knows whether
// anything acted on it since. `stalled` is the gap between the two, and it is
// the one line worth reading on a board that looks calm.
async function watcherState() {
  const now = Date.now();
  const read = async (path) => {
    try {
      return await readJson(path);
    } catch {
      return null;
    }
  };
  const loop = await loopState();
  const watcher = watcherHealth(await read(WATCH_FILE), { now, pidAlive: livePid });
  const watchdog = watcherHealth(await read(WATCHDOG_FILE), { now, pidAlive: livePid });
  return {
    enabled: loop.enabled === true,
    stalled: loop.enabled === true && !watcher.alive,
    // A missing watchdog is not a stall — nothing is blind yet — but it is the
    // guarantee gone, so it is reported next to the thing it guarantees.
    unguarded: loop.enabled === true && !watchdog.alive,
    watcher,
    watchdog,
    skills: await skillStore(ROOT).status(),
  };
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
//
// So `independent: true` is a claim of PROOF, and the three answers are kept
// apart: `blocked` (a conflict was demonstrated), `unknown` (the evidence to
// decide is missing), `independent` (checked, and nothing opposes it). Folding
// `unknown` into `independent` is what made this gate lie — a caller reading
// an empty `reasons` cannot tell "nothing opposes it" from "I know nothing".

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

// Test 4 — no overlapping change surface. Pure, and exported, so the symmetry
// below is pinned by tests: a surface is evidence, and a missing one is missing
// evidence whichever side it is missing on. Both absences land in `unknowns`,
// never in `reasons` (nothing was demonstrated) and never in silence (which is
// how a missing candidate surface used to read as a clean comparison).
export function surfaceFindings(identifier, against, surfaces) {
  const reasons = [];
  const unknowns = [];
  const mine = surfaces.get(identifier);
  if (!mine && against.length) {
    unknowns.push(
      `${identifier} has declared no change surface — overlap with ${against.join(', ')} cannot be ruled out`,
    );
  }
  for (const other of against) {
    const theirs = surfaces.get(other);
    if (!theirs) {
      unknowns.push(`${other} has declared no change surface — overlap with ${identifier} cannot be ruled out`);
      continue;
    }
    if (!mine) continue;
    const files = mine.files.filter((f) => theirs.files.includes(f));
    const symbols = mine.symbols.filter((s) => theirs.symbols.includes(s));
    if (files.length) reasons.push(`${identifier} and ${other} both change ${files.join(', ')}`);
    if (symbols.length) reasons.push(`${identifier} and ${other} both touch ${symbols.join(', ')}`);
  }
  return { reasons, unknowns };
}

// Narrowing the dispatch gate to the writers opens one hole, and this closes it:
// a claim parked in `awaiting-approval` wakes straight into `implementing`
// without passing the gate again, so two workers could reach the same file.
//
// Dispatch checks the orchestrator's forecast against current writers. Approval
// must check again: the worker may have expanded that forecast during its survey,
// or another writer may have started while the plan awaited a human. The worker
// declares its verified surface before posting the plan, so both sides should
// have evidence by this point; missing evidence still queues rather than guesses.
//
// Which is why an `unknown` at this point is not a normal state but a broken
// protocol (a surface undeclared, or a file that would not read), and queueing on
// it cannot recreate the freeze: it does not happen in nominal operation.
// Asked one writer at a time, so `queuedBehind` names the claims that actually
// hold something rather than everyone who happened to be running. A worker told
// to wait has to know *whose* release to wait for.
export function phaseAfterApproval(identifier, contending, surfaces) {
  const queuedBehind = [];
  const why = [];
  for (const other of contending ?? []) {
    const { reasons, unknowns } = surfaceFindings(identifier, [other], surfaces);
    if (!reasons.length && !unknowns.length) continue;
    queuedBehind.push(other);
    why.push(...reasons, ...unknowns);
  }
  if (!queuedBehind.length) return { phase: 'implementing', queuedBehind: [] };
  return { phase: 'queued', queuedBehind, why };
}

// The same decision, against what is on disk. Used both when the approval lands
// and when a queued claim asks again.
async function approvalPhase(identifier) {
  const others = (await listClaims()).filter((c) => c.issue !== identifier);
  const contending = contendingClaims(others).map((c) => c.issue);
  const surfaces = new Map();
  for (const id of [identifier, ...contending]) {
    const surface = await readSurface(id);
    if (surface) surfaces.set(id, surface);
  }
  return phaseAfterApproval(identifier, contending, surfaces);
}

// The four tests do not ask the same question, and folding them onto one list of
// claims is what froze the board. "Does this ticket depend on the other's
// result?" (tests 2 and 3) is true whether or not the other is running — a
// sleeping blocker still blocks. "Will the two write the same files at once?"
// (test 4) is only meaningful against a claim that is writing *now*. So the
// dependency tests keep running against every claim, and only the surface test
// narrows to the contending ones.
async function independent(identifier) {
  const state = await board();
  const claims = (await listClaims()).filter((c) => c.issue !== identifier);
  const ticket = state.tickets.find((t) => t.identifier === identifier);
  if (!ticket) throw new Error(`${identifier} is not on the open board`);

  const against = claims.map((c) => c.issue);
  const contending = contendingClaims(claims).map((c) => c.issue);
  const reasons = [];
  const unknowns = [];

  // Test 1 — analysed in its current version.
  if (ticket.review.state !== 'reviewed') {
    reasons.push(`${identifier} is ${ticket.review.state}: run the analysis pass before dispatching it`);
  }

  if (against.length > 0) {
    const closure = blockingClosure(state.tickets);
    const mine = closure.get(identifier) ?? new Set();

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
    }
  }

  // Test 4 — no overlapping change surface, against the writers only. With no
  // writer there is nobody to collide with, so the candidate's missing surface
  // asks no question: `surfaceFindings` already answers an empty `against` with
  // no unknowns, and that is the branch a parked claim now takes.
  if (contending.length > 0) {
    const surfaces = new Map();
    for (const id of [identifier, ...contending]) {
      const surface = await readSurface(id);
      if (surface) surfaces.set(id, surface);
    }
    const overlap = surfaceFindings(identifier, contending, surfaces);
    reasons.push(...overlap.reasons);
    unknowns.push(...overlap.unknowns);
  }

  // A demonstrated conflict outranks an unanswered question: `blocked` is final,
  // `unknown` is the caller's cue to go get the missing surface and ask again.
  const gate = reasons.length ? 'blocked' : unknowns.length ? 'unknown' : 'independent';

  return {
    ticket: identifier,
    independent: gate === 'independent',
    gate,
    against: against.length ? against : '(nothing claimed)',
    // What the surface test actually ran on, so a caller can tell "nobody is
    // writing" from "nobody has claimed anything" — two very different boards
    // that used to produce the same answer.
    contending: contending.length ? contending : '(nothing writing)',
    reasons,
    unknowns,
  };
}

// --- approval verdict ------------------------------------------------------
// Reads the thread under the agent's most recent plan comment and decides what
// the human said: approved, declined, feedback to fold in, or nothing yet.

// Where a ticket goes when its human wait ends, whether through a phase
// transition, an answer, or release. Callers decide when restoration is due.
//
// Two guards, both load-bearing. The ticket has to be *currently* parked: a
// human who moved it on to Done or back to Backlog while it waited has made a
// decision, and restoring the old state would silently undo it. And
// `parkedFrom` has to be known: with nothing recorded there is no state to
// restore, and inventing one would put a second authority on a field git owns.
export function nextClaimState({ currentState, parkedFrom }) {
  if (currentState !== WAITING_STATE) return null;
  if (!parkedFrom || parkedFrom === WAITING_STATE) return null;
  return parkedFrom;
}

// The receipt is posted once per plan, not once per read. `verdict` may be run
// again on the same approval — a second wake-up, a human looking — and each run
// must find the acknowledgement it already left. An ack older than the current
// plan belongs to a previous cycle and blocks nothing.
export function ackNeeded(comments, plan, agentId) {
  if (!plan) return false;
  const planAt = new Date(plan.createdAt);
  return !comments.some(
    (c) => c.user?.id === agentId && c.body.startsWith(ACK_MARKER) && new Date(c.createdAt) > planAt,
  );
}

// Registering the answer is a write, and it lives inside a read on purpose.
// The approval path runs exactly one command — this one — so it is the only
// place where "the human answered" can be recorded without depending on a later
// step nobody is forced to take. Asking the skill to remember was the previous
// design, and the skill did not (JAU-18). `--peek` is the way to only look.
export async function registerAnswer(issue, answer, held, plan, comments, agentId, {
  persistClaim = writeClaim, decidePhase = approvalPhase, comment = addComment,
} = {}) {
  const done = {};
  // Old plan approval and new feedback route to the retained owner; neither can
  // restart code that has already merged or erase a delivery obligation.
  if (held.phase === WAIT_PHASE) return { phase: WAIT_PHASE, note: 'reconcile external wait; plan verdict does not authorize its action' };

  // The phase finally says what the session is doing, because something now
  // writes it: approved means the worker codes, feedback means it plans again.
  // Approved does not always mean *now*, though — if another worker is writing a
  // file this one declared, the answer is registered but the code waits. Decided
  // before the receipt is written, because the receipt has to say which it is.
  let queued = null;
  let phase = { approved: 'implementing', feedback: 'planning' }[answer.verdict];
  if (answer.verdict === 'approved') {
    const decision = held.phase === 'landing' ? { phase: 'landing' } : await decidePhase(issue.identifier);
    phase = decision.phase;
    if (decision.phase === 'queued') queued = decision;
  }

  if (answer.verdict === 'approved' && ackNeeded(comments, plan, agentId)) {
    const next = queued
      ? `je démarre dès que ${queued.queuedBehind.join(', ')} aura libéré les fichiers concernés.`
      : `j'enchaîne sur l'implémentation.`;
    const body = `${ACK_MARKER}\n**Approbation reçue** — ${next}\n\n${expectsLine('none')}`;
    done.acknowledged = (await comment(issue.identifier, body, plan.id, { technical: true })).id;
  }

  if (['approved', 'feedback', 'declined'].includes(answer.verdict)) {
    await persistClaim({ ...held, ...(phase ? { phase } : {}), updatedAt: new Date().toISOString() }, {
      unpark: true,
      onUnpark: (target) => { if (target) done.unparked = target; },
    });
    if (phase && held.phase !== phase) done.phase = phase;
  }
  // Repeated reads still report what blocks an approved worker.
  if (queued) done.queuedBehind = queued.queuedBehind;

  return done;
}

async function verdict(identifier, { peek = false } = {}) {
  const issue = await getIssue(identifier);
  const me = await agentUser();
  const isAgent = (c) => c.user?.id === me.id;
  // Normalised once, here: the API hands back the newest comment first, so
  // reading the raw order picked the *oldest* plan of the claim — and with it a
  // 👍 left on a plan that has since been superseded. Everything below may now
  // say "the last one" and mean the most recent.
  const comments = [...issue.comments.nodes].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
  );

  // Only a plan posted during the current claim counts. A plan left on the
  // ticket by an earlier cycle is stale, and treating it as live would let an
  // old approval (or a stray 👍) launch an implementation of something nobody
  // planned this time round.
  const held = (await listClaims()).find((c) => c.issue === issue.identifier);
  const claimedAt = held?.claimedAt ? new Date(held.claimedAt) : null;

  // A plan is a comment that *opens* with the marker, not one that merely
  // contains it somewhere: `plan` always writes the marker as the first bytes
  // of the body, so a marker further down is a citation — an extract pasted in
  // a code fence, a quoted comment — and quoting a plan must not create one.
  // Markdown is no protection here: backticks are just characters to a
  // substring test, which is how a comment explaining the marker became the
  // current plan of a claim.
  const isPlan = (c) => isAgent(c) && c.body.startsWith(PLAN_MARKER);

  const plans = comments.filter(
    (c) => isPlan(c) && (!claimedAt || new Date(c.createdAt) > claimedAt),
  );
  const plan = plans[plans.length - 1];
  if (!plan) {
    const stale = comments.some(isPlan);
    // No plan means no answer to read — but a human may well have reacted
    // anyway, and this used to be the branch where their 👍 vanished without
    // anyone, human or agent, ever being told (JAU-36).
    const unread = unreadReactions(collectReactions(comments, me.id), null);
    return {
      verdict: 'no-plan',
      issue: issue.identifier,
      ...(stale ? { note: 'ticket carries a plan from an earlier claim; ignored as stale' } : {}),
      ...(unread.length ? { unreadReactions: unread } : {}),
    };
  }

  const planAt = new Date(plan.createdAt);
  const answer = readAnswer(issue, plan, planAt, comments, me.id);

  // Only a held claim registers anything: no claim means no worker, so there is
  // no phase to advance and nobody the receipt would be addressed on behalf of.
  if (!peek && held) {
    const registered = await registerAnswer(issue, answer, held, plan, comments, me.id);
    if (Object.keys(registered).length) return { ...answer, registered };
  }
  return answer;
}

// Every reaction on the ticket, flattened and attributed: which comment carries
// it, who left it, when, and whether its emoji means anything to us. Reading
// them all — including the ones no rule can act on — is what lets `verdict`
// *report* an uninterpretable 👍 instead of dropping it, which is the half of
// JAU-36 its title names: "et rien ne le dit".
export function collectReactions(comments, agentId) {
  const found = [];
  for (const c of comments ?? []) {
    for (const r of c.reactions ?? []) {
      const emoji = r.emoji?.replace(/:/g, '');
      found.push({
        emoji,
        comment: c.id,
        by: r.user?.name ?? null,
        // `Reaction.createdAt` is when the human answered; the comment's is when
        // the agent asked. Falling back to the latter keeps the ordering sane on
        // a payload that predates the field being requested.
        at: r.createdAt ?? c.createdAt,
        commentAt: c.createdAt,
        // Attribution, not decoration: the agent reacting to its own comment
        // must never approve the agent's own plan. An absent user is not the
        // agent, which is the safe way round.
        mine: Boolean(agentId) && r.user?.id === agentId,
        onAgentComment: Boolean(agentId) && c.user?.id === agentId,
        means: APPROVE_EMOJI.has(emoji) ? 'approved' : DECLINE_EMOJI.has(emoji) ? 'declined' : null,
      });
    }
  }
  return found;
}

// The reactions that no rule could turn into an answer, with the reason why, so
// the caller can say so out loud. `planAt` is null when the ticket carries no
// live plan at all — then every reaction on an agent comment is unread.
export function unreadReactions(reactions, planAt) {
  return reactions
    .filter((r) => !r.mine && r.onAgentComment)
    .filter((r) => !(planAt && r.means && new Date(r.commentAt) >= planAt))
    .map((r) => ({
      emoji: r.emoji,
      comment: r.comment,
      by: r.by,
      at: r.at,
      why: !r.means
        ? 'emoji outside the approve/decline vocabulary'
        : !planAt
          ? 'no live plan on this ticket'
          : 'comment predates the current plan',
    }));
}

export function readAnswer(issue, plan, planAt, comments, agentId) {
  const isAgent = (c) => c.user?.id === agentId;
  const reactions = collectReactions(comments, agentId);

  // A 👍 counts wherever it lands on the agent's side of the thread, not only on
  // the plan comment (JAU-36). The human reacts to the message they have just
  // read; asking them in words to scroll back up to the plan failed twice,
  // because it asks them to fight the ergonomics of the tool rather than use it.
  // The plan's own comment is included — `>=`, not `>` — so the case that
  // already worked keeps working.
  const answering = reactions.filter(
    (r) => r.means && r.onAgentComment && !r.mine && new Date(r.commentAt) >= planAt,
  );

  const replies = comments.filter((c) => !isAgent(c) && new Date(c.createdAt) > planAt);
  const lastReplyAt = replies.length
    ? new Date(replies[replies.length - 1].createdAt)
    : null;

  // A reaction older than the human's last message no longer speaks for them.
  // Without this, widening the scan above would make a single 👍 permanent —
  // approved once, approved for ever — and every correction written afterwards
  // would be swallowed in silence. Most recent wins among what is left.
  const live = answering
    .filter((r) => !lastReplyAt || new Date(r.at) > lastReplyAt)
    .sort((a, b) => new Date(b.at) - new Date(a.at));

  const unread = unreadReactions(reactions, planAt);
  const withUnread = (answer) => (unread.length ? { ...answer, unreadReactions: unread } : answer);

  if (live.length) {
    return withUnread({
      verdict: live[0].means,
      issue: issue.identifier,
      via: 'reaction',
      // Which comment carried it: the plan is no longer the only answer.
      on: live[0].comment,
      messages: [],
    });
  }

  if (replies.length === 0) {
    return withUnread({ verdict: 'pending', issue: issue.identifier, planCommentId: plan.id });
  }

  // `id` travels with each message so the answer can be threaded under it
  // (`comment --reply <id>`) instead of starting yet another root comment.
  const messages = replies.map((c) => ({
    id: c.id,
    author: c.user?.name ?? 'user',
    body: c.body,
    at: c.createdAt,
  }));
  const commands = replies.map((c) => c.body.trim().toLowerCase());
  if (commands.some((b) => b.startsWith('/approve'))) {
    return withUnread({ verdict: 'approved', issue: issue.identifier, via: 'comment', messages });
  }
  if (commands.some((b) => b.startsWith('/decline'))) {
    return withUnread({ verdict: 'declined', issue: issue.identifier, via: 'comment', messages });
  }
  return withUnread({ verdict: 'feedback', issue: issue.identifier, messages });
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
  'routing-thread': async ([id]) => ({ ...(await readRoutingThread(required(id, 'routing-thread <ISSUE-ID>'))), agentId: (await agentUser()).id }),
  'sync-activity': async ([id]) => (await activity()).sync(id),
  discussion: async ([id], flags) => {
    required(id, 'discussion <ISSUE-ID> [--file <json|->]');
    if (flags.file === undefined) return (await activity()).read(id);
    if (typeof flags.file !== 'string') throw new Error('--file requires a filename or -');
    const patch = JSON.parse(flags.file === '-' ? await readStdin() : await readFile(flags.file, 'utf8'));
    return (await activity()).update(id, patch);
  },
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
  reviewed: async ([id, ...words], flags) => {
    return markReviewed(
      required(id, 'reviewed <ISSUE-ID> <why it sits where it sits> [--group <root-cause>]'),
      words.join(' '),
      flags.group,
    );
  },
  independent: async ([id]) => independent(required(id, 'independent <ISSUE-ID>')),
  claims: async () => listClaims(),
  // Asking also promotes, on the `verdict` model: the command a worker runs to
  // find out whether it may start is the command that lets it start.
  ready: async ([id]) => readyToImplement(required(id, 'ready <ISSUE-ID>')),
  surface: async ([id], flags) => {
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
  comment: async ([id, ...words], flags) => {
    const body = words.join(' ') || (await readStdin());
    const text = required(body.trim(), 'comment body');
    // The marker is appended unless the body already carries one, so an agent
    // that writes it by hand keeps control of the wording.
    const tail = text.includes(EXPECTS_MARKER) || text.includes('**Rien attendu de toi.**')
      ? ''
      : `\n\n${expectsLine(flags.expects)}`;
    return addComment(
      required(id, 'comment <ISSUE-ID> [--expects <text>|none] [--reply <commentId>] <body>'),
      `${text}${tail}`,
      flags.reply,
    );
  },
  move: async ([id, ...state]) =>
    moveIssue(required(id, 'move <ISSUE-ID> <state>'), required(state.join(' '), 'target state')),
  priority: async ([id, p]) =>
    setPriority(required(id, `priority <ISSUE-ID> <${PRIORITY_USAGE}>`), parsePriority(p)),
  relate: async ([from, type, to]) =>
    relate(
      required(from, 'relate <ISSUE-A> <blocks|duplicate|related|similar> <ISSUE-B>'),
      required(type, 'relation type'),
      required(to, 'target issue'),
    ),
  unrelate: async ([id]) => unrelate(required(id, 'unrelate <RELATION-ID> (from show/board)')),
  attachments: async ([id], flags) => {
    return attachments(required(id, 'attachments <ISSUE-ID> [--out <dir>]'), flags.out);
  },
  uncomment: async ([id]) => uncomment(required(id, 'uncomment <COMMENT-ID> (agent-authored only)')),
  create: async (rest, flags) => {
    const title = rest.join(' ') || flags.title;
    const priority = parsePriority(flags.priority, { optional: true });
    const description = flags.desc === '-' ? await readStdin() : flags.desc;
    return createIssue({
      title: required(title, `create <TITLE> --expects <action|none> [--parent <ID>] [--priority <${PRIORITY_USAGE}>] [--desc|--description <text>|-]`),
      description,
      expects: flags.expects,
      parent: flags.parent,
      priority,
    });
  },
  feedback: async ([since]) => humanFeedback(since),
  // Lets callers locate the checkout without hardcoding a path: the script
  // resolves its own root, wherever the repo happens to live.
  repo: async () => ROOT,
  workers: async () => workerReports(STATE_DIR),
  telemetry: async ([id, ...rest]) => {
    if (rest.length) throw Error('telemetry accepts one issue identifier');
    return telemetryReport(STATE_DIR, id);
  },
  wait: async ([action, id, ...rest], flags) => {
    if (rest.length) throw new Error('unexpected wait argument');
    const store = await externalWaits();
    if (action === 'reconcile') return store.reconcile(id);
    required(id, 'wait <begin|read|attempt|resolve|ack> <ID>');
    if (action === 'read') return store.read(id);
    if (action === 'ack') return store.acknowledge(id, flags.event, flags.evidence);
    const who = { runtime: flags.runtime, session: flags.session };
    if (action === 'decision') return store.decision(id, who);
    if (action === 'revise') return store.revise(id, who, { action: flags.action, reason: flags.reason, comment: flags.comment, deadline: flags.deadline });
    if (action === 'begin') return store.begin(id, who, { pr: flags.pr, cwd: flags.cwd || process.cwd(), reason: flags.reason,
      owner: flags.owner, nextAction: flags.action, resource: flags.resource, deadline: flags.deadline });
    if (action === 'attempt') return store.attempt(id, who, { action: flags.action, result: flags.result, evidence: flags.evidence, deadline: flags.deadline });
    if (action === 'resolve') return store.resolve(id, who, { comment: flags.comment, evidence: flags.evidence, ticket: flags.ticket });
    throw new Error('unknown wait action');
  },
  landing: async ([action, id, ...rest], flags) => {
    const store = landingStore({ root: ROOT });
    if (action === 'status' && !id && !rest.length) return store.status();
    if (rest.length) throw new Error('unknown landing argument');
    const who = { runtime: flags.runtime, session: flags.session };
    if (action === 'acquire') {
      const result = await store.acquire(id, who, flags.cwd || process.cwd());
      const held = (await listClaims()).find(c => c.issue === id);
      await writeClaim({ ...held, phase: 'landing', updatedAt: new Date().toISOString() });
      return result;
    }
    if (action === 'prepare') return store.prepare(id, who);
    if (action === 'merge') return store.merge(id, who, flags.pr);
    if (action === 'release') return store.release(id, who, flags.reason);
    throw new Error('landing acquire|status|prepare|merge|release <ID> --runtime <runtime> --session <actual-id>');
  },
  stack: async ([action, id, ...rest], flags) => {
    if (rest.length) throw new Error('unknown stack argument');
    const who = { runtime: flags.runtime, session: flags.session }, store = landingStore({ root: ROOT });
    if (action === 'record') return store.stackRecord(id, who, flags.cwd || process.cwd(), flags.parent, flags.base);
    if (action === 'rebase') return store.stackRebase(id, who, flags.pr);
    throw new Error('stack record|rebase <ID> --runtime <runtime> --session <actual-id>');
  },
  cleanup: async ([id], flags) => {
    required(id, 'cleanup <ID> --pr <number>');
    if (!/^\d+$/.test(flags.pr || '')) throw new Error('cleanup requires --pr <number>');
    return withWorkerLock(STATE_DIR, id, async () => {
      const claim = (await listClaims()).find(c => c.issue === id);
      if (!claim || (await getIssue(id)).state.type !== 'completed') throw new Error('completed claimed ticket required');
      const run = async (cmd, args, cwd) => (await exec(cmd, args, { cwd })).stdout;
      const pr = JSON.parse(await run('gh', ['pr', 'view', flags.pr, '--json', 'state,headRefName,headRefOid,mergeCommit'], ROOT));
      return cleanupWorktree({ root: ROOT, state: STATE_DIR, claim, pr, record: await currentAttempt(STATE_DIR, claim), run,
        remove: cwd => run('git', ['worktree', 'remove', cwd], ROOT),
        release: before => closureStore().release(id, undefined, before) });
    });
  },
  status: async () => ({ landing: await landingStore({ root: ROOT }).status(), workers: await workerReports(STATE_DIR), ...(await lockStatus()), loop: { ...(await loopState()), ...(await watcherState()) } }),
  // Answers "is anything actually watching?" without matching process names: a
  // `pgrep` typed into a shell matches that shell's own command line, so every
  // form of it reports a watcher on a machine where none runs (JAU-52).
  watcher: async () => watcherState(),
  'loop-on': async (_args, flags) => {
    if (flags.runtime || flags.session) await skillStore(ROOT).bind(flags.runtime, flags.session);
    return setLoop(true);
  },
  'skills-bind': async (_args, flags) => {
    if (!(await loopState()).enabled) throw new Error('loop is off; do not register an instruction owner');
    return skillStore(ROOT).bind(flags.runtime, flags.session);
  },
  'skills-read': async (_args, flags) => {
    return skillStore(ROOT).read(flags.runtime, flags.session);
  },
  'skills-ack': async (_args, flags) => {
    return skillStore(ROOT).acknowledge(flags.runtime, flags.session, flags.fingerprint);
  },
  'loop-off': async () => setLoop(false),
  // Flags first, then positionals: `claim <ID> --session <uuid>` used to read
  // `--session` as the phase, and a phase nothing validated accepted it in
  // silence. Now it would be refused, so the parse has to be the right one.
  claim: async (rest, flags) => {
    const [id, phase] = rest;
    // A bare `--session` carries no address: it must fall back to the one on
    // file, exactly like the empty string an unset variable expands to.
    const session = typeof flags.session === 'string' ? flags.session : undefined;
    if (flags.runtime !== undefined && typeof flags.runtime !== 'string') throw new Error('--runtime needs claude or codex');
    return claim(required(id, 'claim <ISSUE-ID> [phase] [--session <uuid>] [--runtime claude|codex]'), phase, session, flags.runtime);
  },
  closure: async ([id], flags) => {
    required(id, 'closure <ID> [--file <json|->]');
    if (flags.file === undefined) return closureStore().read(id);
    if (typeof flags.file !== 'string') throw new Error('--file needs a filename or -');
    const input = flags.file === '-' ? await readStdin() : await readFile(flags.file, 'utf8');
    return closureStore().save(id, JSON.parse(input));
  },
  release: async ([id], flags) => {
    if (flags.reason !== undefined && !hasText(flags.reason)) throw new Error('--reason needs an explicit cleanup reason');
    return release(id, flags.reason);
  },
  // Reading a verdict also records it — the receipt, the phase, leaving the
  // waiting column — because this is the one command the approval path is sure
  // to run. `--peek` is for looking without answering on the worker's behalf.
  verdict: async ([id], flags) => {
    return verdict(required(id, 'verdict <ISSUE-ID> [--peek]'), { peek: Boolean(flags.peek) });
  },
  'ensure-waiting-state': async () => ensureWaitingState(),
  // The long plan goes into a Linear document; the ticket gets a digest that
  // states, in one line, what the human has to do. Reading the full plan is
  // opt-in — a human should be able to answer from the comment alone.
  plan: async ([id, ...words], flags) => {
    const issue = required(
      id,
      'plan <ISSUE-ID> --summary <text> [--expects <text>] [--reply <commentId>] [<body>]',
    );
    const body = words.join(' ') || (await readStdin());
    const summary = required(flags.summary, '--summary <text> (the digest a human reads)');
    // "sur ce commentaire" was an instruction the code no longer needs and the
    // human kept failing anyway: a reaction is now read anywhere on the agent's
    // side of the thread (JAU-36). Asking them to aim taught a rule that was
    // both unnecessary and, twice, not followed.
    const expects =
      flags.expects ?? "approuver ce plan (👍 sur n'importe quel commentaire du fil) ou répondre des corrections";

    const doc = await addDocument(
      issue,
      flags.title ?? `Plan — ${issue}`,
      required(body.trim(), 'plan body') && body,
    );
    // The digest is the comment a human answers to approve, so it is the one
    // that most needs to stay inside the thread it belongs to. Without the
    // parent it lands at the root and the conversation splits in two.
    const comment = await addComment(
      issue,
      `${PLAN_MARKER}\n${summary.trim()}\n\n📄 **Plan détaillé :** ${doc.url}\n\n${expectsLine(expects)}`,
      flags.reply,
    );
    const held = (await listClaims()).find(c => c.issue === issue);
    if (held) await atomicJson(join(lifecyclePaths(STATE_DIR, held).dir, 'publication.json'), { claimedAt: held.claimedAt, document: doc.id, hash: hash(body), publishedAt: new Date().toISOString() });
    return { document: doc, comment };
  },
  'refresh-token': async () => {
    const t = await mintToken();
    return { scopes: t.scope, expiresAt: new Date(t.expires_at).toISOString() };
  },
};

// Declare options even for commands that accept none. Subcommands have their
// own sets: prepare must not silently accept merge's --pr, for example.
export const COMMAND_FLAGS = {
  wait: { read: [], reconcile: [], begin: ['runtime', 'session', 'pr', 'cwd', 'reason', 'owner', 'action', 'resource', 'deadline'],
    decision: ['runtime', 'session'],
    revise: ['runtime', 'session', 'action', 'reason', 'comment', 'deadline'],
    attempt: ['runtime', 'session', 'action', 'result', 'evidence', 'deadline'],
    resolve: ['runtime', 'session', 'comment', 'evidence', 'ticket'], ack: ['event', 'evidence'] },
  'sync-activity': [], discussion: ['file'],
  whoami: [], team: [], next: [], board: [], pulse: [],
  reviewed: ['group'], independent: [], claims: [], ready: [],
  surface: ['files', 'symbols'], stop: [], 'stop-requested': [], list: [], show: [],
  comment: ['expects', 'reply'], move: [], priority: [], relate: [], unrelate: [],
  attachments: ['out'], uncomment: [],
  create: ['title', 'parent', 'priority', 'expects', 'desc', 'description'],
  feedback: [], repo: [], workers: [], telemetry: [], 'routing-thread': [],
  landing: {
    status: [], acquire: ['runtime', 'session', 'cwd'],
    prepare: ['runtime', 'session'], merge: ['runtime', 'session', 'pr'],
    release: ['runtime', 'session', 'reason'],
  },
  stack: {
    record: ['runtime', 'session', 'cwd', 'parent', 'base'],
    rebase: ['runtime', 'session', 'pr'],
  },
  cleanup: ['pr'], status: [], watcher: [],
  'loop-on': ['runtime', 'session'], 'loop-off': [],
  'skills-bind': ['runtime', 'session'], 'skills-read': ['runtime', 'session'],
  'skills-ack': ['runtime', 'session', 'fingerprint'],
  claim: ['session', 'runtime'], closure: ['file'], release: ['reason'],
  verdict: ['peek'], 'ensure-waiting-state': [],
  plan: ['summary', 'expects', 'reply', 'title'], 'refresh-token': [],
};

// Parse once, before invoking a handler (stdin, credentials and writes included).
export function parseCommandArgs(command, args) {
  if (!Object.hasOwn(COMMAND_FLAGS, command)) throw new Error(`unknown command: ${command}`);
  let options = COMMAND_FLAGS[command];
  let label = command;
  if (!Array.isArray(options)) {
    const action = args[0];
    if (!Object.hasOwn(options, action)) {
      throw new Error(`${command} requires one of: ${Object.keys(options).join(', ')}`);
    }
    options = options[action];
    label += ` ${action}`;
  }
  const allowed = new Set(options);
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      if (!allowed.has(name)) {
        throw new Error(`${label}: unknown option ${arg}; accepted options: ${options.map(k => `--${k}`).join(', ') || '(none)'}`);
      }
      const next = args[i + 1];
      // --peek is a switch even before a positional. Preserve the existing
      // bare-value representation, including claim's bare --session fallback.
      const bare = name === 'peek' || next === undefined || next.startsWith('--');
      flags[name] = bare ? true : next;
      if (!bare) i += 1;
    } else {
      rest.push(arg);
    }
  }
  if (command === 'create' && Object.hasOwn(flags, 'description')) {
    if (Object.hasOwn(flags, 'desc')) throw new Error('create: use only one of --desc and --description');
    flags.desc = flags.description;
    delete flags.description;
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

// Resolving may fail on an argv[1] that no longer exists; the raw path is then
// the best answer available and the comparison simply does not match.
export function entryPath(argv1) {
  try {
    return realpathSync(argv1);
  } catch {
    return argv1;
  }
}

// Guarded so a test can import the pure helpers above: without it, importing
// this file runs the CLI, prints a usage line and exits the test runner.
// `argv[1]` is resolved through its symlinks first: the documented entry point
// is `jaunt-linear`, a link in the PATH pointing here, so comparing the link
// itself to `import.meta.url` (which Node already resolves) never matched and
// the CLI exited silently with status 0 — every command answering nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(entryPath(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  const handler = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
  if (!handler) {
    console.error(`usage: linear_agent.mjs <${Object.keys(COMMANDS).join('|')}>`);
    process.exit(2);
  }

  try {
    const { rest, flags } = parseCommandArgs(command, args);
    const result = await handler(rest, flags);
    // Plain strings print raw so they can be used directly in shell substitution.
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exit(1);
  }
}
