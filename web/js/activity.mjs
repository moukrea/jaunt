import {t as tr} from './i18n.mjs';
import {$,el,button,markReported} from './ui.mjs';
const items=new Map();let expanded=false,layout=null,scope=null;
// Kept notices: what outlived the strip. An operation that ended without needing anything
// disappears by itself; one that failed or is still waiting for you moves here instead, so the
// strip stays a live view of what is happening and nothing that matters is lost.
const notices=new Map();
let KEEP_MS=60_000;
export function activityKeepFor(ms){KEEP_MS=Math.max(50,ms|0);}
const matters=item=>!!(item.error||item.waiting||item.keep);
// Operations belong to a host (room) or to the app itself (room null). The strip shows the
// selected host's operations only, one at a time by importance; other hosts get a badge.
export function activity(id,title,room=null) {
  const item={id,title,room,status:tr('Starting…'),done:false,error:false,percent:null};
  items.set(id,item);
  const settle=()=>{
    clearTimeout(item.timer);
    if(!item.done&&!item.waiting)return;   // still running: it stays in the strip
    item.timer=setTimeout(()=>{
      if(!items.has(item.id))return;
      if(matters(item))notices.set(item.id,{id:item.id,title:item.title,status:item.status,room:item.room,error:!!item.error,at:Date.now(),action:item.action});
      items.delete(item.id);render();
    },KEEP_MS);
  };
  item.settle=settle;
  const update=patch=>{if(item.done && patch.done!==false && !('done' in patch)){patch={...patch};delete patch.status;delete patch.percent;}Object.assign(item,patch);settle();render();};
  const finish=status=>update({status,done:true,waiting:false,percent:100,action:null});
  const fail=error=>{markReported(error);if(error.name==='AbortError'||error.message==='Transfer cancelled'){finish(tr('Cancelled'));return;}update({status:tr(error.message || String(error)),done:true,error:true,percent:null,action:null});};
  render();return {update,finish,fail,item};
}
export function scopeActivity(room){if(scope===room)return;scope=room;expanded=false;render();}
// What is kept for a host (or for the app itself when room is null).
export function noticesFor(room){return [...notices.values()].filter(n=>n.room===room||(room===null&&!n.room)).sort((a,b)=>b.at-a.at);}
export function noticeCount(room){return noticesFor(room).length;}
export function dismissNotice(id){notices.delete(id);render();}
export function dismissNotices(room){for(const n of noticesFor(room))notices.delete(n.id);render();}
export function activityBadges(){
  const badges=new Map();
  for(const item of items.values()){if(!item.room||item.room===scope||(item.done&&!item.error&&!item.waiting))continue;const b=badges.get(item.room)||{count:0,error:false};b.count++;b.error||=!!item.error;badges.set(item.room,b);}
  // Kept notices count for their host wherever you are, including the one you are looking at.
  for(const notice of notices.values()){if(!notice.room)continue;const b=badges.get(notice.room)||{count:0,error:false};b.count++;b.error||=!!notice.error;badges.set(notice.room,b);}
  return badges;
}
const priority=i=>i.error?0:i.waiting?1:!i.done?2:3;
export function clearActivity(){for(const item of items.values())clearTimeout(item.timer);items.clear();notices.clear();expanded=false;layout=null;const root=$('activity');if(root){root.replaceChildren();root.hidden=true;}}
function render(){
  const root=$('activity');if(!root)return;
  while(items.size>30){const old=[...items].find(([,item])=>item.done&&!item.waiting&&!item.error);if(!old)break;items.delete(old[0]);}
  const scoped=[...items.values()].filter(i=>!i.room||i.room===scope).reverse();
  root.hidden=scoped.length===0;
  window.dispatchEvent(new Event('jaunt-activity'));
  if(!layout){
    const summary=el('span',{class:'activity-summary'}),toggle=button(tr('Show history'),()=>{expanded=!expanded;render();},'text-button');
    const list=el('div',{class:'activity-items'});root.replaceChildren(el('div',{class:'activity-heading'},summary,toggle),list);layout={summary,toggle,list};
  }
  const all=scoped,ongoing=all.filter(i=>!i.done),attention=all.filter(i=>i.error||i.waiting);
  const lead=[...all].sort((x,y)=>priority(x)-priority(y))[0];
  root.dataset.tone=lead?['error','waiting','running','done'][priority(lead)]:'';
  layout.summary.textContent=attention.length?tr(attention.length===1?'{0} operation needs attention':'{0} operations need attention',attention.length):ongoing.length?tr(ongoing.length===1?'{0} operation in progress':'{0} operations in progress',ongoing.length):tr('Activity');
  layout.toggle.textContent=expanded?tr('Hide history'):tr("Show history ({0})",all.length);layout.toggle.hidden=all.length<2;
  layout.toggle.setAttribute('aria-expanded',String(expanded));
  // Collapsed: only the most important operation, never a stack of rows.
  const visible=new Set(expanded?all:lead?[lead]:[]);
  const keep=new Set();
  for(const node of [...layout.list.children])if(!all.some(i=>i.row===node))node.remove();
  for(const [index,item] of all.entries()){
    if(!item.row){
      const status=el('span',{role:'status'}),progress=el('progress',{'aria-label':item.title+' progress',max:100});
      const action=button('',()=>item.action?.run(),'text-button'),dismiss=button(tr('Dismiss'),()=>{item.dismissed=true;items.delete(item.id);render();},'text-button');
      item.row=el('div',{class:'activity-row'},el('div',{class:'activity-description'},el('strong',{text:item.title}),status),progress,action,dismiss);
      item.elements={status,progress,action,dismiss};
    }
    const {status,progress,action,dismiss}=item.elements,row=item.row;
    if(status.textContent!==item.status)status.textContent=item.status;
    row.dataset.state=item.error?'error':item.waiting?'waiting':item.done?'done':'running';row.classList.toggle('error',!!item.error);row.hidden=!visible.has(item);
    progress.hidden=!!item.done;if(item.percent===null)progress.removeAttribute('value');else progress.value=item.percent;
    action.hidden=!item.action;if(item.action && action.textContent!==item.action.label)action.textContent=item.action.label;
    dismiss.hidden=!item.done;
    keep.add(row);if(layout.list.children[index]!==row)layout.list.insertBefore(row,layout.list.children[index]||null);
  }
  for(const node of [...layout.list.children])if(!keep.has(node))node.remove();
}
