const {contextBridge,ipcRenderer}=require('electron');
const invoke=(...args)=>ipcRenderer.invoke(...args).catch(error=>{throw new Error(error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));});
contextBridge.exposeInMainWorld('jauntDesktop',Object.freeze({
  capabilities:()=>invoke('host.capabilities'),
  setLanguage:value=>invoke('app.language',value),
  connect:()=>invoke('host.connect'),
  disconnect:()=>invoke('host.disconnect'),
  send:frame=>invoke('host.send',frame),
  action:name=>invoke('host.action',name),
  updates:(action,value)=>invoke('desktop.updates',action,value),
  notify:data=>invoke('desktop.notify',data),
  onFrame:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('host.frame',listener);return()=>ipcRenderer.removeListener('host.frame',listener);}
}));
