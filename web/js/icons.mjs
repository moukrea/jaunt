import {claude, openai, github} from '../vendor/meteor.mjs';
// Lucide icons, bundled locally by prepare-web. See vendor/LICENSE-lucide.txt.
import {createElement, Terminal, Plus, X, ChevronRight, ChevronDown, Menu, Monitor, Folder, File, Image, Upload, Download, Copy, ClipboardPaste, Paperclip, Lock, ShieldCheck, QrCode, Settings, Bell, Check, RefreshCw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Trash2, Pencil, Keyboard, Ellipsis, ExternalLink, Eye, Zap, Search, LogOut, TriangleAlert, ArrowDownUp, Sun, Columns2, Rows2} from '../vendor/lucide.mjs';
const icons = {terminal:Terminal, plus:Plus, close:X, chevron:ChevronRight, down:ChevronDown, menu:Menu, monitor:Monitor, folder:Folder, file:File, image:Image, upload:Upload, download:Download, copy:Copy, paste:ClipboardPaste, attach:Paperclip, lock:Lock, shield:ShieldCheck, qr:QrCode, settings:Settings, bell:Bell, check:Check, refresh:RefreshCw, arrowUp:ArrowUp, arrowDown:ArrowDown, arrowLeft:ArrowLeft, arrowRight:ArrowRight, trash:Trash2, edit:Pencil, keyboard:Keyboard, more:Ellipsis, external:ExternalLink, eye:Eye, bolt:Zap, search:Search, logout:LogOut, alert:TriangleAlert, transfer:ArrowDownUp, sun:Sun, split:Columns2, splitRows:Rows2};
export function icon(name, size=20) {
  const brand = {claude, openai, github}[name];
  const element = createElement(brand ? brand.map(n=>[n.tag,n.attrs]) : (icons[name] || Terminal), {width:size,height:size,'stroke-width':1.75,'aria-hidden':'true'});
  element.dataset.iconName=name;
  return element;
}
export function fillIcons(root=document) { for(const e of root.querySelectorAll('[data-icon]')) e.replaceChildren(icon(e.dataset.icon, Number(e.dataset.size)||20)); }

export function sessionIcon(session) { return session?.alive && session.program === 'claude' ? 'claude' : session?.alive && session.program === 'codex' ? 'openai' : 'terminal'; }
