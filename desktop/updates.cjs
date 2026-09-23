const fs=require('node:fs/promises');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const channels=require('./channels.cjs');
const {OFFICIAL}=channels;
const MAX=350*1024*1024;
const MISSING='This update channel no longer exists. The installed version is kept; switch back to main to follow production.';
// A desktop release tag, or the running app's version, parsed by the channel contract.
function version(value){
  const info=channels.parse(String(value).startsWith('desktop-v')?value:'desktop-v'+value);
  if(info.component!=='desktop')throw new Error('Unsupported desktop version');
  return info;
}
const tagOf=value=>String(value).startsWith('desktop-v')?value:'desktop-v'+value;
const knownChannel=name=>name==='main'||channels.publishable(name);
function artifact(tag,platform,arch,kind){
  if(!['linux','darwin'].includes(platform))throw new Error('Desktop updates support Linux and macOS');
  if(!String(tag).startsWith('desktop-v'))throw new Error('Invalid desktop tag');version(tag);
  if(!['x64','arm64'].includes(arch))throw new Error('No desktop update for this CPU');
  const ext=platform==='darwin'?'zip':kind==='deb'?'deb':kind==='rpm'?'rpm':'tar.gz';
  const cpu=ext==='deb'&&arch==='x64'?'amd64':ext==='rpm'?(arch==='x64'?'x86_64':'aarch64'):arch;
  return `jaunt-desktop-${tag.slice(9)}-${cpu}.${ext}`;
}
class DesktopUpdates {
  constructor({app,fetch,emit=()=>{},platform=process.platform,arch=process.arch,kind,cache,spawnProcess=spawn}){
    Object.assign(this,{app,fetch,emit,platform,arch,kind,spawnProcess});
    this.cache=cache||join(app.getPath('userData'),'updates');
    this.state={state:'idle',currentVersion:app.getVersion(),automatic:true,channel:'main',message:'Checks automatically; installs when you close the desktop app.'};
  }
  publish(patch){Object.assign(this.state,patch);this.emit({...this.state});return {...this.state};}
  async init(){
    await fs.mkdir(this.cache,{recursive:true,mode:0o700});
    try{
      const preferences=JSON.parse(await fs.readFile(join(this.cache,'preferences.json'),'utf8'));
      this.state.automatic=preferences.automatic!==false;
      if(knownChannel(preferences.channel))this.state.channel=preferences.channel;
    }catch{}
    try{const result=JSON.parse(await fs.readFile(join(this.cache,'result.json'),'utf8'));this.publish(result);}catch{}
    if(!this.kind && this.platform==='linux'){
      const systemInstall=this.app.getPath('exe').startsWith('/opt/jaunt/');
      if(systemInstall){
        try{await fs.access('/etc/debian_version');this.kind='deb';}catch{this.kind='rpm';}
      }else{
        try{if((await fs.readFile('/proc/sys/kernel/apparmor_restrict_unprivileged_userns','utf8')).trim()==='1')this.kind='deb';}catch{}
      }
    }
    this.publish({});
  }
  async configure(automatic){
    if(typeof automatic!=='boolean')throw new Error('Invalid update preference');
    await this.save({automatic,channel:this.state.channel});
    this.publish({automatic});if(automatic)this.check().catch(()=>{});return this.state;
  }
  async save(preferences){await fs.writeFile(join(this.cache,'preferences.json'),JSON.stringify(preferences),{mode:0o600});}
  // The explicit switch: the only path that installs a target that is not newer, including a return to main.
  async switchChannel(channel){
    if(!knownChannel(channel))throw new Error('Unknown update channel name');
    await this.save({automatic:this.state.automatic,channel});
    // A check already running reads the previous channel; the switch starts after it, never shares its result.
    while(this.busy)await this.busy.catch(()=>{});
    this.plan=null;this.publish({channel,target:null});
    return this.check(true,true);
  }
  // main reads the production document; a channel reads its own, validated against the official Page and repository.
  async release(){
    const channel=this.state.channel;
    if(channel==='main')return JSON.parse(await this.small(OFFICIAL.page+'config.json')).desktopRelease;
    let document;
    try{document=JSON.parse(await this.small(`${OFFICIAL.page}ch/${channel}/config.json`));}
    catch(error){if(error.status===404)return null;throw error;}
    return channels.validateDocument(document,channel).desktopRelease;
  }
  // The published channel list offered by the channel menu. The renderer validates it (web/js/channels.mjs);
  // choosing a name still goes through switchChannel, which validates that channel's own document.
  async channels(){return JSON.parse(await this.small(OFFICIAL.page+'ch/index.json',1048576));}
  async response(url){
    const response=await this.fetch(url,{cache:'no-store',signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw Object.assign(new Error(`Update download failed (${response.status})`),{status:response.status});
    if(response.url&&!response.url.startsWith('https://'))throw new Error('Updates require HTTPS');
    return response;
  }
  async small(url,limit=65536){
    const response=await this.response(url);let length=0,parts=[];
    for await(const chunk of response.body){length+=chunk.length;if(length>limit)throw new Error('Invalid update metadata');parts.push(chunk);}
    return Buffer.concat(parts).toString('utf8');
  }
  async check(download=true,explicit=false){
    if(this.busy)return this.busy;
    this.busy=this.performCheck(download,explicit).finally(()=>{this.busy=null;});return this.busy;
  }
  async performCheck(download=true,explicit=false){
    try{
      if(!this.app.isPackaged){return this.publish({state:'current',message:'Desktop updates are disabled in a source checkout.'});}
      this.publish({state:'checking',message:'Checking desktop release…',percent:null});
      const tag=await this.release(),channel=this.state.channel,current=tagOf(this.app.getVersion());
      // A removed channel keeps the installed version; only the person switches back to main.
      if(tag===null)return this.publish({state:'channel-missing',message:MISSING,target:null,percent:null});
      version(tag);
      if(explicit?tag===current:!channels.automatic(channel,current,tag)){
        const foreign=channel!=='main'&&version(current).channel!==channel;
        return this.publish({state:'current',message:foreign?`Desktop ${this.app.getVersion()} is not from channel ${channel} · change the channel again to install it`:`Desktop is up to date · ${this.app.getVersion()}`,percent:null});
      }
      // Automatic updates off: only announce the newer version; the user decides whether to download it.
      if(!explicit&&!download&&this.state.state!=='ready')return this.publish({state:'available',target:tag,message:`Desktop ${tag.replace(/^desktop-v/,'')} is available · you have ${this.app.getVersion()}`,percent:null});
      const name=artifact(tag,this.platform,this.arch,this.kind);
      const base=`https://github.com/${OFFICIAL.repository}/releases/download/${tag}`;
      const checks=await this.small(base+'/SHA256SUMS');
      const row=checks.split('\n').find(line=>line.endsWith('  '+name));
      const digest=row?.split('  ')[0];if(!/^[a-f0-9]{64}$/.test(digest||''))throw new Error('Desktop checksum is missing');
      const payload=join(this.cache,name);
      let verified=false;
      try{verified=await checksum(payload)===digest;}catch{}
      if(!verified){
        this.publish({state:'downloading',target:tag,message:'Downloading desktop update…',percent:0});
        const response=await this.response(base+'/'+name),total=Number(response.headers.get('content-length'));
        const out=await fs.open(payload+'.part','w',0o600);const hash=createHash('sha256');let bytes=0;
        try{
          for await(const chunk of response.body){bytes+=chunk.length;if(bytes>MAX)throw new Error('Desktop update is too large');hash.update(chunk);await out.writeFile(chunk);this.publish({message:`Downloading desktop update · ${Math.round(bytes/1048576)} MiB${total?' / '+Math.round(total/1048576)+' MiB':''}`,percent:total?Math.min(100,Math.floor(bytes/total*100)):null});}
        }finally{await out.close();}
        this.publish({state:'verifying',message:'Verifying desktop checksum…',percent:null});
        if(hash.digest('hex')!==digest){await fs.unlink(payload+'.part');throw new Error('Desktop checksum mismatch; update rejected');}
        await fs.rename(payload+'.part',payload);
      }
      this.plan={tag,payload,digest,switch:explicit,kind:this.kind||'archive',platform:this.platform,cache:this.cache,executable:this.app.getPath('exe'),userData:this.app.getPath('userData')};
      await fs.copyFile(join(__dirname,'update-install.cjs'),join(this.cache,'update-install.cjs'));
      return this.publish({state:'ready',target:tag,switch:explicit,message:'Verified update ready · installs when you close jaunt. Shells stay running.',percent:100,requiresAuthorization:['deb','rpm'].includes(this.kind)});
    }catch(error){return this.publish({state:'error',message:error.message,percent:null});}
  }
  async install(reopen=false){
    if(!this.plan || this.state.state!=='ready')throw new Error('No verified desktop update is ready');
    if(await checksum(this.plan.payload)!==this.plan.digest)throw new Error('Cached desktop update changed; check again');
    await fs.rm(join(this.cache,'result.json'),{force:true});
    const planFile=join(this.cache,'install-plan.json');
    await fs.writeFile(planFile,JSON.stringify({...this.plan,reopen,parent:process.pid}),{mode:0o600});
    const child=this.spawnProcess(this.app.getPath('exe'),[join(this.cache,'update-install.cjs'),planFile],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},detached:true,stdio:'ignore'});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
    this.publish({state:'installing',message:'Installing desktop update. Shells remain on the host.'});
  }
}
async function checksum(path){const h=createHash('sha256');const stream=require('node:fs').createReadStream(path);let bytes=0;for await(const part of stream){bytes+=part.length;if(bytes>MAX)throw new Error('Desktop update is too large');h.update(part);}return h.digest('hex');}
module.exports={DesktopUpdates,version,artifact,checksum};
