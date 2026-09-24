import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { skillStore } from '../scripts/linear_skills.mjs';
const exec = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'jaunt-skills-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const base of ['.agents', '.claude']) for (const name of ['linear-loop', 'linear-orchestrator']) {
    const dir = join(root, base, 'skills', name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), `${base} ${name} original`);
  }
  const path = join(root, '.agents/skills/linear-orchestrator/SKILL.md');
  return { root, path, store: skillStore(root) };
}
const who = { runtime: 'codex', session: 'actual-fixture-session' };
async function ack(store, session = who.session, runtime = who.runtime) {
  const snapshot = await store.read(runtime, session);
  return store.acknowledge(runtime, session, snapshot.fingerprint);
}
test('receipts isolate runtime/session and binding or reading never acknowledges', async t => {
  const { store } = await fixture(t);
  assert.equal((await store.status()).state, 'unknown');
  await store.bind(who.runtime, who.session);
  await store.read(who.runtime, who.session);
  assert.equal((await store.status()).state, 'unknown');
  assert.equal((await ack(store)).state, 'fresh');
  await store.bind(who.runtime, 'second');
  assert.equal((await store.status()).state, 'unknown');
  assert.equal((await store.status(who)).state, 'fresh');
  assert.equal((await store.status({ runtime: 'claude', session: who.session })).state, 'unknown');
  await assert.rejects(store.bind('codex', ''), /actual/);
});
// JAU-62: re-reading ~8 800 tokens of unchanged instructions on every wake was
// most of a quiet pass. `ifStale` returns them only when they changed.
test('skills-read --if-stale omits unchanged contents and returns changed ones', async t => {
  const { path, store } = await fixture(t);
  assert.equal((await store.read(who.runtime, who.session, { ifStale: true })).files.length, 2, 'never acknowledged: full read');
  await ack(store);
  const fresh = await store.read(who.runtime, who.session, { ifStale: true });
  assert.deepEqual([fresh.state, fresh.unchanged, fresh.files], ['fresh', true, undefined]);
  assert.equal(fresh.paths.length, 2);
  assert.equal((await store.read('claude', who.session, { ifStale: true })).files.length, 2, 'another identity has no receipt');
  await writeFile(path, 'edited');
  const stale = await store.read(who.runtime, who.session, { ifStale: true });
  assert.match(stale.files[1].content, /edited/);
  assert.equal((await store.read(who.runtime, who.session)).files.length, 2, 'the plain read is unchanged');
});
test('content changes, reversions and unrelated/runtime edits use actual contents', async t => {
  const { root, path, store } = await fixture(t);
  const original = await readFile(path, 'utf8');
  await store.bind(who.runtime, who.session); await ack(store);
  await writeFile(join(root, 'unrelated'), 'new commit');
  await writeFile(join(root, '.claude/skills/linear-loop/SKILL.md'), 'other runtime');
  assert.equal((await store.status()).state, 'fresh');
  await writeFile(path, 'edited');
  assert.equal((await store.status()).state, 'stale');
  await writeFile(path, original);
  assert.equal((await store.status()).state, 'fresh');
});
test('outdated acknowledgements and unreadable or malformed state never report fresh', async t => {
  const { root, path, store } = await fixture(t);
  await store.bind(who.runtime, who.session);
  const old = await store.read(who.runtime, who.session);
  await writeFile(path, 'changed between read and ack');
  await assert.rejects(store.acknowledge(who.runtime, who.session, old.fingerprint), /changed/);
  await assert.rejects(store.acknowledge(who.runtime, who.session, 'invented'), /fingerprint/);
  await rm(path);
  assert.equal((await store.status()).state, 'error');
  await mkdir(path); // deterministic unreadable-as-file case, even when root
  assert.equal((await store.status()).state, 'error');
  await writeFile(join(root, '.dev-state/skills/owner.json'), '{');
  assert.equal((await store.status()).state, 'error');
});
test('wake deduplication survives watcher restart while the status remains stale', async t => {
  const { root, path, store } = await fixture(t);
  await store.bind(who.runtime, who.session);
  assert.equal((await store.wake()).wake, 'skills-changed');
  assert.equal(await skillStore(root).wake(), null);
  await ack(store); assert.equal(await store.wake(), null);
  await writeFile(path, 'new');
  assert.equal((await store.wake()).skills.state, 'stale');
  assert.equal(await skillStore(root).wake(), null);
  assert.equal((await store.status()).state, 'stale');
  await ack(store); assert.equal(await store.wake(), null);
  await writeFile(path, 'newer');
  assert.equal((await store.wake()).wake, 'skills-changed');
});
test('real watcher checks local instructions before unavailable API and honors loop-off', async t => {
  const { root, store } = await fixture(t);
  await mkdir(join(root, 'scripts'));
  for (const name of ['linear_watch.mjs', 'linear_workers.mjs', 'linear_telemetry.mjs', 'linear_wakes.mjs', 'linear_attribution.mjs', 'linear_skills.mjs']) {
    await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(root, 'scripts', name));
  }
  await writeFile(join(root, 'scripts/linear_agent.mjs'), "process.stderr.write('offline API'); process.exit(1);");
  await store.bind(who.runtime, who.session);
  const loop = join(root, '.dev-state/linear-loop.json');
  await writeFile(loop, '{"enabled":true}');
  const args = [join(root, 'scripts/linear_watch.mjs'), '--interval', '0.01', '--max-minutes', '0.01'];
  const first = await exec(process.execPath, args);
  assert.equal(JSON.parse(first.stdout).wake, 'skills-changed');
  assert.equal(first.stderr, '');
  // Fresh process does not immediately repeat the same instruction alert.
  await assert.rejects(exec(process.execPath, args), error => {
    assert.equal(JSON.parse(error.stdout).wake, 'watcher-failed');
    assert.match(error.stderr, /offline API/); return true;
  });
  await writeFile(loop, '{"enabled":false}');
  assert.equal(JSON.parse((await exec(process.execPath, args)).stdout).wake, 'loop-off');
});
for (const runtime of ['codex', 'claude']) test(`${runtime}: CLI legacy read/bind/ack works without credentials`, async t => {
  const { root } = await fixture(t);
  await mkdir(join(root, 'scripts'));
  for (const name of ['linear_validation.mjs', 'linear_waits.mjs', 'linear_activity.mjs', 'linear_answers.mjs', 'linear_landing.mjs', 'linear_agent.mjs', 'linear_watch.mjs', 'linear_workers.mjs', 'linear_telemetry.mjs', 'linear_wakes.mjs', 'linear_attribution.mjs', 'linear_skills.mjs']) {
    await copyFile(new URL(`../scripts/${name}`, import.meta.url), join(root, 'scripts', name));
  }
  const run = async (...args) => JSON.parse((await exec(process.execPath, [join(root, 'scripts/linear_agent.mjs'), ...args])).stdout);
  const flags = ['--runtime', runtime, '--session', who.session];
  const snapshot = await run('skills-read', ...flags);
  assert.equal(snapshot.files.length, 2);
  assert.match(snapshot.files[1].content, /original/);
  await assert.rejects(run('skills-bind', ...flags), /loop is off/);
  await run('loop-on'); // legacy enabled loop has no instruction identity
  await run('skills-bind', ...flags);
  assert.equal((await run('watcher')).skills.state, 'unknown');
  assert.equal((await run('skills-ack', ...flags, '--fingerprint', snapshot.fingerprint)).state, 'fresh');
  await run('loop-on', ...flags);
  assert.equal((await run('watcher')).skills.state, 'fresh');
});

 test('a notification lost before delivery retries after five minutes without changing ownership records', async t => {
  const { root } = await fixture(t);
  let time = 1000;
  const store = skillStore(root, { now: () => time });
  const adapter = join(root, '.dev-state/codex');
  await mkdir(adapter, { recursive: true });
  const record = JSON.stringify({ owner: { thread: 'original', pid: 123 }, session: 'worker', phase: 'implementing' });
  for (const name of ['watcher', 'watchdog', 'JAU-47']) await writeFile(join(adapter, name + '.json'), record);
  await store.bind('claude', 'real-claude-fixture');
  assert.equal((await store.wake()).wake, 'skills-changed'); // simulate lost delivery
  time += 299999; assert.equal(await store.wake(), null);
  time++; assert.equal((await store.wake()).wake, 'skills-changed');
  await ack(store, 'real-claude-fixture', 'claude');
  time += 300000; assert.equal(await store.wake(), null);
  for (const name of ['watcher', 'watchdog', 'JAU-47']) assert.equal(await readFile(join(adapter, name + '.json'), 'utf8'), record);
 });
