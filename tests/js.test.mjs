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
