import {Link} from './link.mjs';
export const desktop = window.jauntDesktop;
export class LocalLink extends EventTarget {
  constructor(machine) {
    super(); this.machine=machine; this.state='offline'; this.generation=0; this.pending=new Map(); this.enabled=false; this.lastSeen=Date.now();
    desktop.onFrame(frame => {
      if (!this.enabled) return;
      this.lastSeen=Date.now();
      if (frame.type==='welcome') { this.status('online'); this.emit('welcome',frame); }
      else if (frame.type==='reply') { const p=this.pending.get(frame.id); if(p){clearTimeout(p.timer);this.pending.delete(frame.id);frame.ok?p.resolve(frame.result):p.reject(new Error(frame.error));} }
      else if(frame.type==='bridge.closed') {this.rejectPending();this.status('offline','Local host is unavailable or needs an update. Open Settings → This computer.');clearTimeout(this.timer);this.timer=setTimeout(()=>{if(this.enabled)this.start();},5000);}
      else this.emit('message',frame);
    });
  }
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  status(state,message=''){this.state=state;this.message=message;this.emit('status',{state,message});}
  async start(){clearTimeout(this.timer);this.enabled=true;this.generation++;this.rejectPending();this.status('connecting');try{await desktop.connect();}catch(e){this.status('offline',e.message);}}
  stop(){clearTimeout(this.timer);this.enabled=false;this.generation++;this.rejectPending();desktop.disconnect();this.status('offline');}
  reconnect(){if(this.enabled)this.start();}
  rejectPending(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Connection interrupted; input was not replayed.'));}this.pending.clear();}
  send(value){if(this.state!=='online')return Promise.reject(new Error('Local host is offline.'));return desktop.send(value);}
  waitOnline(signal){return Link.prototype.waitOnline.call(this,signal);}
  request(...args){return Link.prototype.request.apply(this,args);}
}
