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
