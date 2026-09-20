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
 assert.equal(nextClaimState({verdict:'pending',currentState:WAITING_STATE,parkedFrom:'In Progress'}),null,'nothing was answered, so nothing moves');
 assert.equal(nextClaimState({verdict:'no-plan',currentState:WAITING_STATE,parkedFrom:'In Progress'}),null,'no live plan is not a verdict');
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
const {diff}=await import('../scripts/linear_watch.mjs');
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
