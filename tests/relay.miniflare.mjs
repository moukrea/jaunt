/** Integration under Cloudflare's actual local Workers runtime, not mocked WS. */
import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {Miniflare} from 'miniflare';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function next(ws){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Worker message timed out')),8000);const cb=e=>{clearTimeout(timer);ws.removeEventListener('message',cb);resolve(JSON.parse(e.data));};ws.addEventListener('message',cb);});}
async function upgrade(mf,origin='https://moukrea.github.io'){const response=await mf.dispatchFetch('https://relay.test/v1/room/'+'r'.repeat(24),{headers:{Upgrade:'websocket',Origin:origin}});assert.equal(response.status,101);const ws=response.webSocket;assert.ok(ws);ws.accept();return ws;}
for (const clientOrigin of ['https://moukrea.github.io','jaunt://app']) test(`workerd upgrade, authenticated routing and hibernation ping from ${clientOrigin}`,async()=>{
 const mf=new Miniflare({modules:true,scriptPath:path.join(root,'relay/worker.mjs'),compatibilityDate:'2025-11-17',bindings:{APP_ORIGIN:'https://moukrea.github.io'},durableObjects:{ROOMS:{className:'Room',useSQLite:true}}});
 let host,client;
 try{
  assert.equal((await mf.dispatchFetch('https://relay.test/health')).status,200);
  host=await upgrade(mf);let ready=next(host);host.send(JSON.stringify({type:'auth',role:'host',token:'h'.repeat(43),clientToken:'c'.repeat(43)}));assert.equal((await ready).type,'ready');
  assert.equal((await mf.dispatchFetch('https://relay.test/v1/room/'+'r'.repeat(24),{headers:{Upgrade:'websocket',Origin:'https://evil.test'}})).status,403);
  client=await upgrade(mf,clientOrigin);ready=next(client);const joined=next(host);client.send(JSON.stringify({type:'auth',role:'client',token:'c'.repeat(43)}));assert.equal((await ready).hostOnline,true);const peer=(await joined).peer;
  const received=next(host);const data={type:'box',n:1,ct:'opaque_payload'};client.send(JSON.stringify({type:'route',data}));assert.deepEqual(await received,{type:'route',from:peer,data});
  const back=next(client);host.send(JSON.stringify({type:'route',to:peer,data}));assert.deepEqual(await back,{type:'route',data});
  const pong=new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('No auto-pong')),5000);client.addEventListener('message',function cb(e){if(e.data==='pong'){clearTimeout(t);client.removeEventListener('message',cb);resolve(e.data);}});});client.send('ping');assert.equal(await pong,'pong');
 }finally{host?.close();client?.close();await mf.dispose();}
});
