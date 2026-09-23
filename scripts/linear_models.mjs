// Claude model/effort policy (JAU-37). The choices live in
// linear_model_policy.json so they can be readjusted without touching code;
// this module only loads, validates and enforces them. No model calls.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const POLICY_PATH = join(dirname(fileURLToPath(import.meta.url)), 'linear_model_policy.json');
// Aliases follow whatever the CLI ships next: never pinned, never in policy.
export const ALIASES = ['opus', 'sonnet', 'haiku', 'fable', 'default', 'best', 'opusplan'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
// `max` stays an explicit operator choice, never an automatic one (JAU-35).
const AUTOMATIC = ['low', 'medium', 'high', 'xhigh'];
const CATEGORIES = ['A', 'B', 'C', 'D'];

// `claude-opus-5[1m]`, `us.anthropic.claude-opus-5-v1:0` and a dated
// `claude-opus-5-20260101` are all Opus 5; `claude-opus-5-5` is not.
export function modelKey(model) {
  return String(model).trim().toLowerCase().replace(/\[[^\]]*\]$/, '')
    .replace(/^(?:[a-z]+\.)?anthropic\./, '').replace(/-v\d+(?::\d+)?$/, '');
}
export function bannedModel(model, policy) {
  if (!model) return null;
  const key = modelKey(model);
  return policy.claude.banned.find(b => key === b || (key.startsWith(`${b}-`) && /^\d{8}$/.test(key.slice(b.length + 1)))) || null;
}
export function assertAllowed(model, policy, source = 'requested') {
  if (bannedModel(model, policy)) throw new Error(`invalid model: ${model} (${source}) is banned by the Jaunt model policy`);
  if (ALIASES.includes(modelKey(model))) throw new Error(`invalid model: alias "${model}" (${source}) is not pinned; use a full model ID`);
  return model;
}
function assertPair(pair, where, policy, effort = true) {
  if (!pair || typeof pair.model !== 'string') throw new Error(`model policy: ${where} needs a model`);
  assertAllowed(pair.model, policy, `policy ${where}`);
  if (effort && !AUTOMATIC.includes(pair.effort)) throw new Error(`model policy: ${where} effort must be one of ${AUTOMATIC.join(', ')}`);
}
export function validatePolicy(policy) {
  const c = policy?.claude;
  if (policy?.version !== 1 || !c) throw new Error('model policy: unsupported version');
  if (!Array.isArray(c.banned) || !c.banned.every(b => typeof b === 'string' && b === modelKey(b))) throw new Error('model policy: banned must list lowercase model IDs or aliases');
  assertPair(c.default, 'default', policy);
  assertPair(c.subagent, 'subagent', policy, false);
  for (const [role, pair] of Object.entries(c.roles || {})) assertPair(pair, `roles.${role}`, policy);
  if (Object.keys(c.categories || {}).sort().join() !== CATEGORIES.join()) throw new Error('model policy: categories must be exactly A, B, C, D');
  for (const k of CATEGORIES) assertPair(c.categories[k], `categories.${k}`, policy);
  if (!c.roles?.classifier) throw new Error('model policy: roles.classifier is required');
  if (c.roles.classifier.maxBudgetUsd !== undefined && !(c.roles.classifier.maxBudgetUsd > 0)) throw new Error('model policy: roles.classifier.maxBudgetUsd must be positive');
  for (const [where, effort] of [['categories.A.longEffort', c.categories.A.longEffort ?? c.categories.A.effort],
    ['escalation.elevated', c.escalation?.elevated], ['escalation.exceptional', c.escalation?.exceptional]])
    if (!AUTOMATIC.includes(effort)) throw new Error(`model policy: ${where} must be one of ${AUTOMATIC.join(', ')}`);
  return policy;
}
let cached;
export function loadPolicy(path = POLICY_PATH) {
  if (path !== POLICY_PATH) return validatePolicy(JSON.parse(readFileSync(path, 'utf8')));
  return cached ||= validatePolicy(JSON.parse(readFileSync(path, 'utf8')));
}

// A missing value takes the policy default: the CLI's own default is an alias
// in the user's settings, and that is exactly what must not decide (JAU-37).
export function claudeSettings(requested, policy = loadPolicy(), source = 'requested') {
  const model = requested?.model || policy.claude.default.model;
  const effort = requested?.effort || policy.claude.default.effort;
  assertAllowed(model, policy, source);
  if (!EFFORTS.includes(effort)) throw new Error(`invalid effort "${effort}" (${source})`);
  return { model, effort };
}
export function claudeEnvironment(env, policy = loadPolicy()) {
  const out = { ...env };
  delete out.ANTHROPIC_MODEL; // --model is always explicit
  for (const [k, v] of Object.entries(out)) {
    if (/^ANTHROPIC_(?:DEFAULT_[A-Z]+_MODEL|SMALL_FAST_MODEL)$/.test(k) && bannedModel(v, policy)) throw new Error(`invalid model: ${k}=${v} is banned by the Jaunt model policy`);
  }
  // Verified on 2.1.280: this decides the Agent tool's subagents.
  out.CLAUDE_CODE_SUBAGENT_MODEL = policy.claude.subagent.model;
  return out;
}
// Subagent messages carry their own model too (parent_tool_use_id).
export function observedBanned(event, policy = loadPolicy()) {
  const models = [event?.type === 'assistant' ? event.message?.model : null,
    ...(event?.type === 'result' ? Object.keys(event.modelUsage || {}) : [])];
  return models.find(m => bannedModel(m, policy)) || null;
}

// The orchestrator is opened by a human, so code cannot choose its model:
// it can only say what the configuration would pick.
export function checkSetup({ policy = loadPolicy(), settings = {}, env = {} } = {}) {
  const findings = [];
  const flag = (level, where, message) => findings.push({ level, where, message });
  if (settings.model) {
    if (bannedModel(settings.model, policy)) flag('error', 'settings.model', `${settings.model} is banned`);
    else if (ALIASES.includes(modelKey(settings.model))) flag('warning', 'settings.model', `alias "${settings.model}" follows new releases; interactive sessions (the orchestrator) use it`);
  }
  for (const k of Object.keys(settings.modelSettings || {})) if (bannedModel(k, policy)) flag('info', `settings.modelSettings.${k}`, 'inert: nothing selects this banned model');
  for (const [k, v] of Object.entries(env)) {
    if (/^(?:ANTHROPIC_MODEL|ANTHROPIC_(?:DEFAULT_[A-Z]+_MODEL|SMALL_FAST_MODEL)|CLAUDE_CODE_SUBAGENT_MODEL|JAUNT_CLAUDE_MODEL)$/.test(k) && bannedModel(v, policy)) flag('error', `env.${k}`, `${v} is banned`);
  }
  return { ok: !findings.some(f => f.level === 'error'), policy: POLICY_PATH, claude: policy.claude, findings };
}
export async function modelsCheck(env = process.env) {
  const path = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json');
  let settings = {};
  try { settings = JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return { settingsPath: path, ...checkSetup({ settings, env: { ...env, ...(settings.env || {}) } }) };
}

// Per-phase routing (JAU-35/37). The classifier reports facts; the pair comes
// from this deterministic rule and the policy, never from the classifier's
// preference. Its own pair (roles.classifier) is not raised by what it finds.
const DIFFICULTIES = ['subtleLogic', 'competingHypotheses', 'hardValidation'];
const FACTS = ['short', 'criticalInvariant', 'openArchitecture', 'crossSystemDiagnosis', ...DIFFICULTIES];
export const CLASSIFIER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['category', ...FACTS, 'xhighJustification', 'missingInformation', 'reasons'],
  properties: {
    category: { type: 'string', enum: CATEGORIES },
    ...Object.fromEntries(FACTS.map(k => [k, { type: 'boolean' }])),
    xhighJustification: { type: 'string' }, missingInformation: { type: 'string' }, reasons: { type: 'string' },
  },
};
export function decide(facts, policy = loadPolicy()) {
  if (!CATEGORIES.includes(facts?.category)) throw new Error('classifier returned no valid category');
  for (const k of FACTS) if (typeof facts[k] !== 'boolean') throw new Error(`classifier fact ${k} is missing`);
  const c = policy.claude, notes = [];
  const difficulties = DIFFICULTIES.filter(k => facts[k]);
  const elevated = facts.criticalInvariant || facts.openArchitecture || facts.crossSystemDiagnosis ||
    facts.hardValidation || (facts.subtleLogic && facts.competingHypotheses);
  let category = facts.category;
  if (facts.criticalInvariant && ['A', 'B'].includes(category)) { category = 'C'; notes.push('critical invariant: C minimum'); }
  if (category === 'A' && (elevated || difficulties.length)) { category = 'B'; notes.push('A excludes every hard-reasoning trigger'); }
  const pair = c.categories[category];
  let effort = category === 'A' && !facts.short ? pair.longEffort ?? pair.effort : pair.effort;
  const raise = (to, why) => { if (AUTOMATIC.indexOf(to) > AUTOMATIC.indexOf(effort)) { effort = to; notes.push(why); } };
  if (elevated) raise(c.escalation.elevated, 'elevated: critical invariant, open architecture, cross-system diagnosis, hard validation, or subtle logic with competing hypotheses');
  if (difficulties.length >= 2 && facts.xhighJustification?.trim()) raise(c.escalation.exceptional, 'exceptional: interdependent difficulties with an explicit justification');
  return { category, model: pair.model, effort, notes };
}
const RULES = `Judge only the difficulties that REMAIN in the phase being routed, not ones already resolved.
Categories, first match in the order D, C, A, B:
- D exceptional: all four at once in the same remaining problem (cross-component invariants, architecture still to choose, several plausible hypotheses/approaches, hard validation), or a qualified failure of two genuinely different approaches at C/high with sufficient context. Unknown cause, missing access or an environment failure is NOT D.
- C complex: any of: invariants kept or changed across components/processes/runtimes/protocols; a real open architecture decision; diagnosis choosing between causes in several subsystems; substantial specialised reasoning with no applicable recipe. Calling two APIs with a known contract is not C.
- A mechanical: ALL of: explicit transformation; known locations and callers; exact recipe or precedent; no behavioural, design or diagnostic decision open; directly verifiable result; limited impact with simple rollback; routine end of phase (tests, delivery). Missing information is never proof of simplicity.
- B ordinary: everything else sufficiently defined.
Facts (true only when established, not merely conceivable):
- short: few manipulations and standard verification. criticalInvariant: the change itself reasons about or modifies a security, authorisation, isolation or data-integrity invariant (not a mention in the title).
- openArchitecture, crossSystemDiagnosis: as in C. subtleLogic: non-obvious interactions, edge cases or state logic. competingHypotheses: several genuinely plausible causes or approaches. hardValidation: rare reproduction, delicate verification, or ordinary tests would likely miss the defect.
- xhighJustification: empty unless a concrete problem needs interdependent reasoning chains AND there is evidence (a comparable local evaluation, or this phase already failed at high for depth with sufficient context). Volume, priority or a request for care never justify it.
- missingInformation: an indispensable business requirement or access that is absent (effort does not compensate it); empty otherwise.
- reasons: at most three short factual sentences, citing files or comments you actually read.
Be proportionate: read only what you need to judge; you are not doing the phase.`;
export function classifierPrompt(phase, context) {
  const what = phase === 'implementation'
    ? 'the IMPLEMENTATION of the approved plan below: the edits, unverified assumptions, tests, integration and delivery still left to the worker'
    : 'the PLANNING phase: understanding the request, diagnosing, examining open choices and producing a verifiable plan';
  return `You route a Jaunt Linear ticket to a worker. Classify ${what}. You may read the repository (current directory) with Read, Grep and Glob.\n\n${RULES}\n\n${context}`;
}
export function classifierArgs(policy = loadPolicy()) {
  const r = policy.claude.roles.classifier;
  return ['-p', '--model', assertAllowed(r.model, policy), '--effort', r.effort, '--output-format', 'json',
    '--no-session-persistence', '--strict-mcp-config', '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read,Grep,Glob',
    '--json-schema', JSON.stringify(CLASSIFIER_SCHEMA), ...(r.maxBudgetUsd ? ['--max-budget-usd', String(r.maxBudgetUsd)] : [])];
}
// A result is evidence of what ran: a banned model in it is refused outright.
export function parseClassifier(stdout, policy = loadPolicy()) {
  let r;
  try { r = JSON.parse(stdout); } catch { return { failed: 'unparseable classifier output' }; }
  const banned = observedBanned({ type: 'result', modelUsage: r.modelUsage }, policy);
  if (banned) throw new Error(`invalid model: ${banned} observed in the classifier is banned by the Jaunt model policy`);
  const classifier = { ...policy.claude.roles.classifier, observedModels: Object.keys(r.modelUsage || {}),
    costUsd: typeof r.total_cost_usd === 'number' ? { value: r.total_cost_usd, kind: 'estimated', source: 'claude result.total_cost_usd' } : null,
    usage: r.usage ? { inputTokens: r.usage.input_tokens, cacheReadInputTokens: r.usage.cache_read_input_tokens,
      cacheCreationInputTokens: r.usage.cache_creation_input_tokens, outputTokens: r.usage.output_tokens } : null,
    durationMs: r.duration_ms ?? null, turns: r.num_turns ?? null };
  if (r.is_error || !r.structured_output) return { classifier, failed: String(r.result || r.subtype || 'no structured output').slice(0, 300) };
  const facts = r.structured_output;
  try { return { classifier, facts, decision: decide(facts, policy), reasons: String(facts.reasons).slice(0, 1000) }; }
  catch (e) { return { classifier, facts, failed: e.message }; }
}
