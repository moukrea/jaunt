import {t as tr} from './i18n.mjs';
import {$,el,button,markReported} from './ui.mjs';
const items=new Map();let expanded=false,layout=null,scope=null;
// Operations belong to a host (room) or to the app itself (room null). The strip shows the
// selected host's operations only, one at a time by importance; other hosts get a badge.
export function activity(id,title,room=null) {
  const item={id,title,room,status:tr('Starting…'),done:false,error:false,percent:null};
  items.set(id,item);
  const update=patch=>{if(item.done && patch.done!==false && !('done' in patch)){patch={...patch};delete patch.status;delete patch.percent;}Object.assign(item,patch);render();};
  const finish=status=>update({status,done:true,waiting:false,percent:100,action:null});
  const fail=error=>{markReported(error);if(error.name==='AbortError'||error.message==='Transfer cancelled'){finish(tr('Cancelled'));return;}update({status:tr(error.message || String(error)),done:true,error:true,percent:null,action:null});};
  render();return {update,finish,fail,item};
}
export function scopeActivity(room){if(scope===room)return;scope=room;expanded=false;render();}
export function activityBadges(){
  const badges=new Map();
  for(const item of items.values()){if(!item.room||item.room===scope||(item.done&&!item.error&&!item.waiting))continue;const b=badges.get(item.room)||{count:0,error:false};b.count++;b.error||=!!item.error;badges.set(item.room,b);}
  return badges;
}
const priority=i=>i.error?0:i.waiting?1:!i.done?2:3;
export function clearActivity(){items.clear();expanded=false;layout=null;const root=$('activity');if(root){root.replaceChildren();root.hidden=true;}}
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
