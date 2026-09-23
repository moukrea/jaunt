const {app,BrowserWindow,protocol,net,ipcMain,shell,Notification}=require('electron');
const {spawn,execFile,spawnSync}=require('node:child_process');
const {join,resolve,sep}=require('node:path');
const {pathToFileURL}=require('node:url');
const {homedir}=require('node:os');
const {existsSync}=require('node:fs');
const {createInterface}=require('node:readline');
const {promisify}=require('node:util');
const execute=promisify(execFile);
const {language}=require('./i18n.cjs');
app.setName('jaunt');
if(process.platform==='linux')app.commandLine.appendSwitch('class','jaunt');
protocol.registerSchemesAsPrivileged([{scheme:'jaunt',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
if(!app.requestSingleInstanceLock())app.quit();
let win,bridge,updates,installingDesktop=false,bridgeGeneration=0;
const {DesktopUpdates}=require('./updates.cjs');
const sendFrame=(channel,value)=>{if(win&&!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send(channel,value);};
const executable=()=>process.env.jaunt_host_executable || (existsSync(join(homedir(),'.local/bin/jaunt'))?join(homedir(),'.local/bin/jaunt'):'jaunt');
function localHostAvailable(){
  try{if(JSON.parse(require('node:fs').readFileSync(join(process.env.jaunt_DESKTOP_ROOT||join(homedir(),'.local/share/jaunt-desktop'),'mode.json'),'utf8')).clientOnly)return false;}catch{}
  const exe=executable();return exe.includes('/')?existsSync(exe):spawnSync('which',[exe],{stdio:'ignore'}).status===0;
}
function requireLocalHost(){if(!localHostAvailable())throw new Error('This desktop installation is a remote client only.');}
const allowed=e=>{if(e.sender!==win?.webContents||e.senderFrame!==win.webContents.mainFrame||!e.senderFrame.url.startsWith('jaunt://app/'))throw new Error('Untrusted frame');};
function disconnect(){bridgeGeneration++;bridge?.kill();bridge=null;}
function connect(){
  disconnect();
  const child=spawn(executable(),['desktop-bridge'],{env:{...process.env,jaunt_LANGUAGE:language(app)},stdio:['pipe','pipe','pipe']});bridge=child;
  createInterface({input:child.stdout}).on('line',line=>{if(bridge!==child||line.length>7000000)return;try{sendFrame('host.frame',JSON.parse(line));}catch{disconnect();}});
  child.stderr.resume(); // Never forward private host logs into renderer or public diagnostics.
  const closed=()=>{if(bridge===child){bridge=null;sendFrame('host.frame',{type:'bridge.closed'});}};
  child.on('error',closed);child.on('exit',closed);
}
app.whenReady().then(async()=>{
  const root=resolve(__dirname,'../web');
  protocol.handle('jaunt',request=>{
    const url=new URL(request.url), file=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(url.host!=='app'||!file.startsWith(root+sep))return new Response('Forbidden',{status:403});
    return net.fetch(pathToFileURL(file).href);
  });
  win=new BrowserWindow({width:1280,height:840,minWidth:380,minHeight:360,title:'jaunt',icon:app.isPackaged?join(process.resourcesPath,'jaunt.png'):join(root,'assets/jaunt.png'),backgroundColor:'#121314',webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.on('page-title-updated',event=>{event.preventDefault();win.setTitle('jaunt');});
  ipcMain.handle('app.language',async(e,value)=>{allowed(e);if(!['system','en','fr','es','it','pt','de'].includes(value))throw Error('Unsupported language');require('node:fs').writeFileSync(join(app.getPath('userData'),'language.json'),JSON.stringify({language:value}));});
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('jaunt://app/')){event.preventDefault();if(/^https?:\/\//.test(url))shell.openExternal(url);}});
  win.webContents.session.setPermissionRequestHandler((_wc,permission,callback)=>callback(['clipboard-sanitized-write','notifications'].includes(permission)||(permission==='clipboard-read'&&win.isFocused())));
  ipcMain.handle('host.capabilities',e=>{allowed(e);return {localHost:localHostAvailable()};});
  ipcMain.handle('host.connect',async e=>{allowed(e);requireLocalHost();const generation=++bridgeGeneration;try{await execute(executable(),['start'],{timeout:15000,maxBuffer:65536});}catch{}if(generation===bridgeGeneration)connect();});
  ipcMain.handle('host.disconnect',e=>{allowed(e);disconnect();});
  ipcMain.handle('host.send',async(e,frame)=>{allowed(e);requireLocalHost();const data=JSON.stringify(frame);if(data.length>200000||!bridge)throw new Error('Host connection unavailable');await new Promise((resolve,reject)=>bridge.stdin.write(data+'\n',err=>err?reject(err):resolve()));});
  ipcMain.handle('host.action',async(e,name)=>{
    allowed(e);requireLocalHost();
    const commands={start:['start'],update:['update'],restart:['update','--allow-restart'],service:['service','install'],status:['status'],pair:['pair','--json','--qr-svg']};
    if(!commands[name])throw new Error('Unknown host action');
    let result;try{result=await execute(executable(),commands[name],{env:{...process.env,jaunt_LANGUAGE:language(app)},timeout:45000,maxBuffer:1000000});}catch(error){throw new Error(require('./host-errors.cjs').hostError(error));}
    return ['status','pair','update','restart'].includes(name)?JSON.parse(result.stdout):{message:result.stdout.trim()};
  });
  ipcMain.handle('desktop.notify',(e,data)=>{allowed(e);if(win.isFocused()||!Notification.isSupported())return;const notice=new Notification({title:String(data.title||'jaunt').slice(0,100),body:String(data.body||'').slice(0,400),icon:app.isPackaged?join(process.resourcesPath,'jaunt.png'):join(root,'assets/jaunt.png')});notice.on('click',()=>{win.show();win.focus();win.webContents.send('host.frame',{type:'desktop.open',session:String(data.session||'').slice(0,80),host:String(data.host||'').slice(0,80)});});notice.show();});
  updates=new DesktopUpdates({app,fetch:(...args)=>net.fetch(...args),emit:value=>sendFrame('host.frame',{type:'desktop.update',...value})});
  try{await updates.init();}catch(error){updates.publish({state:'error',message:error.message});}
  ipcMain.handle('desktop.updates',async(e,action,value)=>{
    allowed(e);
    if(action==='status')return {...updates.state};
    if(action==='configure')return updates.configure(value);
    if(action==='check')return updates.check(value!==false);
    if(action==='channels')return updates.channels();
    // Changing the channel is the explicit switch: its release is installed at once, then the app reopens.
    if(action==='switch'){
      const state=await updates.switchChannel(value);
      if(state.state==='ready'){await updates.install(true);installingDesktop=true;setImmediate(()=>app.exit());}
      return updates.state;
    }
    if(action==='install'){
      await updates.install(true);installingDesktop=true;setImmediate(()=>app.exit());return updates.state;
    }
    throw new Error('Unknown desktop update action');
  });
  if(app.isPackaged){
    const check=()=>{if(updates.state.automatic&&!installingDesktop)updates.check().catch(()=>{});};
    // Every launch checks the published version (downloading only when automatic updates are on); the periodic check stays automatic-only.
    setTimeout(()=>{if(!installingDesktop)updates.check(updates.state.automatic).catch(()=>{});},3000).unref();setInterval(check,15*60*1000).unref();
  }
  win.loadURL('jaunt://app/');
});
app.on('second-instance',()=>{win?.show();win?.focus();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
  if(!installingDesktop&&updates?.state.state==='ready'&&updates.state.automatic){
    event.preventDefault();installingDesktop=true;
    updates.install(false).then(()=>app.exit()).catch(error=>{installingDesktop=false;updates.publish({state:'error',message:error.message});app.exit();});
  }
  disconnect();
});
