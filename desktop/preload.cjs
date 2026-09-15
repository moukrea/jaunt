const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('jauntDesktop',Object.freeze({
  connect:()=>ipcRenderer.invoke('host.connect'),
  disconnect:()=>ipcRenderer.invoke('host.disconnect'),
  send:frame=>ipcRenderer.invoke('host.send',frame),
  action:name=>ipcRenderer.invoke('host.action',name),
  updates:(action,value)=>ipcRenderer.invoke('desktop.updates',action,value),
  notify:data=>ipcRenderer.invoke('desktop.notify',data),
  onFrame:callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('host.frame',listener);return()=>ipcRenderer.removeListener('host.frame',listener);}
}));
