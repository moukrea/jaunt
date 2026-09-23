const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {DesktopUpdates,artifact}=require('../desktop/updates.cjs');
const {install,safeNames,systemArguments}=require('../desktop/update-install.cjs');
const channels=require('../desktop/channels.cjs');
const contract=require('./fixtures/update_channels.json');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('desktop release selection uses the platform asset and never downgrades',()=>{
 assert(channels.automatic('main','desktop-v0.1.0-beta.9','desktop-v0.1.0-beta.10'));
 assert(!channels.automatic('main','desktop-v0.1.0-beta.9','desktop-v0.1.0-beta.8'));
 assert.equal(artifact('desktop-v0.1.0-beta.33.ch.moukrea.9.2','linux','x64','archive'),'jaunt-desktop-0.1.0-beta.33.ch.moukrea.9.2-x64.tar.gz');
 assert.throws(()=>artifact('v0.1.0-beta.33.ch.moukrea.9.2','linux','x64','archive'));
 assert.equal(artifact('desktop-v0.1.0-beta.8','linux','x64','deb'),'jaunt-desktop-0.1.0-beta.8-amd64.deb');
 assert.equal(artifact('desktop-v0.1.0-beta.8','linux','arm64','rpm'),'jaunt-desktop-0.1.0-beta.8-aarch64.rpm');
 assert.throws(()=>artifact('desktop-v0.1.0-beta.8','linux','unknown','deb'));
 assert.throws(()=>safeNames('../private\n'));assert.throws(()=>safeNames('/private\n'));
});
async function fixture(t,{tamper=false,current=false,installed,preferences,documents={}}={}){
 const cache=await fs.mkdtemp(path.join(os.tmpdir(),'jaunt-updater-'));t.after(()=>fs.rm(cache,{recursive:true,force:true}));
 if(preferences)await fs.writeFile(path.join(cache,'preferences.json'),JSON.stringify(preferences));
 const bytes=Buffer.from('verified desktop bytes'),states=[],urls=[];
 const version=installed||(current?'0.1.0-beta.8':'0.1.0-beta.7');
 const app={isPackaged:true,getVersion:()=>version,getPath:name=>name==='exe'?process.execPath:cache};
 const fetch=async url=>{
  urls.push(url);
  if(url==='https://moukrea.github.io/jaunt/config.json')return new Response(JSON.stringify({desktopRelease:'desktop-v0.1.0-beta.8'}));
  if(url.endsWith('ch/index.json'))return url in documents?new Response(JSON.stringify(documents[url])):new Response('missing',{status:404});
  if(url.endsWith('config.json'))return url in documents?new Response(JSON.stringify(documents[url])):new Response('missing',{status:404});
  const tag=decodeURIComponent(url.split('/releases/download/')[1].split('/')[0]);
  if(url.endsWith('SHA256SUMS'))return new Response(sha(bytes)+`  jaunt-desktop-${tag.slice(9)}-x64.tar.gz\n`);
  return new Response(tamper?Buffer.from('tampered'):bytes,{headers:{'content-length':String(bytes.length)}});
 };
 const updater=new DesktopUpdates({app,fetch,emit:s=>states.push({...s}),platform:'linux',arch:'x64',kind:'archive',cache});await updater.init();return {updater,states,cache,urls};
}
const official=contract.documents.official;
// A valid moukrea_9 channel document whose desktop candidate is `desktop`.
function channelDocument(desktop){
 const document={...contract.documents.valid[0].document,desktopRelease:desktop};
 const n=channels.parse(desktop).n;
 return {...document,release:document.release.replace(/\.\d+$/,'.'+n),androidRelease:document.androidRelease.replace(/\.\d+$/,'.'+n)};
}
const channelURL=official.page+'ch/moukrea_9/config.json';
test('desktop download reports each phase and persists the automatic preference',async t=>{
 const {updater,states,cache}=await fixture(t);await updater.check();
 assert.equal(updater.state.state,'ready');assert.deepEqual([...new Set(states.map(s=>s.state))],['idle','checking','downloading','verifying','ready']);
 assert(states.some(s=>s.percent===100));assert.equal(updater.plan.digest,sha(Buffer.from('verified desktop bytes')));
 await updater.configure(false);assert.equal(JSON.parse(await fs.readFile(path.join(cache,'preferences.json'),'utf8')).automatic,false);
});
test('a checksum mismatch cannot launch an installer',async t=>{
 const {updater}=await fixture(t,{tamper:true});await updater.check();assert.equal(updater.state.state,'error');assert.match(updater.state.message,/checksum mismatch/);assert.equal(updater.plan,undefined);await assert.rejects(()=>updater.install(),/No verified/);
});
test('an up-to-date desktop has an explicit terminal result',async t=>{
 const {updater}=await fixture(t,{current:true});await updater.check();assert.equal(updater.state.state,'current');assert.match(updater.state.message,/up to date/);
});
test('cached bytes are reverified before installation',async t=>{
 const {updater}=await fixture(t);await updater.check();await fs.appendFile(updater.plan.payload,'modified');await assert.rejects(()=>updater.install(),/changed/);
});
test('detached archive installation preserves app data and unrelated running shells',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'jaunt-desktop-install-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const cache=path.join(root,'app-data/updates'),source=path.join(root,'source');await fs.mkdir(cache,{recursive:true});await fs.mkdir(source);
 const mac=process.platform==='darwin';const appRoot=path.join(source,mac?'jaunt.app':'jaunt-desktop-test');
 const binary=path.join(appRoot,mac?'Contents/MacOS/jaunt':'jaunt-desktop');await fs.mkdir(path.dirname(binary),{recursive:true});
 await fs.writeFile(binary,'#!/bin/sh\nprintf updated-desktop\n',{mode:0o755});
 if(!mac){await fs.mkdir(path.join(appRoot,'resources'));await fs.writeFile(path.join(appRoot,'resources/jaunt.png'),'fixture icon');}
 const payload=path.join(cache,mac?'desktop.zip':'desktop.tar.gz');
 if(mac)execFileSync('ditto',['-c','-k','--keepParent',appRoot,payload]);else execFileSync('tar',['-czf',payload,'-C',source,path.basename(appRoot)]);
 const data=path.join(root,'app-data/identity.fixture');await fs.writeFile(data,'saved-device-identity');
 const host=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});t.after(()=>host.kill());
 const plan={tag:'desktop-v0.1.0-beta.8',payload,digest:sha(await fs.readFile(payload)),kind:'archive',platform:process.platform,cache,executable:process.execPath,parent:99999999,reopen:false};
 const planFile=path.join(cache,'install-plan.json');await fs.writeFile(planFile,JSON.stringify(plan));
 execFileSync(process.execPath,[path.resolve('desktop/update-install.cjs'),planFile],{env:{...process.env,HOME:root},timeout:20000});
 const result=JSON.parse(await fs.readFile(path.join(cache,'result.json'),'utf8'));assert.equal(result.state,'installed',result.message);
 const installed=path.join(root,'.local/share/jaunt-desktop/current',mac?'jaunt.app/Contents/MacOS/jaunt':'jaunt-desktop');assert.equal(execFileSync(installed).toString(),'updated-desktop');
 assert.equal(await fs.readFile(data,'utf8'),'saved-device-identity');process.kill(host.pid,0);
});
test('desktop channels agree with the shared contract fixtures',()=>{
 assert.deepEqual({...channels.OFFICIAL},official);
 for(const name of contract.names.valid)assert(channels.validName(name),name);
 for(const name of contract.names.invalid)assert(!channels.validName(name),name);
 for(const name of contract.names.publishable)assert(channels.publishable(name),name);
 for(const name of contract.names.notPublishable)assert(!channels.publishable(name),name);
 for(const c of contract.tags.valid){const info=channels.parse(c.tag);assert.deepEqual([info.component,info.base,info.channel,info.n],[c.component,c.base,c.channel,c.n],c.tag);}
 for(const tag of contract.tags.invalid)assert.throws(()=>channels.parse(tag),tag);
 for(const tag of contract.tags.production)assert.equal(channels.parse(tag).channel,null,tag);
 for(const [low,high] of contract.order.ascending){assert.equal(channels.compare(low,high),-1);assert.equal(channels.compare(high,low),1);assert.equal(channels.compare(low,low),0);}
 for(const [a,b] of contract.order.notComparable)assert.throws(()=>channels.compare(a,b),channels.NotComparable);
 for(const c of contract.automatic)assert.equal(channels.automatic(c.channel,c.current,c.target),c.install,JSON.stringify(c));
 for(const c of contract.documents.valid)assert.equal(channels.validateDocument(structuredClone(c.document),c.name,official.page,official.repository).channel,c.name);
 for(const c of contract.documents.invalid){
  const document={...contract.documents.valid[0].document,...c.patch};for(const [k,v] of Object.entries(c.patch))if(v===null)delete document[k];
  assert.throws(()=>channels.validateDocument(document,c.name,official.page,official.repository),c.why);
 }
});
test('a channel installs only newer candidates of that channel, from the official Page',async t=>{
 const {updater,urls}=await fixture(t,{installed:'0.1.0-beta.33.ch.moukrea.9.1',preferences:{automatic:true,channel:'moukrea_9'},documents:{[channelURL]:channelDocument('desktop-v0.1.0-beta.33.ch.moukrea.9.2')}});
 assert.equal(updater.state.channel,'moukrea_9');await updater.check();
 assert.equal(updater.state.state,'ready');assert.equal(updater.plan.tag,'desktop-v0.1.0-beta.33.ch.moukrea.9.2');assert.equal(updater.plan.switch,false);
 assert(urls.includes(channelURL));assert(urls.every(u=>u.startsWith(official.page)||u.startsWith(`https://github.com/${official.repository}/releases/download/`)),urls.join('\n'));
 const other=await fixture(t,{installed:'0.1.0-beta.33.ch.moukrea.12.1',preferences:{channel:'moukrea_9'},documents:{[channelURL]:channelDocument('desktop-v0.1.0-beta.33.ch.moukrea.9.2')}});
 await other.updater.check();assert.equal(other.updater.state.state,'current');assert.match(other.updater.state.message,/not from channel moukrea_9/);assert.equal(other.updater.plan,undefined);
 const foreign=await fixture(t,{installed:'0.1.0-beta.33.ch.moukrea.9.1',preferences:{channel:'moukrea_9'},documents:{[channelURL]:{...channelDocument('desktop-v0.1.0-beta.33.ch.moukrea.9.2'),repository:'evil/jaunt'}}});
 await foreign.updater.check();assert.equal(foreign.updater.state.state,'error');assert.equal(foreign.updater.plan,undefined);
});
test('main never installs a candidate automatically and leaves a candidate for the next production release',async t=>{
 const {updater}=await fixture(t,{installed:'0.1.0-beta.8.ch.moukrea.9.3'});await updater.check();
 assert.equal(updater.state.state,'current');assert.equal(updater.plan,undefined);
 const next=await fixture(t,{installed:'0.1.0-beta.7.ch.moukrea.9.3'});await next.updater.check();assert.equal(next.updater.plan.tag,'desktop-v0.1.0-beta.8');
});
test('a removed channel keeps the installed version and offers main without switching',async t=>{
 const {updater,cache}=await fixture(t,{installed:'0.1.0-beta.33.ch.moukrea.9.1',preferences:{automatic:true,channel:'moukrea_9'}});await updater.check();
 assert.equal(updater.state.state,'channel-missing');assert.match(updater.state.message,/no longer exists/);assert.equal(updater.plan,undefined);
 assert.equal(JSON.parse(await fs.readFile(path.join(cache,'preferences.json'),'utf8')).channel,'moukrea_9');
});
test('only the explicit switch installs a target that is not newer, including a return to main',async t=>{
 const {updater,cache}=await fixture(t,{installed:'0.1.0-beta.33.ch.moukrea.9.2',preferences:{automatic:false,channel:'moukrea_9'}});
 const state=await updater.switchChannel('main');
 assert.equal(state.state,'ready');assert.equal(state.switch,true);assert.equal(updater.plan.tag,'desktop-v0.1.0-beta.8');assert.equal(updater.plan.switch,true);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(cache,'preferences.json'),'utf8')),{automatic:false,channel:'main'});
 const older=await fixture(t,{installed:'0.1.0-beta.33.ch.moukrea.9.2',documents:{[channelURL]:channelDocument('desktop-v0.1.0-beta.33.ch.moukrea.9.1')}});
 assert.equal((await older.updater.switchChannel('moukrea_9')).state,'ready');assert.equal(older.updater.plan.tag,'desktop-v0.1.0-beta.33.ch.moukrea.9.1');
 const same=await fixture(t,{installed:'0.1.0-beta.8'});assert.equal((await same.updater.switchChannel('main')).state,'current');assert(!same.updater.plan);
 for(const name of ['beta','moukrea','https://evil.test/','../main'])await assert.rejects(()=>updater.switchChannel(name),/Unknown update channel name/);
});
test('the channel menu reads the published list from the official Page only',async t=>{
 const index={version:1,page:official.page,repository:official.repository,channels:[{name:'moukrea_9',pr:9,n:2,title:'Fix things'}]};
 const {updater,urls}=await fixture(t,{documents:{[official.page+'ch/index.json']:index}});
 assert.deepEqual(await updater.channels(),index);assert.deepEqual(urls,[official.page+'ch/index.json']);
 const missing=await fixture(t);await assert.rejects(()=>missing.updater.channels(),/404/);
});
test('older preferences and invalid channels fall back to main',async t=>{
 assert.equal((await fixture(t,{preferences:{automatic:false}})).updater.state.channel,'main');
 const {updater,cache}=await fixture(t,{preferences:{automatic:true,channel:'../evil'}});assert.equal(updater.state.channel,'main');
 await updater.configure(false);assert.deepEqual(JSON.parse(await fs.readFile(path.join(cache,'preferences.json'),'utf8')),{automatic:false,channel:'main'});
});
test('the detached installer accepts candidates and lowers system packages only on a switch',async()=>{
 await assert.rejects(()=>install({tag:'desktop-v0.1.0-beta.33.ch.moukrea.9.2',payload:__filename,digest:'0'}),/checksum mismatch/);
 await assert.rejects(()=>install({tag:'desktop-v0.1.0-beta.33.ch.main.9.2',payload:__filename,digest:'0'}),/Invalid desktop update version/);
 assert.deepEqual(systemArguments('deb','/c/p.deb','install'),['install','-y','/c/p.deb']);
 assert.deepEqual(systemArguments('deb','/c/p.deb','downgrade'),['install','-y','--allow-downgrades','/c/p.deb']);
 assert.deepEqual(systemArguments('rpm','/c/p.rpm','downgrade'),['downgrade','-y','--setopt=localpkg_gpgcheck=0','/c/p.rpm']);
});
