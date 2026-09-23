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
