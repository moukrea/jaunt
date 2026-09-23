// Who moved a ticket. The pulse sees that a ticket changed and nothing about the
// author, so every Linear write by the agent — a comment, a plan, an activity
// label, a relation, a state it parked — woke the model for a pass that found
// nothing new (JAU-15). This reads the author back from Linear, only for tickets
// that moved, and only answers "the agent alone" on positive evidence.
//
// The evidence, all measured on the live API (22/09):
// - issue history attributes the app's writes to `actorId` = the agent's user,
//   labels and relations included; consecutive changes by one actor are merged
//   into one entry whose `updatedAt` moves on, so the window reads `updatedAt`;
// - comments carry `user`, reactions carry `user` and their own `createdAt`.
//
// Anything else — a deleted comment, a withdrawn reaction, a reorder without
// history, an entry nobody signed — is `unexplained`, and wakes as before.
//
// Two measured exceptions (JAU-103, 23/09):
// - Linear's own automations sign as `botActor.type = 'workflow'` with no
//   `actorId`: copying a duplicate's relations onto the canonical ticket, or
//   dropping a "blocked by" once the blocker is done. Such relation-only
//   entries are nobody's decision — whatever triggered them has its own trace —
//   and some never bump the issue's `updatedAt`, so they used to linger into the
//   next window and turn the agent's following write into a wake;
// - the issue's `updatedAt` is stamped a few ms (16–32 measured) before the
//   history entry of the same write, so the entry the previous pulse already
//   saw ends just inside the next window. An entry created before the window
//   and ending less than `STAMP_SKEW_MS` into it is that write, not a new one.

// Newest first whatever orderBy says (see `comments.nodes` in linear_agent).
// A page this full of changes since the window opened may hide older ones.
export const ATTRIBUTION_PAGE = 20;

export const ATTRIBUTION_FIELDS = `
  identifier createdAt creator { id }
  history(first: ${ATTRIBUTION_PAGE}) {
    nodes { createdAt updatedAt actorId botActor { id type } relationChanges { type } toStateId toPriority addedLabelIds removedLabelIds toAssigneeId }
  }
  comments(first: ${ATTRIBUTION_PAGE}, orderBy: updatedAt) {
    nodes { createdAt editedAt user { id } botActor { id } reactions { emoji createdAt user { id } } }
  }`;

// One aliased query for a batch of tickets; `variables` keep identifiers out of
// the query text.
export function attributionQuery(identifiers) {
  const params = identifiers.map((_, i) => `$i${i}: String!`).join(', ');
  const fields = identifiers.map((_, i) => `t${i}: issue(id: $i${i}) { ${ATTRIBUTION_FIELDS} }`).join('\n');
  const variables = Object.fromEntries(identifiers.map((id, i) => [`i${i}`, id]));
  return { query: `query(${params}) {\n${fields}\n}`, variables };
}

const after = (at, since) => Boolean(at) && (since === null || Date.parse(at) > Date.parse(since));

export const STAMP_SKEW_MS = 1000;
const alreadySeen = (h, since) => since !== null && Boolean(h.createdAt) && !after(h.createdAt, since)
  && Date.parse(h.updatedAt) - Date.parse(since) < STAMP_SKEW_MS;

// Relation-only, signed by Linear's workflow bot: anything else it carries — a
// state, a priority, a label, an assignee, or nothing we can read — still counts.
const automatic = h => h.botActor?.type === 'workflow' && !h.actorId && h.relationChanges?.length > 0
  && !h.toStateId && h.toPriority == null && !h.addedLabelIds?.length && !h.removedLabelIds?.length && !h.toAssigneeId;

// `since` is the ticket's previous `updatedAt` as Linear stamped it — a server
// timestamp, so no clock skew between this machine and Linear. `null` means the
// ticket is new to the caller: its creation is part of the change.
//
// `self` is true only when at least one piece of evidence is the agent's and
// none is anybody else's; Linear's automatic relation entries weigh neither
// way. Other authors are returned as found, emoji included, so a caller can
// weigh a reaction without re-reading the thread; `mine` says whether the agent
// wrote at all.
export function selfAuthored(issue, agentId, since) {
  if (!issue) return { self: false, mine: 0, others: [], unexplained: true };
  let mine = 0;
  let automated = 0;
  const others = [];
  const credit = (kind, userId, at, extra = {}) => {
    if (userId && userId === agentId) mine += 1;
    else others.push({ kind, userId: userId ?? null, at, ...extra });
  };

  if (since === null) credit('creation', issue.creator?.id, issue.createdAt);
  const history = issue.history?.nodes ?? [];
  for (const h of history) {
    if (!after(h.updatedAt, since) || alreadySeen(h, since)) continue;
    if (automatic(h)) automated += 1;
    else credit('history', h.actorId, h.updatedAt);
  }
  const comments = issue.comments?.nodes ?? [];
  let commentsMoved = 0;
  for (const c of comments) {
    let moved = false;
    if (after(c.createdAt, since)) { credit('comment', c.user?.id, c.createdAt); moved = true; }
    else if (after(c.editedAt, since)) { credit('comment-edit', c.user?.id, c.editedAt); moved = true; }
    const onAgent = Boolean(agentId) && c.user?.id === agentId;
    for (const r of c.reactions ?? []) {
      if (after(r.createdAt, since)) { credit('reaction', r.user?.id, r.createdAt, { emoji: r.emoji, onAgent }); moved = true; }
    }
    if (moved) commentsMoved += 1;
  }
  // A full page of changes cannot prove there is nothing older behind it.
  const truncated = (since !== null && history.length >= ATTRIBUTION_PAGE && history.every(h => after(h.updatedAt, since)))
    || (since !== null && comments.length >= ATTRIBUTION_PAGE && commentsMoved >= ATTRIBUTION_PAGE);
  const unexplained = mine === 0 && automated === 0 && others.length === 0;
  const self = mine + automated > 0 && others.length === 0 && !truncated;
  return { self, mine, others, unexplained, ...(automated ? { automated } : {}), ...(truncated ? { truncated } : {}) };
}

// The events the agent's own writes produced, removed. Ticket-less events
// (activity errors) and disappearances have no author to read and always pass,
// as does every ticket without a verdict: attribution failing means waking.
const ATTRIBUTABLE = new Set(['ticket-created', 'comment', 'comment-updated', 'state-changed', 'ticket-edited']);

// A reaction decides only as `verdict` reads it: an approval or a refusal, on
// the agent's side of the thread. Anything else — 👀 as "read", or a 👍 on a
// human's message — was already consumed by `sync-activity` and has nothing for
// the model to act on (JAU-89).
const APPROVE = new Set(['+1', 'thumbsup', '👍', 'white_check_mark', 'rocket', 'tada']);
const DECLINE = new Set(['-1', 'thumbsdown', '👎', 'x', 'no_entry']);
export const decisive = r => {
  const emoji = r.emoji?.replace(/:/g, '');
  return r.onAgent === true && (APPROVE.has(emoji) || DECLINE.has(emoji));
};

// Only the events a reaction can produce: on the newest comment it moves `cu`
// (`comment-updated`), on an older one only the issue (`ticket-edited`). When
// the agent wrote in the same window, the other events are its own too: a 👀
// landing on its fresh comment left a `comment` event awake (JAU-103).
const REACTABLE = new Set(['comment-updated', 'ticket-edited']);
const idleReactions = v => Boolean(v) && !v.unexplained && !v.truncated && v.others?.length > 0
  && v.others.every(o => o.kind === 'reaction' && !decisive(o));

export function filterSelf(events, verdicts = {}) {
  const kept = [];
  let suppressed = 0;
  let idle = 0;
  for (const e of events) {
    const verdict = e.ticket ? verdicts[e.ticket] : undefined;
    if (e.ticket && ATTRIBUTABLE.has(e.type) && verdict?.self === true) suppressed += 1;
    else if ((REACTABLE.has(e.type) || (ATTRIBUTABLE.has(e.type) && verdict?.mine > 0)) && idleReactions(verdict)) idle += 1;
    else kept.push(e);
  }
  return { events: kept, suppressed, idle };
}

// Which tickets to ask about, with the window each one opens: the previous
// pulse's `updatedAt`, or `null` for a ticket the previous pulse did not know.
export function attributionWindows(events, previous) {
  const windows = {};
  for (const e of events) {
    if (!e.ticket || !ATTRIBUTABLE.has(e.type)) continue;
    windows[e.ticket] = e.type === 'ticket-created' ? null : previous?.tickets?.[e.ticket]?.u ?? null;
  }
  return windows;
}

// Reads the verdicts through the caller's `graphql`, in small batches so one
// busy board cannot build a query past Linear's complexity limit. A batch that
// fails leaves its tickets without a verdict, which `filterSelf` treats as a
// reason to wake.
export async function attribute(windows, { graphql, agentId, batch = 10 }) {
  const ids = Object.keys(windows);
  const verdicts = {};
  const errors = [];
  for (let i = 0; i < ids.length; i += batch) {
    const chunk = ids.slice(i, i + batch);
    try {
      const { query, variables } = attributionQuery(chunk);
      const data = await graphql(query, variables);
      chunk.forEach((id, j) => { verdicts[id] = selfAuthored(data[`t${j}`], agentId, windows[id]); });
    } catch (error) {
      errors.push({ tickets: chunk, error: error.message });
    }
  }
  return { agentId, verdicts, errors };
}

// The review ledger's side (`board`): each ticket reviewed at a version older
// than its current one, windowed from the pinned version.
export function reviewWindows(issues, ledger) {
  const windows = {};
  for (const i of issues) {
    const seen = ledger.tickets?.[i.identifier];
    if (seen?.issueUpdatedAt && seen.issueUpdatedAt !== i.updatedAt) windows[i.identifier] = seen.issueUpdatedAt;
  }
  return windows;
}

// Moves the pin of every ticket the agent alone changed since its review, and
// returns their identifiers. Everything else stays `changed-since-review`.
export function repinSelf(issues, ledger, verdicts) {
  const moved = [];
  for (const i of issues) {
    if (verdicts[i.identifier]?.self !== true || !ledger.tickets?.[i.identifier]) continue;
    ledger.tickets[i.identifier].issueUpdatedAt = i.updatedAt;
    moved.push(i.identifier);
  }
  return moved;
}
