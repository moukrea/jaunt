// How a human's answer to a plan is read, shared by `verdict` and the discussion
// registry so the two can never disagree about whether a plan was approved.
//
// A closed list, not a judgment call: the worker must not be able to approve its
// own plan by interpreting prose generously. Anything the list does not know is
// a correction, which is what every message used to be (JAU-80).

// Words that turn any message into a correction, whatever else it says. One is
// enough: "ok mais…" is an approval with a condition, and the condition wins.
const CORRECTION = /(?:^| )(?:mais|sauf|par contre|cependant|toutefois|plutot|au lieu|attends?|stop|non|aussi|en plus|a la place|n'oublie)(?= |$)/;

// Openings that say yes to the plan. They must start the message: "approuvé"
// buried in a sentence is as likely to be "pas encore approuvé".
const APPROVAL = /^(?:\/approve|j'ai approuve|j'approuve|approuvee?s?|plan approuvee?|plan validee?|je valide|j'ai valide|validee?|ok pour (?:le plan|moi)|go|vas y|c'est bon|lgtm|feu vert|okay|ok)(?= |$)/;

// Whole messages that cheer the work on without deciding anything. They never
// approve alone, but they do not take back a 👍 either (JAU-92: 👍, then
// "Bah faut corriger !" four seconds later).
const NEUTRAL = new Set([
  'merci', 'merci beaucoup', 'top', 'super', 'parfait', 'nickel', 'genial', 'cool',
  "c'est parti", 'faut corriger', 'il faut corriger', 'faut le corriger',
  'faut le faire', 'il faut le faire',
]);

// Spoken fillers ahead of the real first word: "Bah faut corriger", "Allez go".
const FILLER = /^(?:(?:bah|ben|allez|ah|oh|eh|oui)(?: |$))+/;

const normalise = (body) => String(body ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[’`]/g, "'");

// approve | decline | neutral | correction.
export function readReply(body) {
  const text = normalise(body).trim();
  if (text.startsWith('/decline')) return 'decline';
  const words = text.replace(/[^a-z0-9'/+]+/g, ' ').trim();
  if (text.includes('?') || CORRECTION.test(words)) return 'correction';
  const core = words.replace(FILLER, '').trim();
  if (text.startsWith('/approve') || APPROVAL.test(core)) return 'approve';
  if (!core || NEUTRAL.has(core)) return 'neutral';
  return 'correction';
}

// Discussion acknowledgments do not decide a plan. In particular, making the
// release acknowledgment neutral in readReply would preserve an earlier thumbs
// up instead of letting the latest unknown prose stop that approval (JAU-120).
export function readDiscussionReply(body) {
  const text = normalise(body).trim();
  const words = text.replace(/[^a-z0-9'/+]+/g, ' ').trim();
  const core = words.replace(FILLER, '').trim();
  // A thank-you/approval followed by a request still needs an answer. Unknown
  // prose stays feedback; these bounded forms are not a semantic classifier.
  const request = /(?:^| )(?:peux tu|pourrais tu|pouvez vous|pourriez vous|merci de|explique|ajoute|corrige|modifie|verifie|montre|precise|supprime|renomme|change|garde|conserve|fais|faites)(?= |$)/;
  if (text.includes('?') || CORRECTION.test(words) || request.test(words)) return 'feedback';
  if (/^(?:lu|vu)$/.test(core) || /^voila (?:un|une|la) release publiee$/.test(core)) return 'acknowledgment';
  return readReply(body) === 'correction' ? 'feedback' : 'acknowledgment';
}

// `signals`: `{ at, kind }` for every human answer after the plan — replies read
// by `readReply`, 👍/👎 as approve/decline. The newest decisive one wins; neutral
// messages are looked through. Null when nothing decided anything.
export function decideAnswer(signals) {
  const newestFirst = [...signals].sort((a, b) => new Date(b.at) - new Date(a.at));
  return newestFirst.find((s) => s.kind !== 'neutral') ?? null;
}
