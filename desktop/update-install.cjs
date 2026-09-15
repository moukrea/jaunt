// Detached installer: it never invokes the host CLI, service manager, or PTY APIs.
const fs=require('node:fs/promises');
const {createReadStream}=require('node:fs');
const {join,dirname,resolve,sep,isAbsolute}=require('node:path');
const {homedir}=require('node:os');
const {createHash}=require('node:crypto');
const {execFile,spawn}=require('node:child_process');
const execute=require('node:util').promisify(execFile);
async function digest(path){const hash=createHash('sha256');for await(const part of createReadStream(path))hash.update(part);return hash.digest('hex');}
async function command(binary){try{await execute('/usr/bin/which',[binary]);return true;}catch{return false;}}
function safeNames(output){for(const name of output.split('\n').filter(Boolean)){if(isAbsolute(name)||name.split('/').includes('..'))throw new Error('Unsafe desktop archive path');}}
async function install(plan){
  if(!/^desktop-v\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(plan.tag))throw new Error('Invalid desktop update version');
  if(await digest(plan.payload)!==plan.digest)throw new Error('Desktop checksum mismatch');
  let binary;
  if(['deb','rpm'].includes(plan.kind)){
    const manager=plan.kind==='deb'?'/usr/bin/apt-get':'/usr/bin/dnf';
    if(!await command(manager))throw new Error(`The system package manager ${manager} is unavailable`);
    const args=plan.kind==='deb'?['install','-y',plan.payload]:['install','-y','--setopt=localpkg_gpgcheck=0',plan.payload];
    if(process.getuid?.()===0)await execute(manager,args,{timeout:600000,maxBuffer:1000000});
    else {if(!await command('pkexec'))throw new Error('System installation needs a graphical authorization agent (pkexec).');await execute('/usr/bin/pkexec',[manager,...args],{timeout:600000,maxBuffer:1000000});}
    binary='/usr/bin/jaunt-desktop';
  }else{
    const root=join(homedir(),'.local/share/jaunt-desktop');await fs.mkdir(root,{recursive:true});
    const stage=await fs.mkdtemp(join(root,'.update-'));
    const destination=join(root,plan.tag);
    try{
      if(plan.platform==='linux'){
        const listing=await execute('tar',['-tzf',plan.payload],{maxBuffer:8000000});safeNames(listing.stdout);
        await execute('tar',['-xzf',plan.payload,'--no-same-owner','-C',stage],{timeout:120000});
        const entries=await fs.readdir(stage);if(entries.length!==1)throw new Error('Unexpected desktop archive layout');
        const extracted=join(stage,entries[0]);await fs.access(join(extracted,'jaunt-desktop'));
        try{await fs.rename(extracted,destination);}catch(error){if(error.code!=='EEXIST'&&error.code!=='ENOTEMPTY')throw error;await fs.access(join(destination,'jaunt-desktop'));}
        binary=join(root,'current/jaunt-desktop');
      }else if(plan.platform==='darwin'){
        const listing=await execute('unzip',['-Z','-1',plan.payload],{maxBuffer:8000000});safeNames(listing.stdout);
        await execute('ditto',['-x','-k',plan.payload,stage],{timeout:120000});await fs.access(join(stage,'jaunt.app/Contents/MacOS/jaunt'));
        try{await fs.rename(stage,destination);}catch(error){if(error.code!=='EEXIST'&&error.code!=='ENOTEMPTY')throw error;await fs.access(join(destination,'jaunt.app/Contents/MacOS/jaunt'));}
        binary=join(root,'current/jaunt.app/Contents/MacOS/jaunt');
      }else throw new Error('Unsupported desktop operating system');
      const pointer=join(root,'current.new');await fs.rm(pointer,{force:true});await fs.symlink(destination,pointer);await fs.rename(pointer,join(root,'current'));
      if(plan.platform==='linux'){
        const icon=join(root,'icon.png');await fs.copyFile(join(destination,'resources/jaunt.png'),icon);await fs.chmod(icon,0o644);
        const apps=join(homedir(),'.local/share/applications');await fs.mkdir(apps,{recursive:true});
        const quoted=binary.replace(/%/g,'%%').replace(/[\\"`$]/g,'\\$&');
        await fs.writeFile(join(apps,'dev.jaunt.desktop.desktop'),`[Desktop Entry]\nType=Application\nName=jaunt\nExec="${quoted}"\nIcon=${icon}\nTerminal=false\nCategories=System;TerminalEmulator;\nStartupWMClass=jaunt\n`,{mode:0o644});
      }else{
        const apps=join(homedir(),'Applications');await fs.mkdir(apps,{recursive:true});const shortcut=join(apps,'jaunt.app');
        try{const stat=await fs.lstat(shortcut);if(stat.isSymbolicLink())await fs.unlink(shortcut);}catch{}
        try{await fs.symlink(join(root,'current/jaunt.app'),shortcut);}catch(error){if(error.code!=='EEXIST')throw error;}
        const suffix='/Contents/MacOS/jaunt';
        const bundle=plan.executable.endsWith(suffix)?plan.executable.slice(0,-suffix.length):'';
        if(bundle.endsWith('/jaunt.app')&&!bundle.startsWith(root+sep)&&!bundle.startsWith('/Volumes/')){
          const backup=bundle+'.previous-'+Date.now(),target=join(root,'current/jaunt.app');
          try{await fs.rename(bundle,backup);try{await fs.symlink(target,bundle);}catch(error){await fs.rename(backup,bundle);throw error;}}
          catch(error){
            if(!['EACCES','EPERM'].includes(error.code))throw error;
            const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
            const script='/bin/mv '+quote(bundle)+' '+quote(backup)+' && (/bin/ln -s '+quote(target)+' '+quote(bundle)+' || (/bin/mv '+quote(backup)+' '+quote(bundle)+'; exit 1))';
            await execute('/usr/bin/osascript',['-e','do shell script '+JSON.stringify(script)+' with administrator privileges'],{timeout:600000});
          }
        }
      }
    }finally{await fs.rm(stage,{recursive:true,force:true});}
  }
  return binary;
}
async function main(file){
  const plan=JSON.parse(await fs.readFile(file,'utf8'));
  if(resolve(plan.cache)!==dirname(resolve(file))||!resolve(plan.payload).startsWith(resolve(plan.cache)+sep))throw new Error('Invalid update cache');
  try{
    for(let i=0;i<300;i++){try{process.kill(plan.parent,0);}catch{break;}if(i===299)throw new Error('Desktop app did not close; update deferred');await new Promise(r=>setTimeout(r,200));}
    const binary=await install(plan);
    await fs.writeFile(join(plan.cache,'result.json'),JSON.stringify({state:'installed',message:`Desktop update installed · ${plan.tag}`}),{mode:0o600});
    if(plan.reopen){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;spawn(binary,[...(plan.userData?['--user-data-dir='+plan.userData]:[]),...(plan.debugPort?['--remote-debugging-port='+plan.debugPort]:[])],{env,detached:true,stdio:'ignore'}).unref();}
  }catch(error){
    await fs.writeFile(join(plan.cache,'result.json'),JSON.stringify({state:'error',message:'Desktop installation failed. '+String(error.message).slice(0,300)}),{mode:0o600});
    if(plan.reopen){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;spawn(plan.executable,[...(plan.userData?['--user-data-dir='+plan.userData]:[]),...(plan.debugPort?['--remote-debugging-port='+plan.debugPort]:[])],{env,detached:true,stdio:'ignore'}).unref();}
  }
}
if(require.main===module)main(process.argv[2]).catch(()=>{process.exitCode=1;});
module.exports={install,safeNames};
