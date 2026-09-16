import {t as tr} from './i18n.mjs';
import {isAndroid, nativeCall, nativeClipboard, nativeSave} from './native.mjs';
import {icon} from './icons.mjs';
export const $ = id => document.getElementById(id);
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && !key.startsWith('aria-')) node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null) node.append(child instanceof Node ? child : String(child));
  return node;
}
export function button(label, action, cls = 'button', symbol) {
  return el('button', {class: cls, type: 'button', onclick: async event => {
    const b = event.currentTarget;
    if (b.disabled) return;
    b.disabled = true; b.setAttribute('aria-busy','true');
    const scope=b.closest('#modal')?'modal':'action'; if(scope==='modal')clearError(scope);
    try { await action(event); } catch (error) { reportError(error,b.closest('#modal')&&$('modal').open?'modal':'action'); }
    finally { b.disabled = false; b.removeAttribute('aria-busy'); }
  }}, symbol ? icon(symbol, 17) : null, label);
}
const reported=new WeakSet(), notices=new Map(), errors=new Map();
export function markReported(error){if(error && typeof error==='object')reported.add(error);}
export function clearError(scope){if(errors.delete(scope))renderErrors();}
export function clearFeedback(){errors.clear();renderErrors();for(const notice of notices.values()){clearTimeout(notice.timer);notice.node.remove();}notices.clear();}
export function reportError(error,scope='action',context='') {
  if(error && typeof error==='object' && reported.has(error))return;
  markReported(error);
  if(scope==='modal'&&!$('modal')?.open)scope='action';
  const message=(context?context+': ':'')+tr(error?.message || String(error));
  if(scope==='action' && /Connection (?:interrupted|changed|is offline)|Wait for the encrypted connection|Local host is offline/.test(error?.message||String(error)))scope='connection';
  if(scope==='connection' && $('connection-banner') && !$('connection-banner').hidden)return;
  if(errors.get(scope)===message)return;
  errors.set(scope,message);renderErrors();
}
function renderErrors(){
  const root=$('feedback');if(!root)return;
  root.hidden=!errors.size;
  root.replaceChildren(...[...errors].filter(([scope])=>scope!=='modal'&&scope!=='pair').map(([scope,message])=>el('div',{class:'feedback-error',role:'alert'},
    el('div',{},el('strong',{text:scope==='connection'?tr('Connection interrupted'):tr('Action could not complete')}),el('p',{text:message})),button(tr('Dismiss'),()=>clearError(scope),'text-button'))));
  root.hidden=!root.childElementCount;
  const pair=$('pair-error');if(pair){pair.hidden=!errors.has('pair');pair.textContent=errors.get('pair')||'';}
  const inline=$('modal-error');if(inline){inline.hidden=!errors.has('modal');inline.textContent=errors.get('modal')||'';}
}
// `host` = {name, local} names the machine a notice is about, so a toast is never ambiguous with several hosts paired.
export function toast(message, error = false, action, host = null) {
  if(error){reportError(new Error(message));return;}
  const key=host?`${host.name}\u0000${message}`:message;
  const previous=notices.get(key);if(previous){clearTimeout(previous.timer);previous.timer=setTimeout(()=>removeNotice(key),5000);return;}
  const body = el('p', {text: message});
  if (host) body.prepend(el('span', {class: 'toast-host'}, icon(host.local ? 'monitor' : 'globe', 12), el('span', {text: host.name})));
  const node = el('div', {class:'toast',role:'status'}, el('span', {}, icon('check', 17)), body);
  if (action) node.append(button(action.label, action.run, 'text-button'));
  const dismiss=button('',()=>removeNotice(key),'icon-button','close');dismiss.setAttribute('aria-label',tr('Dismiss notification'));node.append(dismiss);
  $('toasts').append(node);notices.set(key,{node,timer:setTimeout(()=>removeNotice(key),5000)});
  while(notices.size>2)removeNotice(notices.keys().next().value);
}
function removeNotice(message){const item=notices.get(message);if(item){clearTimeout(item.timer);item.node.remove();notices.delete(message);}}
let cleanup = null;
export function closeModal() { $('modal').close(); cleanup?.(); cleanup = null; }
export function modal(title, body, onClose) {
  closeModal(); clearError('modal'); $('modal-title').textContent = title; $('modal-content').replaceChildren(body);
  cleanup = onClose || null; $('modal').showModal();
}
$('modal-close').onclick = closeModal;
$('modal').addEventListener('cancel', () => { cleanup?.(); cleanup = null; });
$('modal').addEventListener('click', e => { if (e.target === $('modal')) {
  const r = $('modal').getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal();
}});
export function field(label, input, hint = '') {
  if (!input.id) input.id = 'field-' + crypto.randomUUID();
  return el('div', {class: 'field'}, el('label', {htmlFor: input.id, text: label}), input, hint ? el('small', {text: hint}) : null);
}
export function confirmAction(title, explanation, label, action, danger = false) {
  const body = el('div', {}, el('p', {class: 'modal-copy', text: explanation}),
    el('div', {class: 'modal-actions'}, button(tr('Cancel'), closeModal), button(label, async () => { await action(); closeModal(); }, `button ${danger ? 'danger' : 'primary'}`)));
  modal(title, body);
}
export async function copyText(text) {
  try { if (isAndroid) await nativeCall('clipboard.write', {text}); else await navigator.clipboard.writeText(text); toast(tr('Copied to this device.')); }
  catch {
    const area = el('textarea', {class: 'copy-text', value: text, readOnly: true, 'aria-label': tr('Text to copy')});
    modal(tr('Copy text'), el('div', {}, el('p', {class: 'modal-copy', text: tr('Your browser requires manual selection. Select and copy below.')}), area,
      el('div', {class: 'modal-actions'}, button(tr('Select all'), () => { area.focus(); area.select(); }))));
    area.focus(); area.select();
  }
}
export function size(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  for (const [power, unit] of [[3, 'GiB'], [2, 'MiB'], [1, 'KiB']]) if (bytes >= 1024 ** power) return `${(bytes / 1024 ** power).toFixed(1)} ${unit}`;
}
