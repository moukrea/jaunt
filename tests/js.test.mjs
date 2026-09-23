import test from 'node:test';import assert from 'node:assert/strict';import {createHash,randomBytes} from 'node:crypto';
import {SHA256} from '../web/js/sha256.mjs';
import {ephemeral,channel,utf8,random,unb64} from '../web/js/crypto.mjs';
for(const size of [0,1,55,56,63,64,65,1000,1000000]) test(`SHA256 incremental ${size}`,()=>{
 const bytes=randomBytes(size),hash=new SHA256();for(let i=0;i<size;i+=37)hash.update(bytes.subarray(i,i+37));
 assert.equal(hash.hex(),createHash('sha256').update(bytes).digest('hex'));
});
test('Web Crypto rejects replay and tamper',async()=>{
 const a=await ephemeral(),b=await ephemeral(),secret=unb64(random()),t=utf8('test');
 const c=await channel(a.privateKey,b.publicKey,secret,t),s=await channel(b.privateKey,a.publicKey,secret,t,true);
 const f=await c.seal({unicode:'é 🐢'});assert.deepEqual(await s.open(f),{unicode:'é 🐢'});
 await assert.rejects(()=>s.open(f));const x=await c.seal({x:1});await assert.rejects(()=>s.open({...x,ct:'AAAA'}));
 assert.deepEqual(await s.open(x),{x:1});
});

const {Link}=await import('../web/js/link.mjs');
function inputLink(onSend){
 const link=new Link({},async()=>{});link.channel={async seal(value){return value;}};
 link.ws={readyState:WebSocket.OPEN,bufferedAmount:0,send(raw){onSend(JSON.parse(raw).data);}};
 return link;
}
test('terminal input burst stays within a bounded peer queue and preserves order',async()=>{
 const pending=[],received=[];let overflow=false;
 const link=inputLink(value=>{pending.push(value.index);if(pending.length>64)overflow=true;});
 const drain=setInterval(()=>{if(pending.length)received.push(pending.shift());},5);
 try{
  await Promise.all(Array.from({length:200},(_,index)=>link.send({type:'terminal.input',index})));
  while(pending.length)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(overflow,false,'Burst exhausted the host input queue');
  assert.deepEqual(received,Array.from({length:200},(_,i)=>i));
 }finally{clearInterval(drain);}
});
test('disconnect while terminal input is queued never replays it into a new channel',async()=>{
 const sent=[];const link=inputLink(value=>{sent.push(value.index);if(sent.length===1)setTimeout(()=>{link.generation++;link.channel={async seal(value){return value;}};},0);});
 const results=await Promise.allSettled(Array.from({length:20},(_,index)=>link.send({type:'terminal.input',index})));
 assert.deepEqual(sent,[0]);assert.equal(results.filter(r=>r.status==='rejected').length,19);
});

import {leaves,prune,split,themeMode} from '../web/js/workspace.mjs';
test('split groups retain independent sessions and collapse only removed panes',()=>{
  const tree=split(split({id:'a'},'a','b'),'b','c','y');
  assert.deepEqual(leaves(tree),['a','b','c']);
  assert.deepEqual(leaves(prune(tree,new Set(['a','c']))),['a','c']);
  assert.deepEqual(prune(tree,new Set(['c'])),{id:'c'});
  assert.equal(prune(tree,new Set()),null);
  assert.deepEqual(split(tree,'a','c'),tree);
});
test('theme defaults to dark; system and circadian choices are deterministic',()=>{
  assert.equal(themeMode(undefined,12,true),'dark');
  assert.equal(themeMode('system',12,true),'light');
  assert.equal(themeMode('system',12,false),'dark');
  assert.equal(themeMode('circadian',6,false),'dark');
  assert.equal(themeMode('circadian',7,false),'light');
  assert.equal(themeMode('circadian',19,true),'dark');
});

test('a handshake interrupted during key generation cannot modify its replacement',async()=>{
 const link=new Link({room:'fixture',deviceId:'fixture'},async()=>{});link.enabled=true;
 const sent=[];link.ws={readyState:WebSocket.OPEN,send:raw=>sent.push(raw)};
 const pending=link.handshake();
 link.generation++;link.status('connecting');const replacement={};link.channel=replacement;
 await pending;
 assert.equal(link.channel,replacement);assert.equal(link.state,'connecting');assert.deepEqual(sent,[]);
});
test('a decrypted welcome from an obsolete channel cannot make it online again',async()=>{
 const link=new Link({},async()=>{});link.enabled=true;let release;
 link.channel={open:()=>new Promise(resolve=>{release=resolve;})};
 const pending=link.receive({type:'box'});
 link.generation++;const replacement={};link.channel=replacement;link.status('connecting');
 release({type:'welcome',machine:{name:'obsolete'},sessions:[]});await pending;
 assert.equal(link.channel,replacement);assert.equal(link.state,'connecting');assert.equal(link.machine.name,undefined);
});
test('desktop updater: a launch check with automatic updates off announces the version without downloading; asking to update downloads it',async()=>{
 const {DesktopUpdates}=await import('../desktop/updates.cjs');
 const os=await import('node:os'),fs=await import('node:fs/promises'),path=await import('node:path');
 const cache=await fs.mkdtemp(path.join(os.tmpdir(),'jaunt-desktop-updates-'));
 const fetched=[];const payload=Buffer.from('fake desktop package');
 const digest=createHash('sha256').update(payload).digest('hex');
 const fetch=async url=>{fetched.push(url);const body=url.endsWith('config.json')?JSON.stringify({desktopRelease:'desktop-v9.9.9'}):url.endsWith('SHA256SUMS')?`${digest}  jaunt-desktop-9.9.9-x64.tar.gz\n`:payload;
  return {ok:true,url:'https://example/'+url,headers:new Map([['content-length',String(body.length)]]),body:(async function*(){yield Buffer.from(body);})()};};
 const events=[];const app={isPackaged:true,getVersion:()=>'0.1.0-beta.1',getPath:()=>cache};
 const updates=new DesktopUpdates({app,fetch,emit:e=>events.push(e.state),platform:'linux',arch:'x64',kind:'archive',cache,spawnProcess:()=>({unref(){}})});
 await updates.init();
 const announced=await updates.check(false);
 assert.equal(announced.state,'available');assert.equal(announced.target,'desktop-v9.9.9');
 assert.ok(!fetched.some(u=>u.endsWith('.tar.gz')),'no package downloaded while automatic updates are off');
 const ready=await updates.check(true);
 assert.equal(ready.state,'ready');assert.ok(fetched.some(u=>u.endsWith('.tar.gz')));
 await fs.rm(cache,{recursive:true,force:true});
});

const {surfaceFindings}=await import('../scripts/linear_agent.mjs');
const {parsePriority}=await import('../scripts/linear_agent.mjs');
test('Linear priorities require explicit names and preserve optional omission',()=>{
 for(const [name,value] of [['urgent',1],['high',2],['medium',3],['low',4],['none',0]]){
  assert.equal(parsePriority(name),value);
  assert.equal(parsePriority(name,{optional:true}),value);
 }
 assert.equal(parsePriority(undefined,{optional:true}),undefined);
 const invalid=[undefined,null,true,false,'',' ','Urgent','P0','unknown','toString','__proto__',-1,0,1,2,3,4,5,NaN,'-1','0','1','2','3','4','5','1.5','1e0'];
 for(const value of invalid){
  assert.throws(()=>parsePriority(value),/priority must be one of urgent\|high\|medium\|low\|none/);
  if(value!==undefined) assert.throws(()=>parsePriority(value,{optional:true}),/0 means no priority/);
 }
});
test('Linear CLI rejects invalid priorities before credentials or waiting for stdin',async()=>{
 const {mkdtemp,mkdir,copyFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {execFile}=await import('node:child_process');
 const dir=await mkdtemp(join(tmpdir(),'jaunt-priority-'));
 try{
  await mkdir(join(dir,'scripts'));
  // An isolated CLI has no credentials. No real Linear mutation is possible.
  for(const file of ['linear_waits.mjs','linear_landing.mjs','linear_skills.mjs','linear_agent.mjs','linear_watch.mjs','linear_workers.mjs','linear_telemetry.mjs', 'linear_wakes.mjs', 'linear_attribution.mjs','linear_activity.mjs'])
   await copyFile(new URL(`../scripts/${file}`,import.meta.url),join(dir,'scripts',file));
  const cases=[
   ['priority','JAU-55'],['create','Example','--priority'],
   ['create','Example','--priority','--desc','-'],
  ];
  for(const value of ['0','1','2','3','4','5','1.5','','unknown']){
   cases.push(['priority','JAU-55',value]);
   cases.push(['create','Example','--priority',value,'--desc','-']);
  }
  for(const args of cases){
   // Keep stdin open: validation must finish without waiting for --desc -.
   const result=await new Promise(resolve=>{
    execFile(process.execPath,[join(dir,'scripts','linear_agent.mjs'),...args],
     {timeout:5000},(error,stdout,stderr)=>resolve({error,stdout,stderr}));
   });
   assert.equal(result.error?.code,1,JSON.stringify(args));
   assert.equal(result.stdout,'');
   assert.match(result.stderr,/^error: priority must be one of urgent\|high\|medium\|low\|none;/);
   assert.doesNotMatch(result.stderr,/credentials|client secret|graphql/);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
const surfaceOf=(files,symbols=[])=>({files,symbols});
// The gate may only answer "independent" on proof. A surface missing on EITHER
// side is missing evidence, so it has to surface as `unknown` — the asymmetry
// this pins used to let an undeclared candidate read as "nothing opposes it".
test('a missing change surface is unknown whichever side it is missing on',()=>{
 const theirs=new Map([['JAU-28',surfaceOf(['scripts/linear_agent.mjs'])]]);
 const mineOnly=new Map([['JAU-14',surfaceOf(['scripts/linear_agent.mjs'])]]);
 const candidateBlind=surfaceFindings('JAU-14',['JAU-28'],theirs);
 assert.deepEqual(candidateBlind.reasons,[],'nothing was demonstrated, so nothing may be claimed as a refusal');
 assert.equal(candidateBlind.unknowns.length,1);
 assert.match(candidateBlind.unknowns[0],/^JAU-14 has declared no change surface/);
 const claimBlind=surfaceFindings('JAU-14',['JAU-28'],mineOnly);
 assert.deepEqual(claimBlind.reasons,[]);
 assert.equal(claimBlind.unknowns.length,1);
 assert.match(claimBlind.unknowns[0],/^JAU-28 has declared no change surface/);
 const blind=surfaceFindings('JAU-14',['JAU-28'],new Map());
 assert.equal(blind.unknowns.length,2,'neither absence may be swallowed by the other');
});
test('two declared surfaces are compared, and only a real collision is a refusal',()=>{
 const collide=new Map([
  ['JAU-14',surfaceOf(['scripts/linear_agent.mjs'],['independent'])],
  ['JAU-28',surfaceOf(['scripts/linear_agent.mjs','web/style.css'],['verdict'])],
 ]);
 const hit=surfaceFindings('JAU-14',['JAU-28'],collide);
 assert.deepEqual(hit.unknowns,[]);
 assert.deepEqual(hit.reasons,['JAU-14 and JAU-28 both change scripts/linear_agent.mjs']);
 const apart=new Map([
  ['JAU-14',surfaceOf(['scripts/linear_agent.mjs'],['independent'])],
  ['JAU-28',surfaceOf(['web/style.css'],['.settings-row'])],
 ]);
 const clear=surfaceFindings('JAU-14',['JAU-28'],apart);
 assert.deepEqual(clear.reasons,[]);
 assert.deepEqual(clear.unknowns,[],'both surfaces are declared and disjoint: that is a proof, not an absence');
});
test('nothing claimed leaves the candidate free without a surface',()=>{
 const none=surfaceFindings('JAU-14',[],new Map());
 assert.deepEqual(none.reasons,[]);
 assert.deepEqual(none.unknowns,[],'no claim means nobody to collide with — the first dispatch never deadlocks');
});
const {contendingClaims,CONTENDING_PHASES,phaseAfterApproval}=await import('../scripts/linear_agent.mjs');
// Only a claim that holds the working tree can collide with anything. Comparing
// a candidate against a sleeping one is what made one parked worker freeze the
// whole board for sixteen hours (JAU-46).
test('only the phases that write contend for files',()=>{
 const claims=[
  {issue:'JAU-18',phase:'awaiting-approval'},
  {issue:'JAU-29',phase:'planning'},
  {issue:'JAU-36',phase:'queued'},
  {issue:'JAU-45',phase:'implementing'},
  {issue:'JAU-14',phase:'landing'},
 ];
 assert.deepEqual(contendingClaims(claims).map((c)=>c.issue),['JAU-45','JAU-14']);
 assert.deepEqual(CONTENDING_PHASES,['implementing','landing']);
 // A claim written before the field existed has no phase at all. Unknown is not
 // "writing": it must not resurrect the freeze this test exists to prevent.
 assert.deepEqual(contendingClaims([{issue:'JAU-1'}]),[]);
 assert.deepEqual(contendingClaims(undefined),[],'no claims file is not a busy board');
});
const surfaceMap=(entries)=>new Map(entries.map(([id,files])=>[id,{files,symbols:[]}]));
// The re-check at wake-up is what lets the dispatch gate ignore sleepers safely:
// a parked claim wakes into `implementing` without passing the gate again.
test('an approval only starts writing when no writer holds the same file',()=>{
 const clear=phaseAfterApproval('JAU-46',['JAU-45'],surfaceMap([
  ['JAU-46',['scripts/linear_agent.mjs']],['JAU-45',['web/style.css']],
 ]));
 assert.equal(clear.phase,'implementing');
 assert.deepEqual(clear.queuedBehind,[]);
 const collide=phaseAfterApproval('JAU-46',['JAU-45'],surfaceMap([
  ['JAU-46',['scripts/linear_agent.mjs']],['JAU-45',['scripts/linear_agent.mjs']],
 ]));
 assert.equal(collide.phase,'queued');
 assert.deepEqual(collide.queuedBehind,['JAU-45']);
 // Nobody writing means nothing to wait for — the ordinary case, and the one
 // that must never queue.
 assert.equal(phaseAfterApproval('JAU-46',[],new Map()).phase,'implementing');
 // Waiting is only useful if you know whose release to wait for: naming every
 // writer would send the orchestrator after a ticket that holds nothing.
 const mixed=phaseAfterApproval('JAU-46',['JAU-45','JAU-14'],surfaceMap([
  ['JAU-46',['scripts/linear_agent.mjs']],
  ['JAU-45',['web/style.css']],
  ['JAU-14',['scripts/linear_agent.mjs']],
 ]));
 assert.deepEqual(mixed.queuedBehind,['JAU-14']);
 assert.deepEqual(mixed.why,['JAU-46 and JAU-14 both change scripts/linear_agent.mjs']);
});
test('a dispatch forecast can unblock planning but worker refinement still queues',()=>{
 const candidate='JAU-45', writer='JAU-14';
 const surfaces=surfaceMap([[writer,['scripts/linear_agent.mjs']]]);
 const compare=()=>surfaceFindings(candidate,[writer],surfaces);
 assert.equal(compare().unknowns.length,1,'no candidate evidence means no dispatch proof');
 surfaces.set(candidate,surfaceOf(['web/style.css']));
 assert.deepEqual(compare(),{reasons:[],unknowns:[]},'a surveyed disjoint forecast supplies the missing evidence');
 surfaces.set(candidate,surfaceOf(['scripts/linear_agent.mjs']));
 assert.deepEqual(compare(),{reasons:[`${candidate} and ${writer} both change scripts/linear_agent.mjs`],unknowns:[]},'an overlapping forecast cannot clear the gate');
 surfaces.set(candidate,surfaceOf(['web/style.css']));
 surfaces.delete(writer);
 assert.equal(compare().unknowns.length,1,'a forecast cannot substitute for missing writer evidence');
 surfaces.set(writer,surfaceOf(['scripts/linear_agent.mjs']));
 assert.equal(phaseAfterApproval(candidate,[writer],surfaces).phase,'implementing');
 // The worker discovers an additional shared file and replaces the forecast.
 surfaces.set(candidate,surfaceOf(['web/style.css','scripts/linear_agent.mjs']));
 const approval=phaseAfterApproval(candidate,[writer],surfaces);
 assert.equal(approval.phase,'queued');
 assert.deepEqual(approval.queuedBehind,[writer]);
 assert.deepEqual(approval.why,[`${candidate} and ${writer} both change scripts/linear_agent.mjs`]);
 assert.equal(phaseAfterApproval(candidate,[],surfaces).phase,'implementing','release allows the approved scope to proceed');
});
test('a surface missing at wake-up queues instead of guessing',()=>{
 // Both sides always have a surface here — declaring one precedes the plan being
 // approved. So an absence is a broken protocol, not a normal state, and
 // `unknown` may not read as a green light the way it never does at the gate.
 const mineOnly=phaseAfterApproval('JAU-46',['JAU-45'],surfaceMap([['JAU-46',['scripts/linear_agent.mjs']]]));
 assert.equal(mineOnly.phase,'queued');
 const theirsOnly=phaseAfterApproval('JAU-46',['JAU-45'],surfaceMap([['JAU-45',['scripts/linear_agent.mjs']]]));
 assert.equal(theirsOnly.phase,'queued');
 assert.ok(theirsOnly.why.length,'queueing without saying what on is how a worker waits forever');
});
const {nextClaimState,ackNeeded,validatePhase,PHASES,WAITING_STATE}=await import('../scripts/linear_agent.mjs');
// The waiting column means "unanswered", so every real answer leaves it — but
// only from the column itself, and only towards a state that was recorded.
test('a parked ticket leaves the waiting column for the state it was parked from',()=>{
 for(const verdict of ['approved','declined','feedback'])
  assert.equal(nextClaimState({verdict,currentState:WAITING_STATE,parkedFrom:'In Progress'}),'In Progress',`${verdict} is an answer`);

});
test('a ticket a human moved on is never dragged back',()=>{
 // Moving it out of the column while it waited IS the answer. Restoring the
 // remembered state here would silently undo a human's decision.
 assert.equal(nextClaimState({verdict:'approved',currentState:'Done',parkedFrom:'In Progress'}),null);
 assert.equal(nextClaimState({verdict:'approved',currentState:'Backlog',parkedFrom:'In Progress'}),null);
 // Nothing recorded means no state to restore. Guessing one would put a second
 // authority on a field git already owns.
 assert.equal(nextClaimState({verdict:'approved',currentState:WAITING_STATE,parkedFrom:null}),null);
 assert.equal(nextClaimState({verdict:'approved',currentState:WAITING_STATE,parkedFrom:WAITING_STATE}),null,'the column is never its own destination');
});
test('the approval receipt is posted once per plan, not once per read',()=>{
 const me='agent-id',ack='<!-- jaunt-agent:ack -->';
 const plan={id:'p2',createdAt:'2026-09-19T12:00:00.000Z'};
 const before={user:{id:me},body:`${ack}\nreçue`,createdAt:'2026-09-19T11:00:00.000Z'};
 const after={user:{id:me},body:`${ack}\nreçue`,createdAt:'2026-09-19T12:01:00.000Z'};
 assert.equal(ackNeeded([],plan,me),true,'nothing posted yet');
 assert.equal(ackNeeded([after],plan,me),false,'a second verdict read must find the receipt it already left');
 // A receipt from the previous cycle answers the previous plan. Re-planning
 // and being approved again has to produce a new one.
 assert.equal(ackNeeded([before],plan,me),true);
 assert.equal(ackNeeded([{...after,user:{id:'human'}}],plan,me),true,'only the agent writes its own receipts');
 assert.equal(ackNeeded([{...after,body:`quote: ${ack}`}],plan,me),true,'a quoted marker is a citation, not a receipt');
 assert.equal(ackNeeded([after],undefined,me),false,'no plan, nothing to acknowledge');
});
test('a claim phase outside the vocabulary is refused',()=>{
 for(const phase of PHASES) assert.equal(validatePhase(phase),phase);
 // `implementing` was a value no code and no skill ever wrote: a field nothing
 // validates is a field that drifts in silence.
 assert.ok(PHASES.includes('implementing'));
 // `queued` says what none of the other four could: approved, and not writing
 // yet. Keeping `awaiting-approval` there would claim the human still owes an
 // answer they have already given (JAU-18).
 assert.ok(PHASES.includes('queued'));
 assert.throws(()=>validatePhase('implementng'),/unknown phase "implementng".*planning, awaiting-approval/s);
 assert.throws(()=>validatePhase(undefined),/unknown phase/);
});
const {entryPath}=await import('../scripts/linear_agent.mjs');
test('the CLI entry point is recognised through a symlink',async()=>{
 const {mkdtemp,symlink,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');const {pathToFileURL,fileURLToPath}=await import('node:url');
 const real=new URL('../scripts/linear_agent.mjs',import.meta.url);
 const dir=await mkdtemp(join(tmpdir(),'jaunt-entry-'));const link=join(dir,'jaunt-linear');
 try{
  await symlink(fileURLToPath(real),link);
  // `jaunt-linear` in the PATH is a symlink to this file. Comparing argv[1] raw
  // made the guard false, so every command exited 0 printing nothing.
  assert.equal(pathToFileURL(entryPath(link)).href,real.href,'a symlinked argv[1] must resolve to the module itself');
 }finally{await rm(dir,{recursive:true,force:true});}
 assert.equal(entryPath('/nope/does/not/exist'),'/nope/does/not/exist','an unresolvable path is returned untouched');
});
const {readAnswer,collectReactions,unreadReactions}=await import('../scripts/linear_agent.mjs');
// A 👍 used to be read on the plan comment and nowhere else, so the natural
// gesture — reacting to the message you just read — went to nobody (JAU-36).
const ME='agent-id',HUMAN='human-id';
const T=(h,m=0)=>`2026-09-19T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00.000Z`;
const agent=(id,at,reactions=[])=>({id,createdAt:at,user:{id:ME},body:'…',reactions});
const human=(id,at,body='des remarques',reactions=[])=>({id,createdAt:at,user:{id:HUMAN,name:'Emeric'},body,reactions});
const thumb=(at,by=HUMAN)=>({emoji:'+1',createdAt:at,user:{id:by,name:'Emeric'}});
const issue={identifier:'JAU-36'};
const read=(comments,plan)=>readAnswer(issue,plan,new Date(plan.createdAt),comments,ME);
test('a 👍 on any agent comment from the plan onwards approves the plan',()=>{
 const plan=agent('plan',T(1));
 // The plan comment itself: the one case that already worked, and must keep working.
 assert.equal(read([{...plan,reactions:[thumb(T(2))]}],plan).verdict,'approved');
 // JAU-29 replayed: the 👍 landed on the worker's *answer*, hours after the plan.
 // `verdict` kept saying feedback and the implementation would never have started.
 const answer=agent('answer',T(6),[thumb(T(10))]);
 const jau29=read([plan,answer],plan);
 assert.equal(jau29.verdict,'approved','a 👍 on a later agent comment is an approval of the live plan');
 assert.equal(jau29.on,'answer','the answer names which comment carried it — the plan is no longer the only one');
 assert.equal(jau29.via,'reaction');
});
test('a 👍 nobody could have meant as an answer never approves anything',()=>{
 const plan=agent('plan',T(5));
 // Before the plan: approving something the current plan had not yet said.
 const earlier=agent('analysis',T(1),[thumb(T(2))]);
 const stale=read([earlier,plan],plan);
 assert.equal(stale.verdict,'pending','a reaction on a comment older than the plan is not an answer to it');
 assert.deepEqual(stale.unreadReactions.map(r=>r.why),['comment predates the current plan'],'and it is reported, not dropped');
 // On the human's own comment: they are not answering the agent, they are agreeing with themselves.
 assert.equal(read([plan,human('h',T(6),'note',[thumb(T(7))])],plan).verdict,'feedback');
 // The agent reacting to the agent is the loop approving its own plan.
 assert.equal(read([{...plan,reactions:[thumb(T(2),ME)]}],plan).verdict,'pending','an agent cannot approve itself');
 // An emoji outside the vocabulary decides nothing — but is now said out loud.
 const odd=read([{...plan,reactions:[{emoji:'eyes',createdAt:T(2),user:{id:HUMAN}}]}],plan);
 assert.equal(odd.verdict,'pending');
 assert.deepEqual(odd.unreadReactions.map(r=>r.why),['emoji outside the approve/decline vocabulary']);
});
test('a reaction does not outlive the message that came after it',()=>{
 const plan=agent('plan',T(1));
 const reacted=agent('answer',T(6),[thumb(T(10))]);
 // Widening the scan makes a single 👍 permanent unless dates are compared:
 // approved once, approved for ever, every later correction swallowed in silence.
 assert.equal(read([plan,reacted,human('h',T(11),'non, pas comme ça')],plan).verdict,'feedback','the human spoke after reacting; the words win');
 // The other way round, the reaction is the newer word and still decides.
 assert.equal(read([plan,human('h',T(8)),agent('a2',T(9),[thumb(T(12))])],plan).verdict,'approved');
 // 👎 travels the same path as 👍 — one rule, not two.
 const no=agent('a3',T(6),[{emoji:'-1',createdAt:T(7),user:{id:HUMAN}}]);
 assert.equal(read([plan,no],plan).verdict,'declined');
});
const {pickOwners,subscribersToAdd}=await import('../scripts/linear_agent.mjs');
// Linear notifies subscribers and nobody else, so a ticket the harness opened
// with an empty subscriber list announced itself to no one — including the ones
// parked waiting for an approval (JAU-44).
const AGENT='513aa856',member=(o)=>({id:o.id,name:o.name??o.id,displayName:o.dn??o.id,email:o.email??`${o.id}@example.com`,active:o.active??true,guest:o.guest??false});
const HER=member({id:'her',name:'Emeric Commenge (moukrea)',dn:'moukrea',email:'moukrea@gmail.com'});
const BOT=member({id:AGENT,name:'jaunt Agent',dn:'jauntagent',email:'805df664@oauthapp.linear.app'});
const ids=(list)=>list.map(m=>m.id);
test('with nobody configured, the humans of the team are the humans of the team',()=>{
 // Measured on this workspace: the app actor is not a team member, so members
 // are already exactly the humans and a fresh clone needs no setup step.
 assert.deepEqual(ids(pickOwners([HER],undefined,AGENT)),['her']);
 // Belt and braces for the day the app *is* added to the team: by id, and by the
 // @oauthapp address it is issued, because the loop must never notify itself.
 assert.deepEqual(ids(pickOwners([HER,BOT],undefined,AGENT)),['her'],'by id');
 assert.deepEqual(ids(pickOwners([HER,BOT],undefined,null)),['her'],'by address, even with no id to compare');
 // Both would be told about work they cannot act on.
 assert.deepEqual(ids(pickOwners([HER,member({id:'gone',active:false}),member({id:'guest',guest:true})],undefined,AGENT)),['her']);
 assert.deepEqual(pickOwners([],undefined,AGENT),[],'an empty team names nobody, and must not invent one');
 assert.deepEqual(pickOwners(undefined,undefined,AGENT),[],'no members read is not a crash');
});
test('a configured owner is matched however the human happens to write it',()=>{
 for(const w of ['her','moukrea@gmail.com','moukrea','Emeric Commenge (moukrea)','MOUKREA@GMAIL.COM',' moukrea '])
  assert.deepEqual(ids(pickOwners([HER],w,AGENT)),['her'],`"${w}" names her`);
 const them=member({id:'them',dn:'colleague'});
 assert.deepEqual(ids(pickOwners([HER,them],['moukrea','colleague'],AGENT)),['her','them'],'a list subscribes each of them');
 // A team of several is the whole reason the key exists: the default would
 // notify everyone, which is how a notification becomes noise and gets muted.
 assert.deepEqual(ids(pickOwners([HER,them],'colleague',AGENT)),['them'],'naming one excludes the other');
 assert.deepEqual(pickOwners([HER],'nobody@example.com',AGENT),[],'a name matching no member subscribes no one, rather than falling back to everyone');
 assert.deepEqual(pickOwners([HER,BOT],'jauntagent',AGENT),[],'the agent is never subscribed to its own writing, even when named');
 // An explicit owner outranks the heuristics: naming a guest is an odd thing to
 // do, and overruling it in silence would be the worse answer.
 assert.deepEqual(ids(pickOwners([member({id:'guest',dn:'visitor',guest:true})],'visitor',AGENT)),['guest']);
});
test('subscribing an existing ticket adds, and only when somebody is missing',()=>{
 // issueUpdate *replaces* the subscriber list, so parking has to union with what
 // is there — assigning would unsubscribe everyone the write did not mention.
 assert.deepEqual(subscribersToAdd(['bot'],['her']),['her']);
 assert.deepEqual(subscribersToAdd([],['her']),['her'],'nothing subscribed yet is the whole bug');
 // Writing anyway would post an activity entry on every re-claim saying that
 // nothing changed, which is noise on the one ticket already asking for silence.
 assert.deepEqual(subscribersToAdd(['bot','her'],['her']),[],'already subscribed, nothing to write');
 assert.deepEqual(subscribersToAdd(['her'],[]),[],'nobody wanted, nothing to write');
 assert.deepEqual(subscribersToAdd(['bot'],['her','her']),['her'],'a name asked for twice is added once');
 assert.deepEqual(subscribersToAdd(undefined,undefined),[],'neither side read is not a crash');
});
const {diff,watcherHealth,shouldFire,superseded,livePid}=await import('../scripts/linear_watch.mjs');
// `enabled: true` with nothing watching is the failure that looks like calm, and
// the only detector was `pgrep -f linear_watch.mjs` — which matches the shell
// running it, so it answered "running" from a machine where nothing was. The
// verdict now comes from a record the watcher writes, and these are its branches.
test('liveness is read from the pulse, and a stopped watcher never reads as polling',()=>{
 const now=Date.parse('2026-09-20T12:00:00Z'),at=(s)=>new Date(now-s*1000).toISOString();
 const alive=()=>true,gone=()=>false;
 const health=(record,pidAlive=alive)=>watcherHealth(record,{now,pidAlive});
 assert.deepEqual(health(null),{alive:false,reason:'never started'},'no record at all is not a running watcher');
 // Every exit stamps `endedAt`, so the last thing it did is on file and a crash
 // is no longer indistinguishable from a quiet board.
 assert.equal(health({pid:7,startedAt:at(90),endedAt:at(1),wake:'board-changed'}).reason,'exited: board-changed');
 assert.equal(health({pid:7,startedAt:at(90),lastPollAt:at(5),intervalSeconds:30},gone).reason,'process gone');
 // A live pid is not enough: the number may have been recycled, or the process
 // may be wedged. A pulse that stopped advancing settles both.
 assert.equal(health({pid:7,startedAt:at(400),lastPollAt:at(200),intervalSeconds:30}).reason,'heartbeat stale');
 assert.deepEqual(health({pid:7,startedAt:at(90),lastPollAt:at(10),intervalSeconds:30}).alive,true);
 // 2.5 intervals, so one missed poll is tolerated and two are not.
 assert.equal(health({pid:7,startedAt:at(90),lastPollAt:at(70),intervalSeconds:30}).alive,true);
 assert.equal(health({pid:7,startedAt:at(90),lastPollAt:at(80),intervalSeconds:30}).alive,false);
 // A fast watcher must not be declared dead between two polls: the floor is 30 s.
 assert.equal(health({pid:7,startedAt:at(90),lastPollAt:at(25),intervalSeconds:1}).alive,true);
 assert.equal(livePid(process.pid),true);
 assert.equal(livePid(undefined),false,'a record with no pid is not a live process');
});
// The relauncher cannot be the watcher (it is dead) nor a shell loop that never
// returns (it would never wake the session). So it is a second background task
// that fires by EXITING — and the one thing it must not do is cry wolf during an
// orchestration pass, which legitimately runs with no watcher while it works.
test('the watchdog fires on a continuous absence, not on a gap between passes',()=>{
 const now=Date.parse('2026-09-20T12:00:00Z'),ago=(s)=>now-s*1000;
 const fire=(o)=>shouldFire({now,graceSeconds:600,...o});
 const dead={alive:false,reason:'process gone'},up={alive:true};
 assert.deepEqual(fire({enabled:false,health:up,unhealthySince:null}),{fire:true,wake:'loop-off'},'the flag going off ends it, so no pkill is needed');
 // A watcher that came back resets the clock: the pass relaunched it in time.
 assert.deepEqual(fire({enabled:true,health:up,unhealthySince:ago(9999)}),{fire:false,unhealthySince:null});
 assert.equal(fire({enabled:true,health:dead,unhealthySince:ago(599)}).fire,false,'still inside the grace, a pass may simply be running');
 const lost=fire({enabled:true,health:dead,unhealthySince:ago(601)});
 assert.deepEqual([lost.fire,lost.wake,lost.why],[true,'watcher-lost','process gone']);
 // The first tick that sees the absence starts the clock rather than firing on it.
 assert.deepEqual(fire({enabled:true,health:dead,unhealthySince:null}),{fire:false,unhealthySince:now,forSeconds:0});
});
// Each tick rewrites the file with its own pid, so two watchdogs comparing pids
// would chase each other for ever, each seeing the other and neither yielding.
test('two watchdogs never both count: the newer wins, the older stands down',()=>{
 const mine={pid:10,startedAt:'2026-09-20T12:00:00.000Z'};
 assert.equal(superseded(mine,null),false,'a missing file is this one being first, not a rival');
 assert.equal(superseded(mine,mine),false,'reading back its own record is not a rival');
 assert.equal(superseded(mine,{pid:11,startedAt:'2026-09-20T12:00:01.000Z'}),true);
 assert.equal(superseded(mine,{pid:11,startedAt:'2026-09-20T11:59:59.000Z'}),false,'the older one is the one that leaves');
 // Same millisecond: the tie still has to break one way, or both would stay.
 const tie=(a,b)=>superseded({pid:a,startedAt:mine.startedAt},{pid:b,startedAt:mine.startedAt});
 assert.deepEqual([tie(10,11),tie(11,10)],[true,false]);
});
// Reacting creates no comment and changes no state, so the watcher could not see
// a 👍 at all — and it *does* bump the issue, so what little it saw it called an
// edit and sent through the prioritisation pass instead of re-reading the thread.
test('a reaction wakes the watcher, and as a comment rather than an edit',()=>{
 const was={u:'1',s:'Backlog',c:'c1',cu:'10'};
 const pulse=(t)=>({tickets:{'JAU-36':t}});
 const types=(now)=>diff(pulse(was),pulse(now)).map(e=>e.type);
 // Measured on the live API: a reaction moves both the comment and the issue.
 assert.deepEqual(types({u:'2',s:'Backlog',c:'c1',cu:'11'}),['comment-updated'],'the thread moved, not the ticket');
 // A real edit of the ticket body still reaches the analysis pass.
 assert.deepEqual(types({u:'2',s:'Backlog',c:'c1',cu:'10'}),['ticket-edited']);
 // A new comment is already covered and must not also report as touched.
 assert.deepEqual(types({u:'2',s:'Backlog',c:'c2',cu:'20'}),['comment']);
 assert.deepEqual(types({u:'1',s:'Done',c:'c1',cu:'10'}),['state-changed']);
 // A pulse written before `cu` existed is not a board where everything changed.
 assert.deepEqual(diff(pulse({u:'1',s:'Backlog',c:'c1'}),pulse({u:'1',s:'Backlog',c:'c1',cu:'10'})).map(e=>e.type),[]);
 assert.deepEqual(diff(pulse({u:'1',s:'Backlog',c:'c1'}),pulse({u:'2',s:'Backlog',c:'c1',cu:'10'})).map(e=>e.type),['ticket-edited'],'an unknown cu must not swallow a real edit');
});
test('reactions are attributed, not just counted',()=>{
 const found=collectReactions([human('h',T(1),'x',[thumb(T(2))]),agent('a',T(3),[thumb(T(4),ME)])],ME);
 assert.deepEqual(found.map(r=>[r.onAgentComment,r.mine,r.means]),[[false,false,'approved'],[true,true,'approved']]);
 // `Reaction.createdAt` is when the human answered; the comment's is when the
 // agent asked. A payload predating the field must still order sanely.
 assert.equal(collectReactions([agent('a',T(3),[{emoji:'+1',user:{id:HUMAN}}])],ME)[0].at,T(3));
 // No plan at all is the branch where a 👍 used to vanish with nobody told.
 assert.deepEqual(unreadReactions(collectReactions([agent('a',T(3),[thumb(T(4))])],ME),null).map(r=>r.why),['no live plan on this ticket']);
});

// JAU-50: the board is never contacted by these tests. Real temporary claim,
// stop and inventory files exercise the same persistence used by the CLI.
const {closureStore,closureInventory,closureProblems,preserveWorkHistory,issueDescription}=await import('../scripts/linear_agent.mjs');
const fs=await import('node:fs/promises'),path=await import('node:path'),os=await import('node:os');
async function closureFixture(t,{phase='implementing',state='completed'}={}) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jaunt-closure-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.mkdir(path.join(dir,'claims'));
 const claim={issue:'JAU-50',claimedAt:'2026-09-21T13:00:00Z',updatedAt:'2026-09-21T13:01:00Z',phase,session:'actual-test-session',runtime:'codex'};
 const putClaim=async(value=claim)=>fs.writeFile(path.join(dir,'claims/JAU-50.json'),JSON.stringify(value));
 await putClaim();
 await fs.writeFile(path.join(dir,'claims/JAU-50.stop'),'preserve me');
 const origin={identifier:'JAU-50',state:{type:state},relations:{nodes:[]},inverseRelations:{nodes:[]}};
 const target={identifier:'JAU-60',relations:{nodes:[]},inverseRelations:{nodes:[]}};
 const reads=[];
 const readIssue=async id=>{reads.push(id);if(id==='JAU-50')return origin;if(id==='JAU-60')return target;throw new Error('missing issue');};
 const store=closureStore({stateDir:dir,readIssue});
 const preserved=async()=>{
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'claims/JAU-50.json'),'utf8')),claim);
  assert.equal(await fs.readFile(path.join(dir,'claims/JAU-50.stop'),'utf8'),'preserve me');
 };
 return {dir,claim,origin,target,store,reads,putClaim,preserved};
}
const leftover=(extra={})=>({key:'reconnect-path',observation:'Path validation fails on reconnect',location:'host/path.py:42',excludedBecause:'Origin fixes test timing only',decision:'Worker: propose a safe retry; no human arbitration yet',expects:'none',disposition:'ticket',ticket:'JAU-60',...extra});

test('issue descriptions require explicit expectations and reject conflicting markers',()=>{
 for(const expects of [undefined,true,'','  ','test\nlater'])assert.throws(()=>issueDescription('facts',expects),/--expects/);
 const none=issueDescription('facts','none');
 assert.match(none,/Rien attendu de toi/);
 assert.equal(issueDescription(none,'none'),none,'same marker is not duplicated');
 const action=issueDescription('facts','Emeric : tester après livraison');
 assert.match(action,/Attendu de toi :.*tester après livraison/,'no dependency on Waiting for human');
 assert.throws(()=>issueDescription(action,'none'),/conflicting/);
 assert.throws(()=>issueDescription(none+'\n'+none,'none'),/duplicate/);
 assert.throws(()=>issueDescription(true,'none'),/--desc/);
});

test('missing inventory blocks release; an explicit empty inventory permits it and survives',async t=>{
 const f=await closureFixture(t);
 await assert.rejects(()=>f.store.release('JAU-50'),/no closure inventory/);await f.preserved();
 assert.deepEqual((await f.store.save('JAU-50',{items:[]})).problems,[]);
 assert.deepEqual(await f.store.release('JAU-50'),{released:true,was:'JAU-50',mode:'closure'});
 await assert.rejects(()=>fs.readFile(path.join(f.dir,'claims/JAU-50.json')),/ENOENT/);
 await assert.rejects(()=>fs.readFile(path.join(f.dir,'claims/JAU-50.stop')),/ENOENT/);
 const after=await f.store.read('JAU-50');assert.equal(after.current,false);assert.deepEqual(after.inventory.items,[]);
 assert.equal(JSON.parse(await fs.readFile(path.join(f.dir,'closures/JAU-50.release.json'))).mode,'closure');
 assert.equal((await f.store.release('JAU-50')).released,false,'repeat release does not create issues');
});

test('drafts preserve incomplete evidence but cannot release; intuitions can be explicitly discarded',async t=>{
 const f=await closureFixture(t);
 const draft={key:'intuition',disposition:'pending',observation:'Possible missing coverage',expects:'none'};
 const saved=await f.store.save('JAU-50',{items:[draft]});assert.ok(saved.problems.some(p=>p.includes('location')));
 await assert.rejects(()=>f.store.release('JAU-50'),/unresolved/);await f.preserved();
 await f.store.save('JAU-50',{items:[{...draft,disposition:'discarded'}]});
 await assert.rejects(()=>f.store.release('JAU-50'),/discard reason/);
 await f.store.save('JAU-50',{items:[{...draft,disposition:'discarded',reason:'No reproduction or code location found; unverified intuition only'}]});
 assert.equal((await f.store.release('JAU-50')).released,true);
});

test('ticket dispositions require all four facts and explicit expectation',()=>{
 const claim={issue:'JAU-50',claimedAt:'cycle'};
 for(const field of ['observation','location','excludedBecause','decision','expects','ticket']){
  const entry=leftover();delete entry[field];
  assert.ok(closureProblems({...claim,items:[entry]},claim).length,field);
 }
 assert.ok(closureProblems({...claim,items:[leftover({ticket:'JAU-50'})]},claim).some(p=>p.includes('origin')));
 assert.throws(()=>closureInventory({items:[leftover(),leftover()]}),/unique/);
 assert.throws(()=>closureInventory({items:[leftover({ticket:'../../claims'})]}),/identifier/);
 assert.throws(()=>closureInventory({items:[leftover({decision:false})]}),/text/);
});

test('creation saved before relation can resume without losing or recreating the follow-up',async t=>{
 const f=await closureFixture(t);
 await f.store.save('JAU-50',{items:[leftover()]});
 await assert.rejects(()=>f.store.release('JAU-50'),/missing related link/);await f.preserved();
 assert.equal((await f.store.read('JAU-50')).inventory.items[0].ticket,'JAU-60');
 await assert.rejects(()=>f.store.save('JAU-50',{items:[]}),/explicitly discard/);
 await assert.rejects(()=>f.store.save('JAU-50',{items:[leftover({ticket:'JAU-61'})]}),/preserve recorded ticket/);
 f.target.inverseRelations.nodes.push({type:'related',issue:{identifier:'JAU-50'}});
 assert.equal((await f.store.release('JAU-50')).released,true);
 assert.deepEqual(f.reads,['JAU-50','JAU-60','JAU-50','JAU-60'],'verification reads only, never creates');
});

test('related links work in either direction on the origin or existing target',async t=>{
 for(const holder of ['origin','target'])for(const inverse of [false,true]){
  const f=await closureFixture(t);
  const id=holder==='origin'?'JAU-60':'JAU-50';
  f[holder][inverse?'inverseRelations':'relations'].nodes.push({type:'related',[inverse?'issue':'relatedIssue']:{identifier:id}});
  await f.store.save('JAU-50',{items:[leftover()]});
  assert.equal((await f.store.release('JAU-50')).released,true);
 }
});

test('missing tickets, wrong relations and API errors preserve claim and stop',async t=>{
 const f=await closureFixture(t);
 f.origin.relations.nodes.push({type:'blocks',relatedIssue:{identifier:'JAU-60'}});
 await f.store.save('JAU-50',{items:[leftover()]});
 await assert.rejects(()=>f.store.release('JAU-50'),/missing related/);await f.preserved();
 f.target.identifier='JAU-99';
 await assert.rejects(()=>f.store.release('JAU-50'),/does not exist/);await f.preserved();
 const fail=closureStore({stateDir:f.dir,readIssue:async()=>{throw new Error('network failed');}});
 await assert.rejects(()=>fail.release('JAU-50'),/network failed/);await f.preserved();
});

test('same claim resumes its inventory; a new claim cannot use the old one',async t=>{
 const f=await closureFixture(t);
 await f.store.save('JAU-50',{items:[]});
 await f.putClaim({...f.claim,session:'resumed-session',phase:'landing'});
 assert.equal((await f.store.read('JAU-50')).current,true);
 await f.putClaim({...f.claim,claimedAt:'2026-09-22T13:00:00Z'});
 assert.equal((await f.store.read('JAU-50')).current,false);
 await assert.rejects(()=>f.store.release('JAU-50'),/another claim cycle/);
 await f.store.save('JAU-50',{items:[]});assert.equal((await f.store.release('JAU-50')).released,true);
});

test('unstarted cleanup needs a reason and never bypasses completed or started work',async t=>{
 const f=await closureFixture(t,{phase:'planning',state:'backlog'});
 await assert.rejects(()=>f.store.release('JAU-50'),/no closure/);await f.preserved();
 assert.equal((await f.store.release('JAU-50','Confirmed no worker, plan or recoverable session')).mode,'unstarted');
 for(const options of [{phase:'planning',state:'completed'},{phase:'implementing',state:'backlog'},{phase:'landing',state:'canceled'}]){
  const x=await closureFixture(t,options);
  await assert.rejects(()=>x.store.release('JAU-50','cleanup'),/only for claims/);await x.preserved();
 }
 const history=await closureFixture(t,{phase:'planning',state:'backlog'});
 await history.putClaim({...history.claim,workStartedAt:'earlier'});
 await assert.rejects(()=>history.store.release('JAU-50','cleanup'),/only for claims/);
});

test('work history survives re-planning without altering runtime/session or leaking to a new cycle',()=>{
 const base={issue:'JAU-50',claimedAt:'cycle',updatedAt:'now',phase:'implementing',runtime:'codex',session:'thread'};
 const started=preserveWorkHistory(base,null);assert.equal(started.workStartedAt,'now');
 const replan=preserveWorkHistory({...base,phase:'planning',updatedAt:'later'},started);
 assert.equal(replan.workStartedAt,'now');assert.equal(replan.runtime,'codex');assert.equal(replan.session,'thread');
 assert.equal(preserveWorkHistory({...replan,claimedAt:'new',workStartedAt:null},started).workStartedAt,null);
 assert.equal(preserveWorkHistory({...base,phase:'queued'},base).workStartedAt,'now','legacy active phase is evidence of work');
});

test('release notices local changes during remote verification',async t=>{
 const f=await closureFixture(t);await f.store.save('JAU-50',{items:[]});
 const store=closureStore({stateDir:f.dir,readIssue:async()=>{
  await f.putClaim({...f.claim,updatedAt:'changed'});return f.origin;
 }});
 await assert.rejects(()=>store.release('JAU-50'),/changed during verification/);
 assert.equal(await fs.readFile(path.join(f.dir,'claims/JAU-50.stop'),'utf8'),'preserve me');
});

test('malformed inventory and unsafe identifiers fail closed',async t=>{
 const f=await closureFixture(t);await f.store.save('JAU-50',{items:[]});
 await fs.writeFile(path.join(f.dir,'closures/JAU-50.json'),'{broken');
 await assert.rejects(()=>f.store.release('JAU-50'),SyntaxError);await f.preserved();
 await assert.rejects(()=>f.store.read('../claims/JAU-50'),/identifier/);
});

test('a cleanup reason cannot discard findings from a planning survey',async t=>{
 const f=await closureFixture(t,{phase:'planning',state:'backlog'});
 await f.store.save('JAU-50',{items:[leftover({disposition:'pending'})]});
 await assert.rejects(()=>f.store.release('JAU-50','never implemented'),/recorded leftovers/);await f.preserved();
});

test('create rejects missing or conflicting expectations before loading credentials',async t=>{
 const {execFile}=await import('node:child_process');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jaunt-expects-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'scripts'));
 for(const name of ['linear_waits.mjs','linear_landing.mjs','linear_skills.mjs','linear_agent.mjs','linear_watch.mjs','linear_workers.mjs','linear_telemetry.mjs', 'linear_wakes.mjs', 'linear_attribution.mjs','linear_activity.mjs'])await fs.copyFile(new URL('../scripts/'+name,import.meta.url),path.join(dir,'scripts',name));
 for(const args of [[],['--expects'],['--expects',''],['--expects','none','--desc','**Attendu de toi :** choose now']]){
  const result=await new Promise(resolve=>execFile(process.execPath,[path.join(dir,'scripts/linear_agent.mjs'),'create','Example',...args],
   {timeout:5000},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
  assert.equal(result.error?.code,1);assert.match(result.stderr,/requires --expects|conflicting/);
  assert.doesNotMatch(result.stderr,/credentials|graphql|fetch/);assert.equal(result.stdout,'');
 }
});

test('closure CLI saves and reads drafts on stdin without loading credentials',async t=>{
 const {execFile}=await import('node:child_process');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jaunt-closure-cli-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.mkdir(path.join(dir,'scripts'));await fs.mkdir(path.join(dir,'.dev-state/claims'),{recursive:true});
 for(const name of ['linear_waits.mjs','linear_landing.mjs','linear_skills.mjs','linear_agent.mjs','linear_watch.mjs','linear_workers.mjs','linear_telemetry.mjs', 'linear_wakes.mjs', 'linear_attribution.mjs','linear_activity.mjs'])await fs.copyFile(new URL('../scripts/'+name,import.meta.url),path.join(dir,'scripts',name));
 await fs.writeFile(path.join(dir,'.dev-state/claims/JAU-50.json'),JSON.stringify({issue:'JAU-50',claimedAt:'cycle',phase:'planning'}));
 const run=(args,input)=>new Promise((resolve,reject)=>{
  const child=execFile(process.execPath,[path.join(dir,'scripts/linear_agent.mjs'),...args],{timeout:5000},(error,stdout,stderr)=>{
   if(error)reject(new Error(stderr));else resolve(JSON.parse(stdout));
  });child.stdin.end(input);
 });
 assert.deepEqual((await run(['closure','JAU-50','--file','-'],'{"items":[]}')).problems,[]);
 assert.equal((await run(['closure','JAU-50'])).current,true);
 await assert.rejects(()=>run(['closure','JAU-50','--file']),/needs a filename/);
});

// JAU-43: exercise the real persistence boundary with offline board mutations.
const {writeClaim,restoreClaimState,registerAnswer}=await import('../scripts/linear_agent.mjs');
async function parkingFixture(t) {
 const f=await closureFixture(t,{phase:'awaiting-approval',state:'unstarted'});
 f.claim.parkedFrom='Backlog';await f.putClaim();
 f.origin.state.name=WAITING_STATE;
 const moves=[];
 const moveState=async(issue,target)=>{moves.push(target);issue.state={name:target,type:'backlog'};return {moved:true};};
 const options={stateDir:f.dir,readIssue:async()=>f.origin,moveState};
 return {...f,moves,options,store:closureStore(options),readClaim:async()=>JSON.parse(await fs.readFile(path.join(f.dir,'claims/JAU-50.json'),'utf8'))};
}
test('every exit from awaiting restores before persisting phase, preserving identity/history',async t=>{
 for(const phase of ['planning','queued','implementing','landing']){
  const f=await parkingFixture(t);
  if(phase==='landing')await fs.writeFile(path.join(f.dir,'landing.json'),JSON.stringify({version:1,queue:[{...f.claim,branch:'agent/JAU-50',cwd:f.dir}],history:[]}));
  const result=await writeClaim({...f.claim,phase},f.options);
  assert.deepEqual(f.moves,['Backlog']);assert.equal(result.parkedFrom,null);
  assert.equal((await f.readClaim()).phase,phase);
  for(const key of ['session','runtime','claimedAt'])assert.equal(result[key],f.claim[key]);
  if(['implementing','landing'].includes(phase))assert.equal(result.workStartedAt,f.claim.updatedAt);
  await writeClaim(result,f.options);assert.equal(f.moves.length,1);
 }
});
test('repeated waiting keeps original destination; explicit refusal restores without phase change',async t=>{
 const f=await parkingFixture(t);
 await writeClaim({...f.claim},f.options);assert.deepEqual(f.moves,[]);
 assert.equal((await f.readClaim()).parkedFrom,'Backlog');
 await writeClaim({...f.claim},{...f.options,unpark:true});
 assert.deepEqual(f.moves,['Backlog']);assert.equal((await f.readClaim()).phase,'awaiting-approval');
});
test('manual moves are respected and old restoration debt is cleared',async t=>{
 for(const name of ['Done','Backlog']){
  const f=await parkingFixture(t);f.origin.state.name=name;
  await writeClaim({...f.claim,phase:'implementing'},f.options);
  assert.deepEqual(f.moves,[]);assert.equal((await f.readClaim()).parkedFrom,null);
 }
});
test('failed phase restoration retains evidence and can retry, including legacy phase debt',async t=>{
 for(const parkedFrom of [null,WAITING_STATE,'Backlog']){
  const f=await parkingFixture(t);f.claim.parkedFrom=parkedFrom;await f.putClaim();
  const options={...f.options,moveState:async()=>({moved:false,reason:'target deleted'})};
  await assert.rejects(writeClaim({...f.claim,phase:'implementing'},options),/cannot restore/);
  await f.preserved();
 }
 const f=await parkingFixture(t);f.claim.phase='implementing';await f.putClaim();
 await assert.rejects(writeClaim({...f.claim},{...f.options,moveState:async()=>{throw new Error('offline');}}),/offline/);
 await f.preserved();await writeClaim({...f.claim},f.options);assert.deepEqual(f.moves,['Backlog']);
});
test('remote success followed by interruption retries without another board move',async t=>{
 const f=await parkingFixture(t);
 await assert.rejects(writeClaim({...f.claim,phase:'planning'},{...f.options,onUnpark:()=>{throw new Error('interrupted');}}),/interrupted/);
 await f.preserved();assert.deepEqual(f.moves,['Backlog']);
 await writeClaim({...f.claim,phase:'planning'},f.options);assert.deepEqual(f.moves,['Backlog']);
 assert.equal((await f.readClaim()).parkedFrom,null);
});
test('phase restoration preserves a concurrently replaced claim',async t=>{
 for(const during of ['read','move']){
  const f=await parkingFixture(t);const replacement={...f.claim,claimedAt:'new-cycle'};
  const options={...f.options};
  if(during==='read')options.readIssue=async()=>{await f.putClaim(replacement);return f.origin;};
  else options.moveState=async()=>{await f.putClaim(replacement);return {moved:true};};
  await assert.rejects(writeClaim({...f.claim,phase:'planning'},options),/claim changed/);
  assert.deepEqual(await f.readClaim(),replacement);
 }
});
test('release restores after closure validation and before cleanup, including unstarted release',async t=>{
 for(const cleanup of [false,true]){
  const f=await parkingFixture(t);
  if(!cleanup){
   await assert.rejects(f.store.release(f.claim.issue),/no closure/);assert.deepEqual(f.moves,[]);
   await f.store.save(f.claim.issue,{items:[]});
  }
  let removed=false;
  await f.store.release(f.claim.issue,cleanup?'unstarted abandoned plan':undefined,async()=>{
   assert.deepEqual(f.moves,['Backlog']);assert.equal((await f.readClaim()).parkedFrom,'Backlog');removed=true;
  });
  assert.equal(removed,true);await assert.rejects(f.readClaim(),/ENOENT/);
 }
});
test('release restoration errors preserve claim and stop and never remove worktree',async t=>{
 for(const failure of ['missing','deleted','network']){
  const f=await parkingFixture(t);await f.store.save(f.claim.issue,{items:[]});
  if(failure==='missing'){f.claim.parkedFrom=null;await f.putClaim();}
  const store=closureStore({...f.options,moveState:async()=>{
   if(failure==='network')throw new Error('offline');return {moved:false,reason:'target deleted'};
  }});
  await assert.rejects(store.release(f.claim.issue,undefined,async()=>assert.fail('must not remove')),/cannot restore|offline/);
  await f.preserved();
 }
});
test('release rechecks remote state and protects replacement claims during restoration',async t=>{
 const f=await parkingFixture(t);await f.store.save(f.claim.issue,{items:[]});
 let reads=0;
 const store=closureStore({...f.options,readIssue:async()=>{
  if(++reads===2)f.origin.state={name:'Done',type:'completed'};return f.origin;
 }});
 await store.release(f.claim.issue);assert.deepEqual(f.moves,[]);
 const g=await parkingFixture(t);await g.store.save(g.claim.issue,{items:[]});
 const replacement={...g.claim,claimedAt:'replacement'};
 const changed=closureStore({...g.options,moveState:async()=>{await g.putClaim(replacement);return {moved:true};}});
 await assert.rejects(changed.release(g.claim.issue,undefined,async()=>assert.fail('must not remove')),/changed during restoration/);
 assert.deepEqual(await g.readClaim(),replacement);
});
test('restoration rejects unreadable board identity instead of clearing recovery data',async()=>{
 await assert.rejects(restoreClaimState({identifier:'wrong',state:{name:'Backlog'}},{issue:'JAU-50'}),/cannot verify/);
});

test('answer registration restores all real answers, preserves queuing and does not mutate pending reads',async t=>{
 for(const answer of ['approved','feedback','declined','pending','no-plan']){
  for(const queued of (answer==='approved'?[false,true]:[false])){
   const f=await parkingFixture(t);let receipts=0;
   const plan={id:'plan',createdAt:'2026-09-21T13:01:00Z'};
   const comments=[];
   const deps={
    persistClaim:(record,options)=>writeClaim(record,{...f.options,...options}),
    decidePhase:async()=>queued?{phase:'queued',queuedBehind:['JAU-45']}:{phase:'implementing'},
    comment:async(id,body,parent)=>{assert.equal(parent,'plan');receipts++;comments.push({user:{id:'agent'},body,createdAt:'2026-09-21T14:00:00Z'});return {id:'ack'};},
   };
   const done=await registerAnswer(f.origin,{verdict:answer},f.claim,plan,comments,'agent',deps);
   if(['pending','no-plan'].includes(answer)){assert.deepEqual(done,{});await f.preserved();assert.deepEqual(f.moves,[]);continue;}
   assert.equal(done.unparked,'Backlog');assert.deepEqual(f.moves,['Backlog']);
   const phase=answer==='approved'?(queued?'queued':'implementing'):answer==='feedback'?'planning':'awaiting-approval';
   assert.equal((await f.readClaim()).phase,phase);
   if(queued)assert.deepEqual(done.queuedBehind,['JAU-45']);
   await registerAnswer(f.origin,{verdict:answer},await f.readClaim(),plan,comments,'agent',deps);
   assert.equal(receipts,answer==='approved'?1:0);assert.deepEqual(f.moves,['Backlog']);
  }
 }
});

// JAU-40: validate before dispatch, including commands with no options.
const {COMMAND_FLAGS,parseCommandArgs}=await import('../scripts/linear_agent.mjs');
test('Linear CLI declares every command and rejects unknown command-specific options',async()=>{
 const source=await fs.readFile(new URL('../scripts/linear_agent.mjs',import.meta.url),'utf8');
 const handlers=[...source.slice(source.indexOf('const COMMANDS = {'),source.indexOf('export const COMMAND_FLAGS')).matchAll(/^  (?:'([^']+)'|(\w+)): async/gm)].map(m=>m[1]||m[2]);
 assert.deepEqual(Object.keys(COMMAND_FLAGS).sort(),handlers.sort());
 for(const [command,schema] of Object.entries(COMMAND_FLAGS)){
  for(const [action,options] of Array.isArray(schema)?[[null,schema]]:Object.entries(schema)){
   const prefix=action?[action]:[];
   for(const bad of ['--typo','--__proto__','--constructor']){
    assert.throws(()=>parseCommandArgs(command,[...prefix,bad]),error=>
     error.message.includes(command)&&error.message.includes(bad)&&error.message.includes('accepted options:'));
   }
   for(const option of options){
    const toggle=['peek','if-stale','incremental','delivered'].includes(option);
    const {flags}=parseCommandArgs(command,[...prefix,`--${option}`,...(toggle?[]:['value'])]);
    assert.equal(flags[option==='description'?'desc':option],toggle?true:'value');
   }
  }
 }
 assert.throws(()=>parseCommandArgs('show',['JAU-40','--desc','text']),/accepted options: \(none\)/);
 assert.throws(()=>parseCommandArgs('landing',['prepare','JAU-40','--pr','83']),/landing prepare.*--pr/);
 assert.throws(()=>parseCommandArgs('stack',['rebase','JAU-40','--base','abc']),/stack rebase.*--base/);
 assert.throws(()=>parseCommandArgs('constructor',[]),/unknown command/);
 assert.throws(()=>parseCommandArgs('landing',['constructor']),/requires one of/);
});
test('Linear CLI preserves literal text, switches, session flags and description aliases',()=>{
 assert.deepEqual(parseCommandArgs('comment',['JAU-40','--expects','none','--','--literal','words','--reply']),
  {flags:{expects:'none'},rest:['JAU-40','--literal','words','--reply']});
 assert.deepEqual(parseCommandArgs('move',['JAU-40','Waiting','for','human']).rest,['JAU-40','Waiting','for','human']);
 assert.deepEqual(parseCommandArgs('verdict',['--peek','JAU-40']),{flags:{peek:true},rest:['JAU-40']});
 assert.deepEqual(parseCommandArgs('claim',['JAU-40','implementing','--session','actual-thread','--runtime','codex']),
  {flags:{session:'actual-thread',runtime:'codex'},rest:['JAU-40','implementing']});
 assert.equal(parseCommandArgs('claim',['JAU-40','--session']).flags.session,true);
 for(const value of ['text','-',''])assert.deepEqual(parseCommandArgs('create',['Example','--description',value]),parseCommandArgs('create',['Example','--desc',value]));
 for(const args of [['--desc','a','--description','b'],['--description','a','--desc','b']])
  assert.throws(()=>parseCommandArgs('create',args),/use only one/);
});

async function flagCliFixture(t){
 const {execFile}=await import('node:child_process');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jaunt-flags-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.mkdir(path.join(dir,'scripts'));
 for(const name of ['linear_waits.mjs','linear_landing.mjs','linear_skills.mjs','linear_agent.mjs','linear_watch.mjs','linear_workers.mjs','linear_telemetry.mjs', 'linear_wakes.mjs', 'linear_attribution.mjs','linear_activity.mjs'])
  await fs.copyFile(new URL('../scripts/'+name,import.meta.url),path.join(dir,'scripts',name));
 const run=(args,input,preload)=>new Promise(resolve=>{
  const child=execFile(process.execPath,[...(preload?['--import',preload]:[]),path.join(dir,'scripts/linear_agent.mjs'),...args],
   {timeout:5000},(error,stdout,stderr)=>resolve({error,stdout,stderr}));
  // Omitted input intentionally keeps stdin open to detect blocking reads.
  if(input!==undefined)child.stdin.end(input);
 });
 return {dir,run};
}
test('unknown flags fail before stdin, file reads, credentials or local mutations',async t=>{
 const {dir,run}=await flagCliFixture(t);
 for(const args of [
  ['create','Example','--desc','-','--typo'],['comment','JAU-40','--typo'],
  ['plan','JAU-40','--summary','Summary','--typo'],['loop-on','--typo'],['loop-off','--typo'],
  ['show','JAU-40','--desc','ignored'],['closure','JAU-40','--file','missing','--typo'],
  ['claim','JAU-40','--sesion','wrong'],['landing','acquire','JAU-40','--typo'],
 ]){
  const result=await run(args);
  assert.equal(result.error?.code,1,JSON.stringify(args));assert.equal(result.stdout,'');
  assert.match(result.stderr,/unknown option .*accepted options:/);
  assert.doesNotMatch(result.stderr,/credentials|client secret|ENOENT|graphql/);
 }
 await assert.rejects(()=>fs.stat(path.join(dir,'.dev-state')), {code:'ENOENT'});
 const literal=await run(['repo','--','--literal']);
 assert.equal(literal.error,null);assert.equal(literal.stdout.trim(),dir);
});
test('create sends both description spellings and stdin content to the same mocked API payload',async t=>{
 const {dir,run}=await flagCliFixture(t);
 await fs.mkdir(path.join(dir,'.dev-state'));
 await fs.writeFile(path.join(dir,'.dev-state/linear-credentials.json'),JSON.stringify({team:'TEST',clientSecret:'offline-fixture'}));
 await fs.writeFile(path.join(dir,'.dev-state/linear-token.json'),JSON.stringify({access_token:'offline-fixture',expires_at:Date.now()+60000}));
 const preload=path.join(dir,'mock-fetch.mjs');
 await fs.writeFile(preload,`
  import {writeFile} from 'node:fs/promises';
  globalThis.fetch=async (_url,options)=>{
   const {query,variables}=JSON.parse(options.body);
   let data;
   if(query.includes('issueCreate')){
    await writeFile(new URL('./payload.json',import.meta.url),JSON.stringify(variables.input));
    data={issueCreate:{success:true,issue:{identifier:'TEST-1',title:variables.input.title,url:'https://example.invalid/TEST-1',subscribers:{nodes:[]}}}};
   }else if(query.includes('teams(first:'))data={teams:{nodes:[{id:'team',key:'TEST',name:'Test',states:{nodes:[]}}]}};
   else if(query.includes('issueLabels('))data={issueLabels:{nodes:[{id:'origin',name:'Créé par le harnais'},{id:'unread',name:'Du neuf du harnais'},{id:'active',name:'Discussion active'}],pageInfo:{hasNextPage:false,endCursor:null}}};
   else throw new Error('offline notification lookup');
   return new Response(JSON.stringify({data}),{status:200});
  };
 `);
 const body='Description complète\n--literal line';
 for(const spelling of ['--desc','--description'])for(const stdin of [false,true]){
  const result=await run(['create','Multiword','title','--expects','none',spelling,stdin?'-':body],stdin?body:'',preload);
  assert.equal(result.error,null,result.stderr);
  const payload=JSON.parse(await fs.readFile(path.join(dir,'payload.json'),'utf8'));
  assert.equal(payload.title,'Multiword title');assert.equal(payload.description,issueDescription(body,'none')+'\n\n<!-- jaunt-agent:created -->');assert.deepEqual(payload.labelIds,['origin','unread','active']);
 }
 const conflict=await run(['create','Example','--desc','-','--description','other']);
 assert.equal(conflict.error?.code,1);assert.match(conflict.stderr,/use only one/);
});

test('telemetry CLI reads released generations offline without a claim, credentials or provider output',async(t)=>{
 const f=await flagCliFixture(t);
 const {beginAttempt,saveAttempt}=await import('../scripts/linear_workers.mjs');
 const {observeTelemetry}=await import('../scripts/linear_telemetry.mjs');
 const c={issue:'JAU-38',runtime:'claude',claimedAt:'2026-09-22T00:00:00Z',phase:'implementing'};
 const r=await beginAttempt(path.join(f.dir,'.dev-state'),c,{model:'requested-model',prompt:'PRIVATE PROMPT',launchMode:'start'});
 observeTelemetry(r,{type:'result',total_cost_usd:0,usage:{input_tokens:2,output_tokens:1}});
 await saveAttempt(path.join(f.dir,'.dev-state'),{...r,code:0,childExited:true,endedAt:'2026-09-22T00:01:00Z'});
 const result=await f.run(['telemetry','JAU-38']);
 assert.equal(result.error,null,result.stderr);
 const report=JSON.parse(result.stdout);
 assert.equal(report.knownUsageSubtotal.costUsd.value,0);
 assert.equal(report.counts.attempts,1);
 assert.ok(!result.stdout.includes('PRIVATE PROMPT'));
 const bad=await f.run(['telemetry','../bad']);assert.match(bad.stderr,/identifier/);
 const missing=await f.run(['telemetry','JAU-999']);assert.equal(JSON.parse(missing.stdout).knownUsageSubtotal.costUsd.value,null);
});
