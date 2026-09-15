import {$,el,button} from './ui.mjs';
const items=new Map();
export function activity(id,title) {
  const item={id,title,status:'Starting…',done:false,error:false,percent:null};
  items.set(id,item);
  const update=patch=>{Object.assign(item,patch);render();};
  const finish=status=>update({status,done:true,waiting:false,percent:100});
  const fail=error=>update({status:error.message || String(error),done:true,error:true,percent:null});
  render();
  return {update,finish,fail,item};
}
export function clearActivity(){items.clear();render();}
function render(){
  const root=$('activity');if(!root)return;
  root.hidden=items.size===0;
  root.replaceChildren(...[...items.values()].reverse().map(item=>{
    const progress=el('progress',{'aria-label':item.title+' progress',max:100});
    if(item.percent!==null)progress.value=item.percent;
    const status=el('div',{class:'activity-description'},el('strong',{text:item.title}),el('span',{role:'status',text:item.status}));
    const row=el('div',{class:'activity-row'+(item.error?' error':''),'data-state':item.error?'error':item.waiting?'waiting':item.done?'done':'running'},status);
    if(!item.done)row.append(progress);
    if(item.action)row.append(button(item.action.label,item.action.run,'text-button'));
    if(item.done)row.append(button('Dismiss',()=>{item.dismissed=true;items.delete(item.id);render();},'text-button'));
    return row;
  }));
  // Keep bounded metadata only, never copies of uploads or terminal contents.
  if(items.size>30)for(const [id,item] of items){if(item.done){items.delete(id);break;}}
}
