/** Bundled, explicit UI translation. Terminal output and user content stay untouched. */
export const languages={en:'English',fr:'Français',es:'Español',it:'Italiano',pt:'Português',de:'Deutsch'};
let override='system';try{if(typeof window!=='undefined')override=localStorage.getItem('jaunt-language')||'system';}catch{}
export const language=typeof window==='undefined'?'en':languages[override]?override:(navigator.languages||[navigator.language]).map(x=>x?.split(/[-_]/)[0]).find(x=>languages[x])||'en';
let catalog={};
if(language!=='en'){const response=await fetch(new URL(`../locales/${language}.json`,import.meta.url));if(!response.ok)throw new Error('Language resources could not be loaded');catalog=await response.json();}
let patterns;
export function t(key,...values){
 let translated=catalog[key];
 if(!translated && language!=='en' && typeof key==='string' && key.length<8192){
  patterns ||= Object.keys(catalog).filter(k=>/\{\d+\}/.test(k)).map(k=>{
   const slots=[];let pattern='',last=0;
   const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   for(const match of k.matchAll(/\{(\d+)\}/g)){pattern+=escape(k.slice(last,match.index))+'([\\s\\S]*?)';slots.push(+match[1]);last=match.index+match[0].length;}
   return {key:k,slots,regex:new RegExp('^'+pattern+escape(k.slice(last))+'$')};
  });
  for(const p of patterns){const match=p.regex.exec(key);if(match){translated=catalog[p.key];values=[];p.slots.forEach((slot,i)=>values[slot]=match[i+1]);break;}}
 }
 return (translated||key).replace(/\{(\d+)\}/g,(_,n)=>String(values[n]??`{${n}}`));
}
export function preference(){return override;}
export function setLanguage(value){if(value!=='system'&&!languages[value])throw new Error('Unsupported language');localStorage.setItem('jaunt-language',value);location.reload();}
export function translateStatic(root=document.body){
 document.documentElement.lang=language;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
  const node=walker.currentNode;if(node.parentElement.closest('[translate=no],script,style,code,pre'))continue;
  const key=node.textContent.trim().replace(/\s+/g,' ');if(key&&catalog[key])node.textContent=node.textContent.replace(node.textContent.trim(),t(key));
 }
 for(const node of root.querySelectorAll('[aria-label],[placeholder],[title],[alt]'))for(const name of ['aria-label','placeholder','title','alt']){const key=node.getAttribute(name);if(key&&catalog[key])node.setAttribute(name,t(key));}
}
