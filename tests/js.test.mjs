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
