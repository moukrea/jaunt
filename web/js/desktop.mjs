import {t as tr} from './i18n.mjs';
import {Link,ConnectionInterrupted} from './link.mjs';
export const desktop = window.jauntDesktop;
export class LocalLink extends EventTarget {
  constructor(machine) {
    super(); this.machine=machine; this.state='offline'; this.generation=0; this.pending=new Map(); this.enabled=false; this.lastSeen=Date.now(); this.expectRestart=false;
    desktop.onFrame(frame => {
      if (!this.enabled) return;
      this.lastSeen=Date.now();
      if (frame.type==='welcome') { this.bridgeFailures=0; this.status('online'); this.emit('welcome',frame); }
      else if (frame.type==='reply') { const p=this.pending.get(frame.id); if(p){clearTimeout(p.timer);this.pending.delete(frame.id);frame.ok?p.resolve(frame.result):p.reject(new Error(frame.error));} }
      else if(frame.type==='bridge.closed') {
        this.rejectPending();clearTimeout(this.timer);
        // An in-place host update closes the bridge for a moment; reconnect
        // quickly and say so instead of reporting a missing host.
        if(this.expectRestart){this.status('reconnecting',tr('The host is restarting to finish its update. Reconnecting automatically.'));this.timer=setTimeout(()=>{if(this.enabled)this.start();},1000);}
        else{
          // A closed bridge is usually the host replacing itself or restarting; say "reconnecting" first
          // and only speak of an unavailable host after several failed attempts.
          this.bridgeFailures=(this.bridgeFailures||0)+1;
          if(this.bridgeFailures<4)this.status('reconnecting',tr('Reconnecting to the local host…'));
          else this.status('offline',tr('Local host is unavailable or needs an update. Open Settings → Local.'));
          this.timer=setTimeout(()=>{if(this.enabled)this.start();},this.bridgeFailures<4?2000:5000);
        }
      }
      else this.emit('message',frame);
    });
  }
  emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
  status(state,message=''){this.state=state;this.message=message;this.emit('status',{state,message});}
  async start(){clearTimeout(this.timer);this.enabled=true;const generation=++this.generation;this.rejectPending();this.status('connecting');try{await desktop.connect();}catch(e){if(generation!==this.generation || !this.enabled)return;this.status('reconnecting',this.expectRestart?tr('The host is restarting to finish its update. Reconnecting automatically.'):tr('Local host unavailable. Retrying automatically.'));this.timer=setTimeout(()=>{if(this.enabled)this.start();},this.expectRestart?1500:5000);}}
  stop(){clearTimeout(this.timer);this.enabled=false;this.generation++;this.rejectPending();desktop.disconnect();this.status('offline');}
  reconnect(){if(this.enabled)this.start();}
  rejectPending(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new ConnectionInterrupted('Connection interrupted; input was not replayed.'));}this.pending.clear();}
  send(value){if(this.state!=='online')return Promise.reject(new ConnectionInterrupted('Local host is offline.'));return desktop.send(value);}
  waitOnline(signal){return Link.prototype.waitOnline.call(this,signal);}
  request(...args){return Link.prototype.request.apply(this,args);}
}
