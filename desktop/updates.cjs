const fs=require('node:fs/promises');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const {spawn}=require('node:child_process');
const MAX=350*1024*1024;
function version(value){
  const m=/^(?:desktop-v)?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(value);
  if(!m)throw new Error('Unsupported desktop version');
  return [+m[1],+m[2],+m[3],{alpha:0,beta:1,rc:2,undefined:3}[m[4]],+(m[5]||0)];
}
function newer(a,b){const x=version(a),y=version(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
function artifact(tag,platform,arch,kind){
  if(!['linux','darwin'].includes(platform))throw new Error('Desktop updates support Linux and macOS');
  version(tag);if(!tag.startsWith('desktop-v'))throw new Error('Invalid desktop tag');
  if(!['x64','arm64'].includes(arch))throw new Error('No desktop update for this CPU');
  const ext=platform==='darwin'?'zip':kind==='deb'?'deb':kind==='rpm'?'rpm':'tar.gz';
  const cpu=ext==='deb'&&arch==='x64'?'amd64':ext==='rpm'?(arch==='x64'?'x86_64':'aarch64'):arch;
  return `jaunt-desktop-${tag.slice(9)}-${cpu}.${ext}`;
}
class DesktopUpdates {
  constructor({app,fetch,emit=()=>{},platform=process.platform,arch=process.arch,kind,cache,spawnProcess=spawn}){
    Object.assign(this,{app,fetch,emit,platform,arch,kind,spawnProcess});
    this.cache=cache||join(app.getPath('userData'),'updates');
    this.state={state:'idle',currentVersion:app.getVersion(),automatic:true,message:'Checks automatically; installs when you close the desktop app.'};
  }
  publish(patch){Object.assign(this.state,patch);this.emit({...this.state});return {...this.state};}
  async init(){
    await fs.mkdir(this.cache,{recursive:true,mode:0o700});
    try{this.state.automatic=JSON.parse(await fs.readFile(join(this.cache,'preferences.json'),'utf8')).automatic!==false;}catch{}
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
    await fs.writeFile(join(this.cache,'preferences.json'),JSON.stringify({automatic}),{mode:0o600});
    this.publish({automatic});if(automatic)this.check().catch(()=>{});return this.state;
  }
  async response(url){
    const response=await this.fetch(url,{cache:'no-store',signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error(`Update download failed (${response.status})`);
    if(response.url&&!response.url.startsWith('https://'))throw new Error('Updates require HTTPS');
    return response;
  }
  async small(url){
    const response=await this.response(url);let length=0,parts=[];
    for await(const chunk of response.body){length+=chunk.length;if(length>65536)throw new Error('Invalid update metadata');parts.push(chunk);}
    return Buffer.concat(parts).toString('utf8');
  }
  async check(){
    if(this.busy)return this.busy;
    this.busy=this.performCheck().finally(()=>{this.busy=null;});return this.busy;
  }
  async performCheck(){
    try{
      if(!this.app.isPackaged){return this.publish({state:'current',message:'Desktop updates are disabled in a source checkout.'});}
      this.publish({state:'checking',message:'Checking desktop release…',percent:null});
      const config=JSON.parse(await this.small('https://moukrea.github.io/jaunt/config.json'));
      const tag=config.desktopRelease;
      if(!newer(tag,this.app.getVersion()))return this.publish({state:'current',message:`Desktop is up to date · ${this.app.getVersion()}`,percent:null});
      const name=artifact(tag,this.platform,this.arch,this.kind);
      const base=`https://github.com/moukrea/jaunt/releases/download/${tag}`;
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
      this.plan={tag,payload,digest,kind:this.kind||'archive',platform:this.platform,cache:this.cache,executable:this.app.getPath('exe'),userData:this.app.getPath('userData')};
      await fs.copyFile(join(__dirname,'update-install.cjs'),join(this.cache,'update-install.cjs'));
      return this.publish({state:'ready',target:tag,message:'Verified update ready · installs when you close jaunt. Shells stay running.',percent:100,requiresAuthorization:['deb','rpm'].includes(this.kind)});
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
module.exports={DesktopUpdates,version,newer,artifact,checksum};
