/** Deterministic protocol tests; these are NOT a substitute for workerd tests. */
import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
globalThis.crypto ||= webcrypto;
globalThis.WebSocketRequestResponsePair = class {constructor(a,b){this.request=a;this.response=b;}};
const {Room,digest,default:worker}=await import('../relay/worker.mjs');
function socket(role='pending') {return {readyState:1,out:[],attachment:{id:crypto.randomUUID(),role,since:Date.now(),window:Date.now(),frames:0,bytes:0},serializeAttachment(s){this.attachment=structuredClone(s);},deserializeAttachment(){return structuredClone(this.attachment);},send(x){this.out.push(JSON.parse(x));},close(code,reason){this.readyState=3;this.code=code;this.reason=reason;}};}
function setup(){const map=new Map(),sockets=[];let alarm=null;const storage={async get(k){return map.get(k);},async put(k,v){map.set(k,v);},async transaction(f){return f(this);},async getAlarm(){return alarm;},async setAlarm(a){alarm=a;}};const ctx={storage,getWebSockets(){return sockets;},setWebSocketAutoResponse(){}};return{room:new Room(ctx,{}),sockets,map};}
const hostToken='h'.repeat(43),clientToken='c'.repeat(43);
async function auth(room,ws,role,token=role==='host'?hostToken:clientToken){await room.webSocketMessage(ws,JSON.stringify({type:'auth',role,token,clientToken}));}
test('host and client auth, encrypted opaque forwarding, no room secret in storage',async()=>{
 const {room,sockets,map}=setup(),h=socket(),c=socket();sockets.push(h,c);await auth(room,h,'host');await auth(room,c,'client');
 assert.equal(h.attachment.role,'host');assert.equal(c.attachment.role,'client');assert.equal(c.out[0].hostOnline,true);
 assert.equal(map.get('auth').host,await digest(hostToken));assert.ok(!JSON.stringify([...map]).includes(hostToken));
 const data={type:'box',n:1,ct:'opaque'};await room.webSocketMessage(c,JSON.stringify({type:'route',data}));
 assert.deepEqual(h.out.at(-1),{type:'route',from:c.attachment.id,data});
 await room.webSocketMessage(h,JSON.stringify({type:'route',to:c.attachment.id,data}));assert.deepEqual(c.out.at(-1),{type:'route',data});
});
test('unauthorized host cannot replace registered capability',async()=>{
 const {room,sockets}=setup(),h=socket(),bad=socket();sockets.push(h,bad);await auth(room,h,'host');await auth(room,bad,'host','x'.repeat(43));
 assert.equal(bad.code,1008);assert.equal(h.readyState,1);
});
test('reconnecting host replaces old socket without using closing one',async()=>{
 const {room,sockets}=setup(),h=socket(),c=socket(),h2=socket();sockets.push(h,c,h2);await auth(room,h,'host');await auth(room,c,'client');await auth(room,h2,'host');
 assert.equal(h.readyState,3);assert.equal(h2.readyState,1);await room.webSocketMessage(c,JSON.stringify({type:'route',data:{x:1}}));
 assert.equal(h2.out.at(-1).from,c.attachment.id);
 await room.webSocketClose(h,4001,'',true);assert.notEqual(c.out.at(-1).type,'host.offline');
});
test('expired handshake, invalid JSON, frame limit and bad client token',async()=>{
 for(const scenario of ['expired','json','size','token']){const {room,sockets}=setup(),h=socket(),c=socket();sockets.push(h,c);await auth(room,h,'host');
 if(scenario==='expired'){c.attachment.since=Date.now()-30000;await auth(room,c,'client');}
 if(scenario==='json')await room.webSocketMessage(c,'{');
 if(scenario==='size')await room.webSocketMessage(c,'x'.repeat(132001));
 if(scenario==='token')await auth(room,c,'client','x'.repeat(43));
 assert.equal(c.readyState,3,scenario);
 }
});
test('host disconnect marks clients offline; client leaves announce to host',async()=>{
 const {room,sockets}=setup(),h=socket(),c=socket();sockets.push(h,c);await auth(room,h,'host');await auth(room,c,'client');
 await room.webSocketClose(c,1000,'',true);assert.equal(h.out.at(-1).type,'peer.left');
 const c2=socket();sockets.push(c2);await auth(room,c2,'client');await room.webSocketClose(h,1000,'',true);assert.equal(c2.out.at(-1).type,'host.offline');
});
test('rate limit does not accept unbounded flooding',async()=>{
 const {room,sockets}=setup(),h=socket(),c=socket();sockets.push(h,c);await auth(room,h,'host');await auth(room,c,'client');
 for(let i=0;i<190&&c.readyState===1;i++)await room.webSocketMessage(c,JSON.stringify({type:'route',data:{i}}));assert.equal(c.code,1008);
});
test('origin gate and health',async()=>{
 const env={APP_ORIGIN:'https://moukrea.github.io'};
 assert.equal((await worker.fetch(new Request('https://relay.test/health'),env)).status,200);
 assert.equal((await worker.fetch(new Request('https://relay.test/v1/room/'+'r'.repeat(24),{headers:{Upgrade:'websocket',Origin:'https://evil.test'}}),env)).status,403);
 assert.equal((await worker.fetch(new Request('https://relay.test/no'),env)).status,404);
});
