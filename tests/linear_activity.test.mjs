import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activityService, ACTIVITY_LABELS, ORIGIN_MARKER, connectionPages, discussionStore, observeActivity, updateSubjects } from '../scripts/linear_activity.mjs';
const at = n => new Date(Date.UTC(2026, 8, 22, 1, 0, n)).toISOString();
const me = { id: 'agent', email: 'agent@oauthapp.linear.app' }, user = { id: 'dev', email: 'dev@example.invalid' };
const comment = (id, n, body, author = me, reactions = []) => ({ id, createdAt: at(n), body, user: author, reactions });
const base = () => ({ version: 1, issue: 'JAU-34', revision: 0, since: at(0), subjects: [], technical: [], baseline: [] });
const issue = comments => ({ createdAt: at(0), comments });
const reaction = (emoji, n, author = user) => ({ emoji, createdAt: at(n), user: author });

test('reply acknowledges previous publications, retains questions and newer unread messages', () => {
  const initial = observeActivity(base(), issue([comment('a', 1, '**Attendu de toi :** choisir'), comment('h', 2, 'Et le second point ?', user)]), me.id);
  assert.equal(initial.unread, false); assert.equal(initial.active, true); assert.equal(initial.subjects.length, 2);
  const newer = observeActivity(initial, issue([comment('h', 2, 'Et le second point ?', user), comment('b', 3, 'Une réponse partielle'), comment('a', 1, '**Attendu de toi :** choisir')]), me.id);
  assert.equal(newer.unread, true); assert.equal(newer.subjects.length, 2);
});

test('eyes on old messages, foreign apps and unknown authors cannot clear newer unread', () => {
  for (const author of [null, {id:'other',email:'other@oauthapp.linear.app'}, {id:'no-email'}]) {
    const result = observeActivity(base(), issue([comment('a', 1, 'News'), comment('h', 3, 'lu', author)]), me.id);
    assert.equal(result.unread, true); assert.equal(result.subjects.length, 0);
  }
  const result = observeActivity(base(), issue([comment('a', 1, 'Old', me, [reaction('eyes', 5)]), comment('b', 3, 'New')]), me.id);
  assert.equal(result.unread, true);
  const read = observeActivity(base(), issue([comment('b', 3, 'New', me, [reaction('👀', 5)])]), me.id);
  assert.equal(read.unread, false); assert.equal(read.active, false);
});

test('approval closes only plan decision, not promised work; eyes never approves', () => {
  const p = comment('p', 1, '<!-- jaunt-agent:plan -->\nPlan', me, [reaction('+1', 3)]);
  const result = observeActivity(base(), issue([p]), me.id);
  assert.equal(result.unread, false); assert.equal(result.active, true);
  assert.equal(result.subjects.find(s => s.key === 'plan:p').state, 'resolved');
  assert.equal(result.subjects.find(s => s.key === 'work:p').state, 'open');
  p.reactions = [reaction('eyes', 3)];
  assert.equal(observeActivity(base(), issue([p]), me.id).subjects.find(s => s.key === 'plan:p').state, 'open');
  p.reactions = [reaction('+1', 3)];
  assert.equal(observeActivity(base(), issue([p, comment('h', 4, 'Une correction', user)]), me.id).subjects.find(s => s.key === 'plan:p').state, 'open');
});

test('technical ACK, read acknowledgments, baseline and delayed provenance do not create false activity', () => {
  const record = base(); record.technical.push('tech'); record.baseline.push('old');
  const result = observeActivity(record, issue([comment('old', 1, 'Old question'), comment('tech', 2, 'Technical'), comment('ack', 3, '<!-- jaunt-agent:ack -->\nOK'), comment('h', 4, 'lu', user)]), me.id);
  assert.equal(result.active, false); assert.equal(result.subjects.length, 0);
  const provenance = observeActivity(base(), issue([comment('h', 2, 'lu', user), comment('p', 3, '<!-- jaunt-agent:provenance -->\nAlready in description')]), me.id);
  assert.equal(provenance.unread, false);
});

test('subject patches preserve unmentioned subjects, reject stale revisions and require closure evidence', () => {
  const record = observeActivity(base(), issue([comment('a', 1, 'Question A', user), comment('b', 2, 'Question B', user)]), me.id);
  const a = record.subjects[0];
  const patch = {revision:0,subjects:[{...a,state:'resolved',reason:'Answered',evidence:'answer-comment'}]};
  const updated = updateSubjects(record, patch, [comment('a',1,'A'),comment('b',2,'B')]);
  assert.equal(updated.subjects[1].state,'open');
  assert.throws(()=>updateSubjects(record,{...patch,revision:1},[]),/revision/);
  assert.throws(()=>updateSubjects(record,{revision:0,subjects:[{...a,state:'resolved'}]},[comment('a',1,'A')]),/invalid discussion subject/);
  assert.throws(()=>updateSubjects(record,{revision:0,subjects:[{...a,source:'missing'}]},[]),/preserve subject source/);
});

async function fixture(t, count = 1) {
  const dir = await mkdtemp(join(tmpdir(),'jaunt-activity-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const issues = new Map(), labelList = Object.entries(ACTIVITY_LABELS).map(([id,name])=>({id,name}));
  for(let n=1;n<=count;n++)issues.set(`JAU-${n}`,{id:`id-${n}`,identifier:`JAU-${n}`,title:`Issue ${n}`,description:'Description',createdAt:at(0),updatedAt:at(0),team:{id:'team'},labels:{nodes:[{id:'third-party',name:'Do not touch'}]},comments:[]});
  let tick=10, writes=0, failLabels=false, failRead=false;
  const calls=[];
  const page = (nodes,cursor) => {const start=Number(cursor||0),end=start+100;return {nodes:structuredClone(nodes.slice(start,end)),pageInfo:{hasNextPage:end<nodes.length,endCursor:String(end)}};};
  const graphql = async (q,v={}) => {
    calls.push({q,v:structuredClone(v)});
    if(q.includes('issueLabels('))return {issueLabels:page(labelList,v.cursor)};
    if(q.includes('issueLabelCreate(')){writes++;const l={id:v.input.name,name:v.input.name};labelList.push(l);return {issueLabelCreate:{success:true,issueLabel:l}};}
    if(q.includes('issues(first:'))return {issues:page([...issues.values()],v.cursor)};
    if(q.includes('commentCreate(')){
      writes++;const i=[...issues.values()].find(i=>i.id===v.issueId); const c=comment(`c${tick}`,tick++,v.body);c.parent=v.parentId?{id:v.parentId}:null;i.comments.push(c);return {commentCreate:{success:true,comment:{id:c.id,url:`https://example.invalid/${c.id}`}}};
    }
    if(q.includes('issueAddLabel(')||q.includes('issueRemoveLabel(')){
      if(failLabels)throw new Error('simulated label outage');
      writes++;const i=[...issues.values()].find(i=>i.id===v.id);const add=q.includes('issueAddLabel(');
      i.labels.nodes=i.labels.nodes.filter(l=>l.id!==v.labelId);if(add)i.labels.nodes.push(labelList.find(l=>l.id===v.labelId));
      return {[add?'issueAddLabel':'issueRemoveLabel']:{success:true}};
    }
    if(q.includes('issue(id:')){
      if(failRead)throw new Error('simulated read outage');
      const i=issues.get(v.id);if(!i)return {issue:null};
      return {issue:{...structuredClone(i),comments:page(i.comments,v.cursor),relations:{nodes:i.related?[{type:'related',relatedIssue:{identifier:i.related}}]:[]},inverseRelations:{nodes:[]}}};
    }
    throw new Error(`unhandled mock query ${q}`);
  };
  const service=activityService({stateDir:dir,graphql,team:async()=>({id:'team'}),agent:async()=>me});
  return {dir,issues,labelList,service,calls,get writes(){return writes;},failLabels(v){failLabels=v;},failRead(v){failRead=v;}};
}

test('publish repairs partial label failure without duplicating comment or losing other labels',async t=>{
  const f=await fixture(t); f.failLabels(true);
  const result=await f.service.publish('JAU-1','News');
  assert.equal(result.activity.ok,false);assert.ok(result.id);assert.match(result.activity.retry,/do not republish/);
  assert.equal(f.issues.get('JAU-1').comments.length,1);
  f.failLabels(false);await f.service.sync('JAU-1');
  assert.deepEqual(f.issues.get('JAU-1').labels.nodes.map(l=>l.id).sort(),['active','third-party','unread']);
  const before=f.writes;await f.service.sync('JAU-1');assert.equal(f.writes,before);
  f.issues.get('JAU-1').comments.push(comment('read',20,'lu',user));await f.service.sync('JAU-1');
  assert.deepEqual(f.issues.get('JAU-1').labels.nodes.map(l=>l.id),['third-party']);
});

test('persistent subjects survive claims, partial resolution, unread handover and later questions',async t=>{
  const f=await fixture(t);await f.service.publish('JAU-1','<!-- jaunt-agent:plan -->\nPlan');
  let r=await f.service.read('JAU-1');assert.equal(r.subjects.length,2);
  const close=s=>({...s,state:'resolved',reason:'Verified delivered',evidence:'https://example.invalid/pr/1'});
  await f.service.update('JAU-1',{revision:r.revision,subjects:r.subjects.map(close)});
  r=await f.service.read('JAU-1');assert.equal(r.active,true,'handover still unread');
  f.issues.get('JAU-1').comments.push(comment('read',20,'lu',user));await f.service.sync('JAU-1');
  assert.equal((await discussionStore(f.dir).read('JAU-1')).active,false);
  f.issues.get('JAU-1').comments.push(comment('new',21,'One more question',user));await f.service.sync();
  r=await f.service.read('JAU-1');assert.equal(r.active,true);assert.equal(r.unread,false);assert.equal(r.subjects.at(-1).source,'new');
});

test('creation labels and provenance repair are idempotent and preserve permanent origin',async t=>{
  const f=await fixture(t);f.labelList.length=0;
  const input=await f.service.creationInput('Motif, origine JAU-34');assert.equal(f.labelList.length,3);
  const i=f.issues.get('JAU-1');i.description=input.description;
  await f.service.created('JAU-1');await f.service.sync('JAU-1');
  assert.equal(i.comments.length,1);assert.match(i.comments[0].body,/Motif, origine JAU-34/);
  i.comments.push(comment('read',20,'lu',user));await f.service.sync('JAU-1');
  assert.ok(i.labels.nodes.some(l=>l.name===ACTIVITY_LABELS.origin));
  assert.ok(!i.labels.nodes.some(l=>l.name===ACTIVITY_LABELS.unread));
  assert.ok((await f.service.read('JAU-1')).subjects.some(s=>s.key==='work:creation'));
});

test('complete pagination reaches older comments and archived/unclaimed tracked issues beyond 100',async t=>{
  const f=await fixture(t,105),i=f.issues.get('JAU-105');
  i.labels.nodes.push({id:'active',name:ACTIVITY_LABELS.active});
  // Descending API order; relevant human reply is beyond first page.
  i.comments=Array.from({length:105},(_,n)=>comment(`bot${n}`,300+n,'technical',null));
  i.comments.push(comment('agent',1,'News'),comment('human',200,'lu',user));
  await f.service.sync();const record=await f.service.read('JAU-105');
  assert.equal(record.unread,false);assert.equal(record.active,true,'lost ledger needs explicit reconciliation');
  assert.ok(f.calls.filter(c=>c.q.includes('issues(first:')).length>=2);
  assert.ok(f.calls.some(c=>c.q.includes('comments(first:')&&c.v.cursor==='100'));
  await assert.rejects(connectionPages(async()=>({nodes:[],pageInfo:{hasNextPage:true,endCursor:'same'}})),/did not advance/);
});

test('corrupt ledger and API failure never announce successful closure; busy lock prevents publication',async t=>{
  const f=await fixture(t);await f.service.sync('JAU-1');
  const path=join(f.dir,'discussions/JAU-1.json');await writeFile(path,'{bad');
  assert.equal((await f.service.sync('JAU-1')).ok,false);
  await assert.rejects(f.service.read('JAU-1'));
  await rm(path);await f.service.sync('JAU-1');
  await discussionStore(f.dir).lock('JAU-1',async()=>{
    await assert.rejects(f.service.publish('JAU-1','No duplicate'),/already in progress/);
    assert.equal(f.issues.get('JAU-1').comments.length,0);
  });
  f.failRead(true);assert.match((await f.service.sync('JAU-1')).errors[0].error,/read outage/);
});

test('nested reply resolves root parent once and explicit technical ACK never lights unread',async t=>{
  const f=await fixture(t),i=f.issues.get('JAU-1');
  i.comments.push(comment('root',1,'Root',user),{...comment('child',2,'Plan'),parent:{id:'root'}});
  const result=await f.service.publish('JAU-1','Technical receipt','child',{technical:true});
  assert.equal(f.calls.find(c=>c.q.includes('commentCreate')).v.parentId,'root');
  assert.equal(result.activity.unread,false);
});

test('transfer requires verified related target and keeps destination work durably open',async t=>{
  const f=await fixture(t,2);await f.service.sync('JAU-1');
  let record=await f.service.read('JAU-1');
  const s={key:'topic',source:'issue',title:'Remaining work',owner:'worker',state:'transferred',ticket:'JAU-2',reason:'Distinct scope',evidence:'https://example.invalid/JAU-2'};
  await assert.rejects(f.service.update('JAU-1',{revision:record.revision,subjects:[s]}),/verified related/);
  f.issues.get('JAU-2').related='JAU-1';await f.service.update('JAU-1',{revision:record.revision,subjects:[s]});
  assert.equal((await f.service.read('JAU-2')).subjects[0].state,'open');
  record=await f.service.read('JAU-1');await f.service.update('JAU-1',{revision:record.revision,subjects:[s]});
  assert.equal((await f.service.read('JAU-2')).subjects.length,1);
});

test('replanning can resolve recorded subjects after deleting the superseded source comment', () => {
  const record = observeActivity(base(), issue([comment('old',1,'<!-- jaunt-agent:plan -->\nPlan')]),me.id);
  const subjects=record.subjects.map(s=>({...s,state:'resolved',reason:'Superseded by revised plan',evidence:'new-plan'}));
  assert.ok(updateSubjects(record,{revision:0,subjects},[]).subjects.every(s=>s.state==='resolved'));
  assert.throws(()=>updateSubjects(base(),{revision:0,subjects},[]),/source comment not found/);
});

test('real watcher synchronizes before pulse and reports sync failures without a false quiet pulse',async t=>{
  const {mkdir,copyFile}=await import('node:fs/promises');
  const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
  const exec=promisify(execFile),f=await fixture(t),root=f.dir;
  await mkdir(join(root,'scripts'));await mkdir(join(root,'.dev-state'));
  for(const name of ['linear_watch.mjs','linear_workers.mjs', 'linear_telemetry.mjs', 'linear_wakes.mjs','linear_skills.mjs'])await copyFile(new URL(`../scripts/${name}`,import.meta.url),join(root,'scripts',name));
  await writeFile(join(root,'.dev-state/linear-loop.json'),JSON.stringify({enabled:true}));
  await writeFile(join(root,'.dev-state/linear-pulse.json'),JSON.stringify({tickets:{}}));
  const {skillStore}=await import('../scripts/linear_skills.mjs');
  for(const name of ['linear-loop','linear-orchestrator']){const dir=join(root,'.agents/skills',name);await mkdir(dir,{recursive:true});await writeFile(join(dir,'SKILL.md'),'fixture');}
  const skills=skillStore(root);await skills.bind('codex','fixture-session');const snapshot=await skills.read('codex','fixture-session');await skills.acknowledge('codex','fixture-session',snapshot.fingerprint);
  const mock=join(root,'scripts/linear_agent.mjs');
  await writeFile(mock,`import {appendFile} from 'node:fs/promises';
    await appendFile(new URL('../calls.txt',import.meta.url),process.argv[2]+'\\n');
    console.log(JSON.stringify(process.argv[2]==='sync-activity'?{ok:true}:{at:'now',tickets:{'JAU-1':{u:'1',s:'Backlog',c:'one',cu:'1'}}}));`);
  const args=[join(root,'scripts/linear_watch.mjs'),'--interval','0.01','--max-minutes','1'];
  // Each run stands for one pass: the model takes the batch before re-arming.
  const {wakeStore}=await import('../scripts/linear_wakes.mjs');
  const take=()=>wakeStore(join(root,'.dev-state')).take();
  const result=JSON.parse((await exec(process.execPath,args,{timeout:5000})).stdout);
  assert.equal(result.wake,'board-changed');await take();assert.equal(await readFile(join(root,'calls.txt'),'utf8'),'sync-activity\nwait\npulse\n');
  const partialMock = errors => `import {appendFile} from 'node:fs/promises';
    await appendFile(new URL('../calls.txt',import.meta.url),process.argv[2]+'\\n');
    console.log(JSON.stringify(process.argv[2]==='sync-activity'?{ok:${errors.length===0},errors:${JSON.stringify(errors)}}:{at:'now',tickets:{'JAU-1':{u:'1',s:'Backlog',c:'one',cu:'1'}}}));`;
  const errors=[{issue:'JAU-2',error:'deleted ticket'}];
  await writeFile(mock,partialMock(errors));await writeFile(join(root,'calls.txt'),'');
  const failed=JSON.parse((await exec(process.execPath,args,{timeout:5000})).stdout);
  assert.equal(failed.events[0].type,'activity-failed');await take();
  assert.equal(await readFile(join(root,'calls.txt'),'utf8'),'sync-activity\nwait\npulse\n');
  const quiet=JSON.parse((await exec(process.execPath,[...args.slice(0,-1),'0.002'],{timeout:5000})).stdout);
  assert.equal(quiet.wake,'interval-elapsed');
  await writeFile(mock,partialMock([]));
  const recovered=JSON.parse((await exec(process.execPath,args,{timeout:5000})).stdout);
  assert.equal(recovered.events[0].type,'activity-recovered');await take();
  await writeFile(join(root,'calls.txt'),'');
  await writeFile(mock,`import {appendFile} from 'node:fs/promises'; await appendFile(new URL('../calls.txt',import.meta.url),process.argv[2]+'\\n'); console.error('sync unavailable'); process.exit(1);`);
  await assert.rejects(exec(process.execPath,args,{timeout:5000}),e=>{assert.match(e.stderr,/sync unavailable/);assert.equal(JSON.parse(e.stdout).wake,'watcher-failed');return true;});
  assert.equal(await readFile(join(root,'calls.txt'),'utf8'),'sync-activity\nsync-activity\nsync-activity\n');
});

test('missing ledger recovery is conservative through publish and update, not only sync',async t=>{
  const f=await fixture(t,2);
  for(const i of f.issues.values())i.labels.nodes.push({id:'active',name:ACTIVITY_LABELS.active});
  await f.service.publish('JAU-1','Another message');
  assert.ok((await f.service.read('JAU-1')).subjects.some(s=>s.key==='recovery'));
  await f.service.update('JAU-2',{revision:0,subjects:[{key:'new',title:'New work',source:'issue',owner:'worker',state:'open'}]});
  assert.ok((await f.service.read('JAU-2')).subjects.some(s=>s.key==='recovery'));
});

test('one deleted tracked ticket reports degradation while other conversations synchronize',async t=>{
  const f=await fixture(t,2);await f.service.publish('JAU-1','News');await f.service.publish('JAU-2','Other news');
  f.issues.delete('JAU-1');f.issues.get('JAU-2').comments.push(comment('read',50,'lu',user));
  const result=await f.service.sync();assert.equal(result.ok,false);assert.equal(result.errors[0].issue,'JAU-1');
  assert.equal(result.tickets.find(i=>i.issue==='JAU-2').unread,false);
  assert.ok(await f.service.read('JAU-1'),'never discard inaccessible history');
});

test('first publication does not assume a preexisting human discussion was resolved',async t=>{
  const f=await fixture(t);f.issues.get('JAU-1').comments.push(comment('question',1,'Still pending',user));
  await f.service.publish('JAU-1','I have read your question');
  const r=await f.service.read('JAU-1');assert.ok(r.subjects.some(s=>s.key==='review:baseline'&&s.state==='open'));
});

test('quoted creation marker alone cannot invent provenance or backfill a human ticket',async t=>{
  const f=await fixture(t);const i=f.issues.get('JAU-1');i.description=`A quoted example: ${ORIGIN_MARKER}`;
  await f.service.sync();assert.equal(await f.service.read('JAU-1'),null);assert.equal(i.comments.length,0);
  await f.service.publish('JAU-1','Answer');assert.ok(!i.labels.nodes.some(l=>l.name===ACTIVITY_LABELS.origin));
});
