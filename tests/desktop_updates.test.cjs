const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const {DesktopUpdates,artifact,newer}=require('../desktop/updates.cjs');
const {safeNames}=require('../desktop/update-install.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('desktop release selection uses the platform asset and never downgrades',()=>{
 assert(newer('desktop-v0.1.0-beta.10','0.1.0-beta.9'));
 assert(!newer('desktop-v0.1.0-beta.8','0.1.0-beta.9'));
 assert.equal(artifact('desktop-v0.1.0-beta.8','linux','x64','deb'),'jaunt-desktop-0.1.0-beta.8-amd64.deb');
 assert.equal(artifact('desktop-v0.1.0-beta.8','linux','arm64','rpm'),'jaunt-desktop-0.1.0-beta.8-aarch64.rpm');
 assert.throws(()=>artifact('desktop-v0.1.0-beta.8','linux','unknown','deb'));
 assert.throws(()=>safeNames('../private\n'));assert.throws(()=>safeNames('/private\n'));
});
async function fixture(t,{tamper=false,current=false}={}){
 const cache=await fs.mkdtemp(path.join(os.tmpdir(),'jaunt-updater-'));t.after(()=>fs.rm(cache,{recursive:true,force:true}));
 const bytes=Buffer.from('verified desktop bytes'),states=[];
 const app={isPackaged:true,getVersion:()=>current?'0.1.0-beta.8':'0.1.0-beta.7',getPath:name=>name==='exe'?process.execPath:cache};
 const fetch=async url=>{
  if(url.endsWith('config.json'))return new Response(JSON.stringify({desktopRelease:'desktop-v0.1.0-beta.8'}));
  if(url.endsWith('SHA256SUMS'))return new Response(sha(bytes)+'  jaunt-desktop-0.1.0-beta.8-x64.tar.gz\n');
  return new Response(tamper?Buffer.from('tampered'):bytes,{headers:{'content-length':String(bytes.length)}});
 };
 const updater=new DesktopUpdates({app,fetch,emit:s=>states.push({...s}),platform:'linux',arch:'x64',kind:'archive',cache});await updater.init();return {updater,states,cache};
}
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
