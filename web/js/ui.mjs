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
    b.disabled = true;
    try { await action(event); } catch (error) { toast(error.message || String(error), true); }
    finally { b.disabled = false; }
  }}, symbol ? icon(symbol, 17) : null, label);
}
export function toast(message, error = false, action) {
  const node = el('div', {class: `toast${error ? ' error' : ''}`}, el('span', {}, icon(error ? 'alert' : 'check', 17)), el('p', {text: message}));
  if (action) node.append(button(action.label, action.run, 'text-button'));
  node.append(button('', () => node.remove(), 'icon-button', 'close'));
  $('toasts').append(node);
  setTimeout(() => node.remove(), error ? 12000 : 6500);
}
let cleanup = null;
export function closeModal() { $('modal').close(); cleanup?.(); cleanup = null; }
export function modal(title, body, onClose) {
  closeModal(); $('modal-title').textContent = title; $('modal-content').replaceChildren(body);
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
    el('div', {class: 'modal-actions'}, button('Cancel', closeModal), button(label, async () => { await action(); closeModal(); }, `button ${danger ? 'danger' : 'primary'}`)));
  modal(title, body);
}
export async function copyText(text) {
  try { if (isAndroid) await nativeCall('clipboard.write', {text}); else await navigator.clipboard.writeText(text); toast('Copied to this device.'); }
  catch {
    const area = el('textarea', {class: 'copy-text', value: text, readOnly: true, 'aria-label': 'Text to copy'});
    modal('Copy text', el('div', {}, el('p', {class: 'modal-copy', text: 'Your browser requires manual selection. Select and copy below.'}), area,
      el('div', {class: 'modal-actions'}, button('Select all', () => { area.focus(); area.select(); }))));
    area.focus(); area.select();
  }
}
export function size(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  for (const [power, unit] of [[3, 'GiB'], [2, 'MiB'], [1, 'KiB']]) if (bytes >= 1024 ** power) return `${(bytes / 1024 ** power).toFixed(1)} ${unit}`;
}
