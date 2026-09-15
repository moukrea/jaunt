import {activity,clearActivity} from './activity.mjs';
import {bindTouchScroll} from './touch-scroll.mjs';
import {desktop, LocalLink} from './desktop.mjs';
import {leaves, prune, split, themeMode} from './workspace.mjs';
import {isAndroid, nativeCall, nativeClipboard, nativeSave} from './native.mjs';
import terminalBundle from '../vendor/xterm.mjs';
import {Link, parsePairing} from './link.mjs';
import {Vault} from './vault.mjs';
import {b64, unb64, random, utf8} from './crypto.mjs';
import {upload, download, toPNG, saveBlob, quotePath} from './transfers.mjs';
import {fillIcons, icon} from './icons.mjs';
import {$, el, button, toast, reportError, clearError, clearFeedback, modal, closeModal, field, confirmAction, copyText, size} from './ui.mjs';
import {scan} from './qr.mjs';
import * as push from './push.mjs';

const {Terminal, FitAddon} = terminalBundle;
const vault = new Vault(), machines = new Map(), transfers = [];
let androidAPK = "", desktopRelease = "", desktopUpdateState=null, desktopUpdateOperation=null;
let selected = null, view = 'terminal', pairedFromURL = '', ctrl = false, alt = false;
let activeAt = Date.now(), hiddenAt = 0, installedPrompt, applicationStarted = false;
const isMobile = () => matchMedia('(max-width: 760px)').matches;
const current = () => machines.get(selected);
const activeTerm = a => a?.terms.get(a.active);
const prefs = () => vault.data?.preferences || {};
const checked = p => { if (!p) throw new Error('Choose a connected machine first.'); return p; };
const online = () => { const a = checked(current()); if (a.link.state !== 'online') throw new Error('Wait for the encrypted connection.'); return a; };
const persist = () => vault.save();
const report = error => {
  if(/Connection (?:interrupted|changed|is offline)|Wait for the encrypted connection|Local host is offline/.test(error?.message||'') && current()?.link.state!=='online'){renderConnection();return;}
  reportError(error);
};

function reportHost(a,error){
  if((error?.code==='connection' || /Connection (?:interrupted|changed|is offline)|Local host is offline/.test(error?.message||'')) && a.link.state!=='online'){if(a===current())renderConnection();return;}
  reportError(error,'host-'+a.machine.room,a.machine.friendlyName||a.machine.name);
}

// Never leave one-use secrets in navigation history or outgoing referrers.
if (location.hash.includes('pair=')) {
  pairedFromURL = new URLSearchParams(location.hash.slice(1)).get('pair') || '';
  history.replaceState(null, '', location.pathname + location.search);
}
const deepLink = new URLSearchParams(location.hash.slice(1));
if (deepLink.has('host')) history.replaceState(null, '', location.pathname + location.search);
fillIcons();

function drawer(open = false) { $('sidebar').classList.toggle('open', open); $('drawer-backdrop').hidden = !open; }
function setView(value) {
  document.querySelectorAll('.terminal-selection-overlay').forEach(n=>n.remove());
  view = value; drawer(); render();
  if(view==='transfers')renderTransfers();
  if (view === 'files' && current()?.link.state === 'online') listFiles(current()).catch(report);
  if (view === 'settings') { renderSettings(); const a = current(); if (a?.link.state === 'online' && a.info?.updates?.supported) a.link.request('updates.status').then(value => { a.info.updates = value; if (view === 'settings') renderSettings(); }).catch(report); }
}
function showPair() {
  const input = el('textarea', {class: 'pair-code', rows: 4, placeholder: 'jaunt1.… or the complete pairing link', spellcheck: false, autocapitalize: 'off', 'aria-label': 'Pairing code'});
  const body = el('div', {}, el('p', {class: 'modal-copy', text: 'Run jaunt pair on the host. The QR and pairing string expire after ten minutes and can be used once.'}),
    button('Scan QR code', () => scan(pairMachine), 'button wide', 'qr'), el('div', {class: 'divider'}, el('span', {text: 'or paste the complete string'})), input,
    el('div', {class: 'modal-actions'}, button('Pair machine', async () => { await pairMachine(input.value); closeModal(); }, 'button primary')));
  modal('Pair a machine', body); drawer();
}
async function pairMachine(value) {
  if (!vault.data) throw new Error('Unlock this device first.');
  const machine = parsePairing(value);
  if (vault.data.machines.some(m => m.room === machine.room)) throw new Error('This machine is already remembered. Reconnect from Settings, or forget it before pairing again.');
  if (vault.data.machines.length >= 12) throw new Error('Twelve machines are already remembered. Forget an old machine first.');
  // Persist BEFORE consuming the QR: a lost welcome must not strand the pairing.
  vault.data.machines.push(machine); await persist();
  const app = makeMachine(machine); selected = machine.room;
  app.link.start(); view = 'terminal'; $('pair-code').value = ''; render();
  clearError('action');clearError('pair'); renderConnection();
}
function makeMachine(machine) {
  const a = {machine, link: null, info: null, sessions: [], terms: new Map(), active: machine.lastSession || '',
    path: machine.lastPath || '~', pathDraft: null, listing: null, listingVersion: 0, remoteClipboard: '', fileError: ''};
  a.link = machine.local && desktop ? new LocalLink(machine) : new Link(machine, persist); machines.set(machine.room, a);
  a.link.addEventListener('status', () => {
    for (const t of a.terms.values()) {
      if (a.link.state !== 'online') t.attached = false;
      updateTermInput(a, t);
    }
    if(a.link.state==='online'){a.connectionError='';clearError('connection');clearError('host-'+a.machine.room);}
    render();
  });
  a.link.addEventListener('error', e => {if(a.link.state==='online')reportError(new Error(a.machine.name+': '+e.detail),'host-'+a.machine.room);else{a.connectionError=String(e.detail);if(a===current())renderConnection();}});
  a.link.addEventListener('revoked', () => {a.connectionError='Access was revoked on the host. Pair this device again only if you want to authorize it again.';if(a===current())renderConnection();});
  a.link.addEventListener('latency', () => { if (selected === machine.room) renderConnection(); });
  a.link.addEventListener('welcome', e => {
    a.peer = e.detail.peer; a.info = e.detail.machine; a.sessions = e.detail.sessions; syncSessions(a);
    // Only attach terminal views this browser actually opened; sessions need no viewer to run.
    for (const t of a.terms.values()) attachTerm(a, t).catch(error=>reportHost(a,error));
    if (!a.machine.openSessions) a.machine.openSessions = a.sessions.map(s=>s.id);
    if (!a.active || !a.sessions.some(s => s.id === a.active)) a.active = a.machine.openSessions[0] || '';
    if (selected === machine.room) {
      render(); if (a.active) selectSession(a, a.active).catch(error=>reportHost(a,error));
      if (view === 'files') listFiles(a).catch(error=>reportHost(a,error));
      if (view === 'settings') renderSettings();
    }
    if (machine.pending === false && machine.push) {
      // Refresh existing browser delivery settings without a permission prompt.
      if(!desktop && !isAndroid)push.refresh(vault,a.link).catch(error=>reportHost(a,error));
    }
    if (deepLink.get('host') === machine.room && deepLink.get('session')) {
      selected = machine.room; setView('terminal'); if (a.sessions.some(s => s.id === deepLink.get('session'))) selectSession(a, deepLink.get('session')).catch(error=>reportHost(a,error));
      deepLink.delete('session'); render();
    }
  });
  a.link.addEventListener('message', e => handleMessage(a, e.detail));
  return a;
}
function syncSessions(a) {
  if(a.machine.layouts) a.machine.layouts = a.machine.layouts.map(tree=>prune(tree,new Set(a.sessions.map(s=>s.id)))).filter(Boolean);
  a.machine.layout = a.machine.layouts?.find(tree=>leaves(tree).includes(a.active)) || prune(a.machine.layout, new Set(a.sessions.map(s => s.id)));
  for (const [id, t] of a.terms) {
    const s = a.sessions.find(s => s.id === id);
    if (!s) { t.term.dispose(); t.node.remove(); a.terms.delete(id); }
    else { t.session = s; updateTermInput(a, t); }
  }
  if(a.machine.openSessions) a.machine.openSessions = a.machine.openSessions.filter(id=>a.sessions.some(s=>s.id===id));
  if (!a.sessions.some(s => s.id === a.active)) a.active = a.machine.openSessions?.[0] || '';
}
function handleMessage(a, message) {
  if (message.type === 'sessions') { a.sessions = message.sessions; syncSessions(a); render(); }
  else if (message.type === 'terminal.geometry') {
    const t = a.terms.get(message.id); if (!t) return;
    Object.assign(t.session, message); t.ownsSize = message.activeView === a.peer;
    // Serialize geometry with xterm's asynchronous output parser, including replay.
    t.term.write('', () => {resizeTerminal(t, message.cols, message.rows);
      if(t.term.element)t.term.element.style.height=t.ownsSize?'100%':t.node.querySelector('.xterm-screen').getBoundingClientRect().height+'px';
      updateGeometryLabel(a, t);});
  } else if (message.type === 'terminal.reset') {
    const t = a.terms.get(message.id); if (!t) return;
    t.term.reset(); t.offset = message.offset; t.trimmed = message.trimmed;
    if (message.cols && message.rows) t.term.resize(message.cols, message.rows);
  } else if (message.type === 'terminal.output') {
    const t = a.terms.get(message.id); if (!t) return;
    const raw = unb64(message.data), expected = t.offset ?? message.offset;
    if (message.offset > expected) {
      if (!t.repairing) { t.repairing = true; attachTerm(a, t).finally(() => { t.repairing = false; }).catch(error=>reportHost(a,error)); }
      return;
    }
    const skip = Math.max(0, expected - message.offset);
    if (skip >= raw.length) return;
    t.offset = message.offset + raw.length;
    t.term.write(raw.subarray(skip));
  } else if (message.type === 'terminal.exit') {
    const t = a.terms.get(message.id); if (t) { t.session.alive = false; updateTermInput(a, t); }
    render();
  } else if (message.type === 'notification') {
    if(desktop && prefs().desktopNotifications) desktop.notify({title:message.title,body:message.body,session:message.session,host:a.machine.room}).catch(error=>reportHost(a,error));
    toast(`${message.title}${message.body ? ' — ' + message.body : ''}`, false,
      message.session ? {label: 'Open', run: () => { selected = a.machine.room; setView('terminal'); selectSession(a, message.session).catch(error=>reportHost(a,error)); }} : null);
  } else if (message.type === 'clipboard.available') {
    toast(`${a.machine.name} shared clipboard text.`, false, {label: 'Open', run: () => showClipboard(a)});
  }
}

function renderConnection() {
  const a = current(), state = a?.link.state || 'offline';
  const labels = {online: a?.machine.local ? 'Local connection' : 'Encrypted', offline: 'Not connected', connecting: 'Connecting', authenticating: 'Verifying host', waiting: 'Host offline', reconnecting: 'Reconnecting'};
  $('connection').className = 'connection ' + state;
  $('connection').lastElementChild.textContent = labels[state] || state;
  $('latency').hidden = !(state === 'online' && a.link.latency != null);
  $('latency').textContent = a?.link.latency != null ? `${a.link.latency} ms` : '';
  $('connection-banner').hidden = !a || state === 'online';
  if(!a || state==='online')return;
  const messages={connecting:'Connecting with the saved device key…',authenticating:a.machine.pending?'Pairing this device and verifying the host…':'Verifying the saved encrypted connection…',waiting:'The host is offline. jaunt will reconnect automatically when it returns.',reconnecting:'Network interrupted. Reconnecting automatically with the same pairing.'};
  const text=a.connectionError || messages[state] || a.link.message || 'Connection is paused. Reconnect using the saved device key.';
  const action=a.link.enabled?button('Retry now',()=>a.link.reconnect(),'text-button'):button('Reconnect',()=>{a.connectionError='';a.link.start();},'text-button');
  $('connection-banner').replaceChildren(el('span',{text:text+' Shells remain on the host while its daemon runs. Unsent terminal input is not replayed.'}),action);
  if(a.connectionError || /revoked|expired|unknown device/i.test(a.link.message||''))$('connection-banner').append(button('Connection settings',()=>setView('settings'),'text-button'));

}
function renderMachines() {
  $('machine-count').textContent = machines.size;
  const nodes = [...machines.values()].sort((a,b) => vault.data.machines.indexOf(a.machine) - vault.data.machines.indexOf(b.machine)).map(a => {
    const b = button('', () => { selected = a.machine.room; drawer(); render(); if (a.active) selectSession(a, a.active); if (view === 'files') return listFiles(a); }, 'machine-item' + (selected === a.machine.room ? ' selected' : ''));
    b.append(el('span', {class: 'machine-symbol'}, icon('monitor')), el('span', {class: 'machine-text'}, el('strong', {text: a.machine.friendlyName || a.machine.name}), el('small', {text: a.info ? `${a.info.user} · ${a.info.platform}` : a.link.state})),
      el('span', {class: `status-dot ${a.link.state === 'online' ? 'online' : a.link.enabled ? 'working' : ''}`}));
    return b;
  });
  $('machine-list').replaceChildren(...(nodes.length ? nodes : [el('p', {class: 'machine-placeholder', text: 'Your paired machines will appear here.'})]));
}
function render() {
  if (!vault.data) return;
  const a = current(); renderMachines(); renderConnection();
  $('machine-title').textContent = a?.machine.friendlyName || a?.machine.name || 'Overview';
  $('breadcrumb-prefix').textContent = 'Workspace';
  $('welcome').hidden = !!a || view === 'settings'; $('workspace').hidden = !a && view !== 'settings';
  $('new-session-top').hidden = !a; $('new-session-top').disabled = !!a?.creating || a?.link.state !== 'online';
  $('lock-button').hidden = !vault.protected;
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('selected', b.dataset.view === view);
  $('terminal-view').hidden = !a || (view !== 'terminal' && !(view === 'files' && !isMobile()));
  for (const v of ['files', 'transfers', 'settings']) $(v + '-view').hidden = (v !== 'settings' && !a) || view !== v;
  for (const b of document.querySelectorAll('#new-session-tab, #new-session-empty')) b.disabled = !!a?.creating || a?.link.state !== 'online';
  $('session-count').textContent = a?.sessions.length || '';
  for(const id of ['arrange-panes','split-below']) $(id).disabled = !a?.active || a?.link.state !== 'online';
  $('terminal-empty').hidden = !!a?.active;
  for (const host of machines.values()) for (const [id, t] of host.terms) t.node.hidden = host !== a || !visibleSessions(a).includes(id);
  if (a) layoutPanes(a);
  if (a) {
    renderTabs(a);
    const s = a.sessions.find(s => s.id === a.active), t = activeTerm(a);
    $('rename-session').hidden = !s;
    $('terminal-meta').textContent = a.creating ? 'Creating shell…' : s ? `${s.cwd}  ·  ${s.alive ? `${t?.term.cols || s.cols} × ${t?.term.rows || s.rows}` : `Exited (${s.exitCode ?? '—'})`}${t?.trimmed ? '  ·  older output trimmed' : ''}` : 'No active shell';
    if (s && !t && a.link.state === 'online') selectSession(a, s.id).catch(report);
  }
  requestAnimationFrame(fitActive);
}
function rememberLayout(a, tree) {
  if(!tree)return;
  const keep=new Set((a.machine.openSessions||a.sessions.map(s=>s.id)).filter(id=>!leaves(tree).includes(id)));
  a.machine.layouts=(a.machine.layouts||[]).map(t=>prune(t,keep)).filter(Boolean);
  a.machine.layouts.push(tree);
  for(const id of keep)if(!a.machine.layouts.some(t=>leaves(t).includes(id)))a.machine.layouts.push({id});
  a.machine.layout=tree;
}
function renderTabs(a) {
  const sessions=a.sessions.filter(s=>!a.machine.openSessions||a.machine.openSessions.includes(s.id));
  const groups=isMobile()?sessions.map(s=>({id:s.id})):(a.machine.layouts||sessions.map(s=>({id:s.id})));
  $('tabs').replaceChildren(...groups.map(tree => {
    const ids=leaves(tree), group=sessions.filter(s=>ids.includes(s.id));if(!group.length)return el('span');
    const active=ids.includes(a.active), target=active?a.active:group[0].id, name=group.map(s=>s.name).join(' + ');
    const label=button(name,()=>selectSession(a,target),'tab-label');
    label.ondblclick=()=>renameSession(a,a.sessions.find(s=>s.id===target));
    label.setAttribute('role','tab');label.setAttribute('aria-selected',String(active));
    const close=button('',async()=>{for(const s of group)await closeView(a,s.id);},'icon-button tab-close','close');close.setAttribute('aria-label',`Close view of ${name}`);
    return el('div',{class:'session-tab'+(active?' active':'')},el('span',{class:'tab-symbol'},icon('terminal',15)),label,el('span',{class:`status-dot${group.some(s=>s.alive)?' online':''}`}),close);
  }));
}
function createTerm(a, session) {
  const node = el('div', {class: 'terminal-container', hidden: a !== current() || session.id !== a.active, 'data-session': session.id});
  $('terminal-containers').append(node);
  const title=button(session.name,()=>renameSession(a,session),'pane-name');
  const undock=button('',()=>undockPane(a,session.id),'icon-button','external');
  undock.setAttribute('aria-label','Move pane to its own tab');
  node.append(el('div',{class:'pane-caption'},title,undock));
  const term = new Terminal({fontSize: prefs().fontSize || 14, fontFamily: 'ui-monospace, "Cascadia Code", "Liberation Mono", Menlo, monospace', lineHeight: 1.18,
    cursorBlink: true, cursorStyle: 'bar', scrollback: 10000, allowProposedApi: true, convertEol: false,
    screenReaderMode: !!prefs().screenReader, scrollOnUserInput: true, smoothScrollDuration: isMobile() ? 0 : 100, rescaleOverlappingGlyphs: true,
    linkHandler: {activate: (_event, uri) => { try { const u = new URL(uri); if (['https:', 'http:'].includes(u.protocol)) window.open(u.href, '_blank', 'noopener,noreferrer'); } catch {} }},
    theme: {background: '#111314', foreground: '#d9dfd3', cursor: '#e7a246', selectionBackground: '#455342', black: '#151918', brightBlack: '#70786f', red: '#d8897c', green: '#a3c391', yellow: '#e7bc73', blue: '#88adcb', magenta: '#c59bc7', cyan: '#8fc5bf', white: '#dbe0d3', brightWhite: '#f1f3eb'}});
  const mount = el('div',{class:'terminal-mount'});node.append(mount);
  const fit = new FitAddon(); term.loadAddon(fit); term.open(mount);
  bindTouchScroll(mount,term);
  const t = {session, node, term, fit, offset: null, attached: false, attaching: null, repairing: false, generation: -1, ownsSize: false};
  a.terms.set(session.id, t);
  term.onScroll(() => {
    const d=fit.proposeDimensions();
    // Browser layout changes can reset xterm's viewport before its PTY resize.
    // Only record deliberate scrolling at the last committed dimensions.
    if(!t.resizing && d?.cols===term.cols && d?.rows===term.rows) rememberScroll(t);
  });

  const area = node.querySelector('textarea');
  if (area) { area.setAttribute('autocorrect', 'off'); area.setAttribute('autocapitalize', 'off'); area.spellcheck = false; area.setAttribute('aria-label', `Terminal ${session.name}`); }
  updateTermInput(a, t); applyTheme();
  let initialFit = false;
  term.onRender(() => { if (!initialFit && !node.hidden) { initialFit = true; requestAnimationFrame(fitActive); } });
  term.onData(data => {
    if (!t.attached || a.link.state !== 'online' || (a.info?.sharedViews && !t.ownsSize)) return;
    if (ctrl && data.length === 1) { data = String.fromCharCode(data.toUpperCase().charCodeAt(0) & 31); ctrl = false; }
    if (alt) { data = '\x1b' + data; alt = false; }
    updateModifiers(); sendInput(a, t, data).catch(error=>reportHost(a,error));
  });
  term.onBinary(data => { if (t.attached && (!a.info?.sharedViews || t.ownsSize)) a.link.send({type: 'terminal.input', id: session.id, data: b64(Uint8Array.from(data, c => c.charCodeAt(0) & 255))}).catch(error=>reportHost(a,error)); });
  node.addEventListener('pointerdown', () => { a.active = session.id; claimSize(a, t); renderTabs(a); }, {capture: true});
  node.addEventListener('keydown', () => claimSize(a, t), {capture: true});
  // ResizeObserver only resizes the controlling view. Passive views retain shared geometry.
  new ResizeObserver(() => { if (t.ownsSize) fitActive(); }).observe(node);
  // OSC 52 can provide copy data, but cannot read or overwrite the phone clipboard silently.
  term.parser.registerOscHandler(52, data => {
    const payload = data.slice(data.indexOf(';') + 1);
    if (payload !== '?' && payload.length <= 1400000) {
      try {
        const binary = atob(payload); a.remoteClipboard = new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
        if (t.attached) toast('The terminal has text ready to copy.', false, {label: 'Copy', run: () => copyText(a.remoteClipboard)});
      } catch { /* Invalid OSC is ignored, never interpreted as HTML. */ }
    }
    return true;
  });
  // Terminal programs cannot induce secret reads using OSC 52 queries or OSC 8 JS URLs.
  term.registerLinkProvider({provideLinks: (_line, callback) => callback(undefined)});
  term.attachCustomKeyEventHandler(event => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyC' && event.type === 'keydown') {
      copyText(term.getSelection() || terminalText(t)).catch(error=>reportHost(a,error)); return false;
    }
    return true;
  });
  node.addEventListener('paste', event => {
    const files = clipboardFiles(event.clipboardData);
    if (files.length) { event.preventDefault(); event.stopImmediatePropagation(); pasteFiles(a, t, files).catch(error=>reportHost(a,error)); }
    else {
      const text = event.clipboardData?.getData('text/plain');
      if (text) { event.preventDefault(); event.stopImmediatePropagation(); insertText(a, t, text).catch(error=>reportHost(a,error)); }
      else { event.preventDefault(); event.stopImmediatePropagation(); showPastePanel(a, t); }
    }
  }, true);
  return t;
}
function updateTermInput(a, t) {
  const disabled = !!a.creating || a.link.state !== 'online' || !t.session.alive || !t.attached;
  t.term.options.disableStdin = disabled;
  const area = t.node.querySelector('textarea');
  if (area) area.disabled = disabled;
}
async function attachTerm(a, t) {
  if (a.link.state !== 'online') return;
  const generation = a.link.generation;
  if (t.attaching?.generation === generation) return t.attaching.promise;
  t.attached = false; updateTermInput(a, t);
  const promise = (async () => {
    await a.link.request('session.attach', {id: t.session.id, after: t.offset});
    // xterm writes are asynchronous: drain replay before allowing parser responses/input.
    if(generation!==a.link.generation || !a.terms.has(t.session.id))return;
    await new Promise(resolve => t.term.write('', resolve));
    if (generation !== a.link.generation || a.link.state !== 'online') return;
    t.generation = generation; t.attached = true; updateTermInput(a, t);
    t.ownsSize = !a.info?.sharedViews || t.session.activeView === a.peer;
    if (!t.session.activeView && a === current() && visibleSessions(a).includes(t.session.id)) claimSize(a, t);

  })();
  t.attaching = {generation, promise};
  try { await promise; } finally { if (t.attaching?.promise === promise) t.attaching = null; }
}
async function selectSession(a, id) {
  document.querySelectorAll('.split-picker').forEach(n=>n.remove());
  document.querySelectorAll('.terminal-selection-overlay').forEach(n=>n.remove());
  const session = a.sessions.find(s => s.id === id);
  if (!session) throw new Error('This terminal no longer exists.');
  selected = a.machine.room; a.active = id; a.machine.lastSession = id;
  a.machine.openSessions ||= []; if(!a.machine.openSessions.includes(id))a.machine.openSessions.push(id);
  if (!leaves(a.machine.layout).includes(id)) a.machine.layout = a.machine.layouts?.find(tree=>leaves(tree).includes(id)) || {id};
  rememberLayout(a, a.machine.layout);
  // Commit the workspace before displaying it or awaiting a network attach.
  await persist();
  render();
  const t = a.terms.get(id) || createTerm(a, session);
  if ((!t.attached || t.generation !== a.link.generation) && a.link.state === 'online') await attachTerm(a, t);
  requestAnimationFrame(fitActive);
}
function visibleSessions(a) {
  if (!a) return [];
  return isMobile() ? [a.active] : leaves(a.machine.layout).length ? leaves(a.machine.layout) : [a.active];
}
function updateGeometryLabel(a, t) {
  if (a !== current() || a.active !== t.session.id) return;
  const viewers = (t.session.viewers || []).map(v => v.name + (v.active ? ' • active' : '')).join(', ');
  $('terminal-meta').textContent = `${t.session.cwd} · ${t.term.cols} × ${t.term.rows}${viewers ? ' · ' + viewers : ''}${t.trimmed ? ' · older output trimmed' : ''}`;
}
function rememberScroll(t) {
  const b=t.term.buffer.active;
  t.scrollAnchor?.marker?.dispose();
  t.scrollAnchor={bottom:b.viewportY>=b.baseY,line:b.viewportY,
    marker:b.type==='normal' && b.viewportY<b.baseY ? t.term.registerMarker(b.viewportY-b.baseY-b.cursorY) : null};
}
function resizeTerminal(t, cols, rows) {
  if(t.term.cols===cols && t.term.rows===rows)return;
  if(!t.scrollAnchor)rememberScroll(t);
  const anchor=t.scrollAnchor;t.resizing=true;
  t.term.resize(cols, rows);
  const restore=()=>{
    t.term.scrollToLine(anchor.bottom ? t.term.buffer.active.baseY : anchor.marker && !anchor.marker.isDisposed ? anchor.marker.line : anchor.line);
    t.term.refresh(0,t.term.rows-1);
  };
  restore();requestAnimationFrame(()=>{restore();t.resizing=false;rememberScroll(t);});
}
function claimSize(a, t) {
  if (!t.attached || a.link.state !== 'online' || t.node.hidden) return;
  const owned=t.ownsSize; t.ownsSize = true;
  if(t.term.element)t.term.element.style.height='100%';
  try {
    const d = t.fit.proposeDimensions(); if (!d) return;
    if(owned && d.cols===t.term.cols && d.rows===t.term.rows)return;
    resizeTerminal(t, d.cols, d.rows);
    a.link.send({type: 'terminal.resize', id: t.session.id, ...d}).catch(error=>reportHost(a,error));
  } catch { /* Retry after layout. */ }
}
let fitTimer;
function fitActive() {
  if(isMobile()){clearTimeout(fitTimer);fitTimer=setTimeout(fitVisible,120);}
  else fitVisible();
}
function fitVisible() {
  const a = current();
  if (!a || $('terminal-view').hidden || vault.locked) return;
  for (const id of visibleSessions(a)) {
    const t = a.terms.get(id); if (!t || t.node.hidden) continue;
    if (t.ownsSize) {
      const d = t.fit.proposeDimensions();
      if (d && (t.term.cols !== d.cols || t.term.rows !== d.rows)) claimSize(a, t);
    }
    updateGeometryLabel(a, t);
  }
}
function layoutPanes(a) {
  const container = $('terminal-containers');
  container.querySelectorAll('.pane-divider').forEach(n => n.remove());
  function place(tree, x, y, w, h) {
    if (!tree) return;
    if (tree.id) {
      const session = a.sessions.find(s => s.id === tree.id); if (!session) return;
      const t = a.terms.get(tree.id) || createTerm(a, session);
      Object.assign(t.node.style, {left: x+'%', top: y+'%', width: w+'%', height: h+'%', right: 'auto', bottom: 'auto'});
      t.node.hidden = false; t.node.classList.toggle('pane-active', tree.id === a.active);t.node.classList.toggle('pane-tiled',visibleSessions(a).length>1);
      t.node.querySelector('.pane-name').textContent=session.name;
      if (!t.attached && !t.attaching && a.link.state === 'online') attachTerm(a, t).catch(report);
      return;
    }
    const horizontal = tree.axis === 'x', r = tree.ratio;
    place(tree.first,x,y,horizontal?w*r:w,horizontal?h:h*r);
    place(tree.second,horizontal?x+w*r:x,horizontal?y:y+h*r,horizontal?w*(1-r):w,horizontal?h:h*(1-r));
    const gutter = el('div', {class: 'pane-divider '+tree.axis, role: 'separator', tabindex: 0, 'aria-label': 'Resize terminal panes', 'aria-orientation': horizontal?'vertical':'horizontal', 'aria-valuenow': Math.round(r*100)});
    Object.assign(gutter.style, horizontal ? {left:(x+w*r)+'%',top:y+'%',height:h+'%'} : {top:(y+h*r)+'%',left:x+'%',width:w+'%'});
    gutter.onpointerdown = e => {
      e.preventDefault(); const rect = container.getBoundingClientRect();
      const move = e => {
        tree.ratio = Math.max(.15, Math.min(.85, horizontal ? ((e.clientX-rect.left)/rect.width*100-x)/w : ((e.clientY-rect.top)/rect.height*100-y)/h));
        layoutPanes(a); fitActive();
      };
      const up = () => { window.removeEventListener('pointermove',move); window.removeEventListener('pointerup',up); persist().catch(report); };
      window.addEventListener('pointermove',move); window.addEventListener('pointerup',up,{once:true});
    };
    gutter.onkeydown = e => { if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return; e.preventDefault(); tree.ratio=Math.max(.15,Math.min(.85,r+(['ArrowRight','ArrowDown'].includes(e.key)?.05:-.05))); layoutPanes(a); fitActive(); persist().catch(report); };
    container.append(gutter);
  }
  place(isMobile() ? {id:a.active} : a.machine.layout || {id:a.active},0,0,100,100);
}
function selectTerminalText() {
  const a=checked(current()),t=activeTerm(a);if(!t)return;
  const text=el('textarea',{class:'terminal-selection',readOnly:true,value:terminalText(t),'aria-label':'Select terminal text',spellcheck:false});
  const overlay=el('div',{class:'terminal-selection-overlay'},button('Back to terminal',()=>overlay.remove(),'button'),text);
  $('terminal-stage').append(overlay);text.scrollTop=text.scrollHeight;
  // A native text control gives Android/iOS their own selection handles and copy menu.
}
function arrangePanes(axis) {
  const a = online(), target = a.active;
  const old = document.querySelector('.split-picker');
  if (old) old.remove();
  const picker = el('div', {class:'split-picker', role:'region', 'aria-label':'Choose pane session'});
  const add = async id => {
    picker.remove();
    a.machine.openSessions ||= [];
    if (!a.machine.openSessions.includes(id)) a.machine.openSessions.push(id);
    rememberLayout(a, split(a.machine.layout || {id:target}, target, id, axis));
    await selectSession(a,id);
  };
  picker.append(button('New shell',async()=>{picker.remove();await newSession(axis);},'button','plus'));
  for (const session of a.sessions.filter(s=>!leaves(a.machine.layout || {id:target}).includes(s.id)))
    picker.append(button(session.name,()=>add(session.id),'button','terminal'));
  picker.append(button('Cancel',()=>picker.remove(),'button','close'));
  $('terminal-stage').append(picker);
  picker.querySelector('button').focus();
  picker.onkeydown=e=>{if(e.key==='Escape')picker.remove();};
}
async function undockPane(a,id) {
  rememberLayout(a,{id});
  await selectSession(a,id);
}
async function sendInput(a, t, text) {
  if (a.link.state !== 'online' || !t.session.alive || !t.attached) throw new Error('This terminal is not ready for input.');
  claimSize(a, t);
  const bytes = utf8(text);
  for (let i = 0; i < bytes.length; i += 8192) await a.link.send({type: 'terminal.input', id: t.session.id, active: true, cols: t.term.cols, rows: t.term.rows, data: b64(bytes.subarray(i, i + 8192))});
}
async function insertText(a, t, text) {
  if (!t) throw new Error('Open a shell before pasting.');
  if (utf8(text).length > 1024 * 1024) throw new Error('Paste is limited to 1 MiB. Upload a file for larger content.');
  if (a.link.state !== 'online' || !t.attached) throw new Error('Wait for the terminal to reconnect before pasting.');
  // Do not allow clipboard text to terminate bracketed paste or smuggle terminal controls.
  const clean = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  const perform = async () => {
    const normalized=clean.replace(/\r?\n/g,'\r');
    await sendInput(a,t,t.term.modes.bracketedPasteMode?'\x1b[200~'+normalized+'\x1b[201~':normalized);
  };
  if (/[\r\n]/.test(clean) && !t.term.modes.bracketedPasteMode) {
    await new Promise((resolve,reject)=>{
      let accepted=false;
      modal('Paste multiple lines?',el('div',{},el('p',{class:'modal-copy',text:'This shell does not enable bracketed paste. Newlines may execute commands immediately. Review the text with Compose instead when in doubt.'}),
        el('div',{class:'modal-actions'},button('Cancel',closeModal),button('Paste anyway',async()=>{await perform();accepted=true;closeModal();resolve();},'button danger'))),()=>{if(!accepted)reject(new Error('Paste cancelled'));});
    });
  } else await perform();
}
function terminalText(t) {
  const buffer = t.term.buffer.active, lines = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i), next = buffer.getLine(i + 1);
    const text = line?.translateToString(!next?.isWrapped) || '';
    if (line?.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  return lines.join('\n').replace(/\n+$/, '');
}
async function newSession(splitAxis = null, options = {}) {
  const a = online(), splitTarget = a.active;
  if(a.creating)return;
  a.creating=true;
  for(const t of a.terms.values())updateTermInput(a,t);
  render();
  try {
  const result = await a.link.request('session.create', {id:random(12),
    sourceSession:splitTarget || undefined, cwd:a.info?.sessionDirectory ? undefined : a.sessions.find(s=>s.id===splitTarget)?.cwd, ...options, cols:100, rows:30});
  if (!a.sessions.some(s=>s.id===result.id)) a.sessions.push(result);
  if (['x','y'].includes(splitAxis) && splitTarget) {
    a.machine.openSessions ||= [];
    if (!a.machine.openSessions.includes(result.id)) a.machine.openSessions.push(result.id);
    rememberLayout(a,split(a.machine.layout || {id:splitTarget},splitTarget,result.id,splitAxis));
  }
  closeModal(); view='terminal'; await selectSession(a,result.id);
  } finally {
    a.creating=false;
    for(const t of a.terms.values())updateTermInput(a,t);
    render();
  }
  if (!isMobile()) activeTerm(a)?.term.focus();
}
async function browseNewSession() {
  const a=online(), active=a.sessions.find(s=>s.id===a.active);
  const directory=active && a.info?.sessionDirectory ? (await a.link.request('session.directory',{id:active.id})).path : active?.cwd;
  const name=el('input',{maxLength:80,placeholder:'Automatic'});
  const cwd=el('input',{value:directory || a.info?.home || '~',spellcheck:false,autocapitalize:'off'});
  const folders=el('div',{class:'folder-picker'});
  let listing, request=0;
  const navigate=async(path,append=false)=>{
    const version=++request;
    const result=await a.link.request('files.list',{path,offset:append?listing.next:0,limit:100,hidden:false});
    if(version!==request)return;
    if(append)result.entries=[...listing.entries,...result.entries];
    listing=result;cwd.value=result.path;
    folders.replaceChildren(button('Parent folder',()=>navigate(result.parent),'button','arrowUp'),
      ...result.entries.filter(e=>e.directory).map(e=>button(e.name,()=>navigate(result.path.replace(/\/$/,'')+'/'+e.name),'button','folder')),
      ...(result.next!==null?[button('Load more',()=>navigate(result.path,true))]:[]));
  };
  cwd.oninput=()=>{request++;};
  cwd.onchange=()=>navigate(cwd.value).catch(error=>reportError(error,cwd.isConnected?'modal':'action'));
  await navigate(cwd.value);
  modal('New terminal',el('div',{},field('Session name',name,'Optional — leave blank for an automatic name.'),
    field('Working directory',cwd),folders,
    el('div',{class:'modal-actions'},button('Cancel',closeModal),button('Create shell',()=>newSession(null,{name:name.value,cwd:cwd.value}),'button primary'))));
}
async function closeView(a, id) {
  a.machine.openSessions = (a.machine.openSessions || a.sessions.map(s=>s.id)).filter(s=>s!==id);
  a.machine.layout = prune(a.machine.layout,new Set(a.machine.openSessions));
  a.machine.layouts = (a.machine.layouts||[]).map(tree=>prune(tree,new Set(a.machine.openSessions))).filter(Boolean);
  const t=a.terms.get(id);
  if(t){if(t.attached)await a.link.request('session.detach',{id});t.term.dispose();t.node.remove();a.terms.delete(id);}
  if(a.active===id)a.active=a.machine.openSessions[0]||'';
  a.machine.layout=a.machine.layouts.find(tree=>leaves(tree).includes(a.active))||null;
  a.machine.lastSession=a.active;await persist();render();
}
function sessionList() {
  const a=checked(current()), body=el('div',{class:'session-manager'});
  for(const s of a.sessions) body.append(el('div',{class:'settings-row'},
    el('div',{class:'settings-label'},el('strong',{text:s.name}),el('p',{text:`${s.alive?'Running':'Exited'} · ${s.cwd}`}),el('p',{text:(s.viewers||[]).map(v=>v.name).join(', ')||'No open views'})),
    el('div',{class:'session-actions'},button('Open',async()=>{closeModal();view='terminal';await selectSession(a,s.id);}),
    button('Rename',()=>renameSession(a,s)),
    ...(a.machine.openSessions?.includes(s.id)?[button('Close view',async()=>{await closeView(a,s.id);sessionList();})]:[]),
    button('Terminate',()=>terminateSession(a,s),'button danger'))));
  if(!a.sessions.length)body.append(el('p',{text:'No sessions are running on this host.'}));
  body.append(button('New shell',newSession,'button primary'));
  modal('Sessions on this host',body);
}
function terminateSession(a, session) {
  confirmAction(`Terminate ${session.name}?`, session.tmux
    ? `This kills the underlying tmux session “${session.tmux}” and its shells, including views outside jaunt.`
    : 'This ends the shell and its jobs for everyone. All connected views will close. This cannot be undone.',
    'Terminate session', async () => {
      await a.link.request('session.terminate', {id: session.id});
      a.sessions = a.sessions.filter(s => s.id !== session.id); syncSessions(a); await persist(); render();
    }, true);
}
function renameSession(a = online(), s = a.sessions.find(s => s.id === a.active)) {
  if (!s) return;
  const input = el('input', {value: s.name, maxLength: 80});
  modal('Rename terminal', el('div', {}, field('Name', input), el('div', {class: 'modal-actions'}, button('Save', async () => {
    await a.link.request('session.rename', {id: s.id, name: input.value}); s.name=input.value.trim() || s.name; closeModal(); render();
  }, 'button primary')))); input.focus(); input.select();
}

async function listFiles(a, path = a.path, append = false) {
  if (a.link.state !== 'online') throw new Error('Files are available when the host is connected.');
  const version = ++a.listingVersion;
  // Remember navigation intent before the reply: a concurrent refresh must use
  // the requested folder, not the previously rendered folder.
  if (arguments.length > 1 && !append) a.pathDraft = null;
  a.path = path;
  const result = await a.link.request('files.list', {path, hidden: $('show-hidden').checked,
    offset: append ? a.listing?.next || 0 : 0, limit: 100});
  if (version !== a.listingVersion) return;
  if (append && a.listing?.path === result.path) result.entries = [...a.listing.entries, ...result.entries];
  a.path = result.path; a.machine.lastPath = result.path; a.listing = result; a.fileError = '';
  await persist();
  if (current() === a && version === a.listingVersion) renderFiles(a);
}
function renderFiles(a) {
  if (!a.listing) { $('file-list').replaceChildren(el('p', {class: 'modal-copy', text: 'Loading files…'})); return; }
  const result = a.listing;
  $('file-path').value = a.pathDraft ?? result.path;
  $('file-status').textContent = `${result.entries.length} / ${result.total} items · ${size(result.free)} free${result.truncated ? ' · first 5,000 entries only' : ''}`;
  const rows = result.entries.map(entry => {
    const path = result.path.replace(/\/$/, '') + '/' + entry.name;
    const main = button('', () => entry.directory ? listFiles(a, path) : fileMenu(a, entry, path), 'file-entry');
    main.append(el('span', {class: 'file-icon'}, icon(entry.directory ? 'folder' : /\.(png|jpe?g|webp|gif|avif)$/i.test(entry.name) ? 'image' : 'file', 21)),
      el('span', {class: 'file-text'}, el('span', {class: 'file-name', text: entry.name}),
        el('span', {class: 'file-details', text: `${entry.directory ? 'Folder' : size(entry.size)}${entry.link ? ' · symlink' : ''}${entry.unreadable ? ' · not readable' : ''}`})));
    const more = button('', () => fileMenu(a, entry, path), 'icon-button', 'more'); more.setAttribute('aria-label', `Actions for ${entry.name}`);
    return el('div', {class: 'file-row'}, main, more);
  });
  if (!rows.length) rows.push(el('p', {class: 'modal-copy', text: 'This directory is empty.'}));
  if (result.next != null) rows.push(button('Load more', () => listFiles(a, a.path, true), 'button wide'));
  $('file-list').replaceChildren(...rows);
}
function fileMenu(a, entry, path) {
  const body = el('div', {class: 'file-menu'}, el('p', {class: 'modal-copy', text: path}));
  if (entry.directory) body.append(button('Open folder', async () => { closeModal(); await listFiles(a, path); }, 'button', 'folder'));
  else {
    body.append(button('Preview', () => previewFile(a, path, entry), 'button', 'eye'));
    body.append(button('Download', async () => { closeModal(); await getFile(a, path, entry.name); }, 'button', 'download'));
    if ('showSaveFilePicker' in window) body.append(button('Save directly to disk…', async () => {
      const handle = await showSaveFilePicker({suggestedName: entry.name});
      const writer = await handle.createWritable(); closeModal(); await getFile(a, path, entry.name, writer);
    }, 'button', 'download'));
  }
  body.append(button('Copy full path', () => copyText(path), 'button', 'copy'));
  if (activeTerm(a)) body.append(button('Insert path in terminal', async () => {
    const t = activeTerm(a); closeModal(); setView('terminal'); await insertText(a, t, quotePath(path));
  }, 'button', 'terminal'));
  body.append(button('Rename', () => {
    const name = el('input', {value: entry.name});
    modal('Rename file or folder', el('div', {}, field('New name', name), el('div', {class: 'modal-actions'}, button('Rename', async () => {
      await a.link.request('files.rename', {path, name: name.value}); closeModal(); await listFiles(a);
    }, 'button primary'))));
  }, 'button', 'edit'));
  body.append(button('Delete', () => confirmAction('Delete this item?', `Permanently delete “${entry.name}”? This is not a move to Trash. Non-empty folders are never deleted recursively.`, 'Delete', async () => {
    await a.link.request('files.remove', {path}); await listFiles(a);
  }, true), 'button danger', 'trash'));
  modal(entry.name, body);
}
async function previewFile(a, path, entry) {
  if (entry.size > 16 * 1024 * 1024) throw new Error('Preview is limited to 16 MiB. Download this file instead.');
  const result = await download(a.link, path, null, {preview: true});
  const body = el('div'); let url = '';
  if (/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(result.mime)) {
    url = URL.createObjectURL(result.blob); body.append(el('img', {class: 'modal-preview', src: url, alt: entry.name}));
  } else {
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    if (bytes.includes(0)) throw new Error('This is a binary file. Download it to open in another application.');
    body.append(el('pre', {class: 'preview-text', text: new TextDecoder().decode(bytes)}));
  }
  body.append(el('div', {class: 'modal-actions'}, button('Download', () => saveBlob(result.blob, result.name), 'button', 'download')));
  modal(entry.name, body, () => { if (url) URL.revokeObjectURL(url); });
}
function transferItem(a, name, direction, total) {
  const item = {key: random(8), name, direction, host: a.machine.name, total, offset: 0, status: 'Preparing', done: false, error: false,
    controller: new AbortController()};
  transfers.unshift(item);
  if (transfers.length > 100) {
    const old = transfers.findLastIndex(t => t.done); if (old >= 0) transfers.splice(old, 1);
  }
  renderTransfers(); return item;
}
function progressFor(item) { return value => { Object.assign(item, value); if(view==='transfers')renderTransfers(); }; }
function renderTransfers() {
  $('file-transfers').hidden = transfers.length === 0;
  $('transfer-count').textContent = transfers.filter(t => !t.done).length || '';
  $('transfer-list').replaceChildren(...transfers.map(t => {
    const fraction = t.total ? Math.min(1, t.offset / t.total) : t.done && !t.error ? 1 : 0;
    const track = el('div', {class: 'progress-track'}, el('div', {class: 'progress-fill', style: `width:${Math.round(fraction * 100)}%`}));
    const details = el('div', {class: 'transfer-body'}, el('strong', {text: t.name}),
      el('p', {class: 'transfer-details', text: `${t.host} · ${t.status} · ${size(t.offset)} / ${size(t.total)}`}), track);
    if (t.path) details.append(button('Copy remote path', () => copyText(t.path), 'text-button'));
    return el('div', {class: `transfer-item${t.error ? ' transfer-failed' : ''}`}, el('span', {class: 'transfer-icon'}, icon(t.direction === 'up' ? 'upload' : 'download', 20)), details,
      !t.done ? button('Cancel', () => { t.controller.abort(); t.status = 'Cancelling'; renderTransfers(); }, 'text-button') : null);
  }));
  if (!transfers.length) $('transfer-list').append(el('p', {class: 'modal-copy', text: 'Files you send and receive will appear here. Transfers resume automatically after a network interruption while this page stays open.'}));
}
async function putFile(a, file, options = {}, operation = null) {
  if (file.size > (a.info?.maxFileBytes || 512 * 1024 * 1024)) throw new Error('This file exceeds the host’s transfer limit.');
  const item = transferItem(a, file.name, 'up', file.size);
  const job=operation || activity(item.key,`${file.name} → ${a.machine.name}`);
  job.update({action:{label:'Cancel transfer',run:()=>item.controller.abort()}});
  try {
    const result = await upload(a.link, file, options, value=>{progressFor(item)(value);job.update({status:`${value.status} · ${size(value.offset)} / ${size(value.total)}`,percent:value.total?Math.round(value.offset/value.total*100):null});}, item.controller.signal);
    item.done = true; item.path = result.path; item.status = 'Verified · SHA-256'; item.offset = file.size; renderTransfers();
    job.update({action:null});
    if(!operation)job.finish('Uploaded and verified · SHA-256');
    return result;
  } catch (e) { job.fail(e);item.done = true; item.error = e.name!=='AbortError'&&e.message!=='Transfer cancelled'; item.status = item.error?e.message:'Cancelled'; renderTransfers(); throw e; }
}
async function getFile(a, path, name, writer) {
  const item = transferItem(a, name, 'down', 0),job=activity(item.key,`${name} ← ${a.machine.name}`);
  job.update({status:'Preparing download…',action:{label:'Cancel transfer',run:()=>item.controller.abort()}});
  try {
    const result = await download(a.link, path, value=>{progressFor(item)(value);job.update({status:value.status+' · '+size(value.offset)+(value.total?' / '+size(value.total):''),percent:value.total?Math.round(value.offset/value.total*100):null});}, {writer, signal: item.controller.signal});
    if (result.blob) await saveBlob(result.blob, result.name);
    item.done = true; item.status = 'Downloaded'; item.offset = item.total; renderTransfers();job.finish('Downloaded · '+size(item.offset)); return result;
  } catch (e) { job.fail(e);item.done = true; item.error = e.name!=='AbortError'&&e.message!=='Transfer cancelled'; item.status = item.error?e.message:'Cancelled'; renderTransfers(); throw e; }
}
async function uploadFiles(a, files, path = a.path) {
  for (const file of files) {
    try { await putFile(a, file, {path}); }
    catch (e) { report(e); }
  }
  if(a.link.state==='online')await listFiles(a, path);
}
async function attachFiles(a, t, files) {
  if (!t) throw new Error('Open a shell before attaching a file.');
  if (!files.length) return;
  // Capture destination shell now. Changing tabs during an upload cannot paste into another shell.
  const body = el('div');
  const image = files.length === 1 && files[0].type.startsWith('image/');
  let previewURL = '';
  if (image) { previewURL = URL.createObjectURL(files[0]); body.append(el('img', {class: 'modal-preview', src: previewURL, alt: files[0].name})); }
  body.append(el('p', {class: 'modal-copy', text: `${files.map(f => f.name).join(', ')} → ${a.machine.name} / ${t.session.name}`}),
    el('p', {class: 'modal-copy', text: 'Upload & insert path transfers the file to the host and inserts a safely quoted path, without Enter. Ask your CLI agent to read that path. Native paste instead puts a PNG in the host desktop clipboard, then sends Ctrl+V.'}));
  const doUpload = async native => {
    closeModal();
    for (const input of files) await deliverAttachment(a,t,input,native,files.length>1);
    selected = a.machine.room; view = 'terminal'; await selectSession(a, t.session.id);
  };
  const actions = el('div', {class: 'modal-actions'}, button('Upload & insert path', () => doUpload(false), 'button primary', 'upload'));
  if (image) {
    const native = button('Native image paste', () => doUpload(true), 'button', 'paste');
    native.disabled = !a.info?.clipboard?.image; actions.append(native);
    body.append(el('p', {class: 'modal-copy', text: a.info?.clipboard?.image
      ? `Desktop clipboard: ${a.info.clipboard.backend}. The CLI must support image pasting; jaunt cannot force an arbitrary terminal program to interpret an image.`
      : 'This host is headless or has no supported image clipboard. Use Upload & insert path. No image will be silently converted into terminal text.'}));
  }
  body.append(actions); modal(image ? 'Send image to terminal' : 'Attach to terminal', body, () => { if (previewURL) URL.revokeObjectURL(previewURL); });
}
async function remoteClipboard(a) {
  let offset = 0, total = 1; const parts = [];
  while (offset < total) {
    const value = await a.link.request('clipboard.get', {offset});
    const raw = unb64(value.data); total = value.size;
    if (value.offset !== offset || (offset < total && !raw.length)) throw new Error('Clipboard changed; try again.');
    parts.push(raw); offset += raw.length;
  }
  return new TextDecoder().decode(await new Blob(parts).arrayBuffer());
}
async function setRemoteClipboard(a, text) {
  const raw = utf8(text); if (raw.length > 1024 * 1024) throw new Error('The clipboard limit is 1 MiB.');
  if (!raw.length) { await a.link.request('clipboard.set', {text: ''}); return; }
  for (let offset = 0; offset < raw.length; offset += 32768) await a.link.request('clipboard.set', {
    offset, data: b64(raw.subarray(offset, offset + 32768)), done: offset + 32768 >= raw.length});
}
async function showClipboard(a = online()) {
  const text = await remoteClipboard(a); a.remoteClipboard = text;
  const area = el('textarea', {class: 'copy-text', value: text, readOnly: true, 'aria-label': 'Remote clipboard'});
  modal('Remote clipboard', el('div', {}, el('p', {class: 'modal-copy', text: `Text from ${a.machine.name}. A headless machine uses jaunt’s private text buffer (printf … | jaunt clip).`}), area,
    el('div', {class: 'modal-actions'}, button('Copy to this device', () => copyText(text), 'button primary', 'copy'),
      activeTerm(a) ? button('Insert in shell', async () => { closeModal(); await insertText(a, activeTerm(a), text); }, 'button', 'terminal') : null)));
}
function compose(initial = '', label = 'Compose text') {
  const a = online(), t = activeTerm(a); if (!t) throw new Error('Open a terminal first.');
  const area = el('textarea', {class: 'compose-text', value: initial, placeholder: 'Write or paste an instruction…', spellcheck: false, 'aria-label': 'Text to insert'});
  const execute = el('input', {type: 'checkbox'});
  modal(label, el('div', {}, area, el('label', {class: 'checkbox-label compose-execute'}, execute, 'Send Enter after inserting (may execute commands)'),
    el('div', {class: 'modal-actions'}, button('Remote clipboard', async () => { await setRemoteClipboard(a, area.value); toast('Saved in the remote clipboard.'); }),
      button('Insert in terminal', async () => {
        const text = area.value; closeModal(); await insertText(a, t, text);
        // Multiline unbracketed input uses a confirmation modal. Do not send Enter before that decision.
        if (execute.checked && !( /[\r\n]/.test(text) && !t.term.modes.bracketedPasteMode)) {
          // xterm paste emits onData synchronously and sendQueue preserves the order.
          await sendInput(a, t, '\r');
        }
      }, 'button primary'))));
  area.focus();
}
function clipboardFiles(data) {
  const files = Array.from(data?.files || []);
  if (files.length) return files;
  return Array.from(data?.items || []).filter(item => item.kind === 'file')
    .map(item => item.getAsFile()).filter(Boolean);
}
async function deliverAttachment(a,t,input,native,multiple=false,operationId=random(8)) {
  const job=activity(operationId,`${input.name} → ${t.session.name}`);
  job.update({status:'Preparing image or file…'});
  try {
    const file=input.type.startsWith('image/') ? await toPNG(input) : input;
    const result=await putFile(a,file,{attachment:true},job);
    if(!a.sessions.some(s=>s.id===t.session.id && s.alive))throw new Error('Uploaded, but the destination shell closed. The file remains available in Files → Transfers.');
    job.update({status:native?'Copying to host clipboard and sending Ctrl+V…':'Inserting the uploaded path…',percent:null});
    if(native)await a.link.request('clipboard.image',{path:result.path,session:t.session.id,paste:true});
    else {await insertText(a,t,quotePath(result.path)+(multiple?' ':''));await a.link.request('session.list');}
    job.finish(native?'Host clipboard ready · Ctrl+V sent · no Enter':'Uploaded and verified · path inserted · no Enter');
  } catch(error){job.fail(error);job.update({action:{label:'Try again',run:()=>deliverAttachment(a,t,input,native,multiple,operationId)}});throw error;}
}
async function pasteFiles(a, t, files) {
  // The destination is captured before any async clipboard read or upload.
  // Unsupported hosts keep the explicit upload/path choice, never a fake paste.
  if (files.length !== 1 || !files[0].type.startsWith('image/') || !a.info?.clipboard?.image) {
    await attachFiles(a, t, files); return;
  }
  closeModal();
  await deliverAttachment(a,t,files[0],true);
  selected = a.machine.room; view = 'terminal'; await selectSession(a, t.session.id);
}
function showPastePanel(a, t) {
  const zone = el('div', {class: 'paste-zone', contentEditable: 'true', role: 'textbox',
    'aria-label': 'Paste text or image', 'aria-multiline': 'true',
    'data-placeholder': 'Long-press here and choose Paste', spellcheck: false});
  let busy = false;
  const accept = async files => {
    if (busy || !files.length) return;
    busy = true; zone.replaceChildren();
    try { await pasteFiles(a, t, files); } catch (error) { busy = false; report(error); }
  };
  const receive = event => {
    const data = event.clipboardData || event.dataTransfer;
    if (!data) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const files = clipboardFiles(data);
    if (files.length) { accept(files); return; }
    // Some mobile keyboards expose an image as HTML instead of FileList.
    // Parse inertly; never insert clipboard HTML or fetch an external image URL.
    const html = data.getData('text/html');
    const doc = html ? new DOMParser().parseFromString(html, 'text/html') : null;
    const source = doc?.querySelector('img')?.getAttribute('src') || '';
    const embedded = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(source);
    if (embedded) {
      try {
        if (embedded[2].length > 44 * 1024 * 1024) throw new Error('Clipboard image exceeds 32 MiB. Use Attach instead.');
        const bytes = Uint8Array.from(atob(embedded[2]), c => c.charCodeAt(0));
        accept([new File([bytes], `clipboard-${Date.now()}.png`, {type: embedded[1]})]);
      } catch (error) { report(error); }
      return;
    }
    zone.textContent = data.getData('text/plain');
    if (!zone.textContent) toast('The browser did not provide image data. Choose the screenshot with Choose image.');
  };
  zone.addEventListener('paste', receive);
  zone.addEventListener('beforeinput', event => { if (event.dataTransfer) receive(event); });
  const choose = el('input', {type: 'file', accept: 'image/*', hidden: true});
  choose.onchange = () => { const files = Array.from(choose.files); choose.value = ''; accept(files); };
  const note = a.info?.clipboard?.image
    ? `An image will be uploaded, copied to the host clipboard and pasted with Ctrl+V into ${t.session.name}. No Enter is sent.`
    : 'This host has no desktop image clipboard. Images use Upload & insert path, without Enter.';
  modal('Paste text or image', el('div', {},
    el('p', {class: 'modal-copy', text: 'The clipboard API returned no usable content. Long-press in the area below and choose Paste, or choose your screenshot.'}),
    zone, el('p', {class: 'modal-copy', text: note}), choose,
    el('div', {class: 'modal-actions'}, button('Choose image', () => choose.click(), 'button', 'image'),
      button('Insert text', async () => { const text = zone.innerText; if (!text) throw new Error('Paste text or choose an image first.'); closeModal(); await insertText(a, t, text); }, 'button primary'))));
  zone.focus();
}
async function pasteDevice() {
  const a = online(), t = activeTerm(a);
  if (!t) throw new Error('Open a shell first.');
  let files = [], text = '';
  if (isAndroid) {
    ({files, text} = await nativeClipboard());
    if (files.length) await pasteFiles(a, t, files);
    else if (text) await insertText(a, t, text);
    else showPastePanel(a, t);
    return;
  }
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) for (const type of item.types.filter(v => v.startsWith('image/'))) {
        files.push(new File([await item.getType(type)], `clipboard-${Date.now()}.png`, {type})); break;
      }
      if (!files.length) for (const item of items) if (item.types.includes('text/plain')) {
        text = await (await item.getType('text/plain')).text(); if (text) break;
      }
    } else if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
  } catch { /* A user-triggered rich paste remains possible without async read permission. */ }
  // Do not swallow upload/host errors as if they were clipboard permission errors.
  if (files.length) await pasteFiles(a, t, files);
  else if (text) await insertText(a, t, text);
  else showPastePanel(a, t);
}
function copyMenu() {
  const a = checked(current()), t = activeTerm(a);
  const body = el('div', {class: 'file-menu'});
  if (t) {
    if (t.term.getSelection()) body.append(button('Copy selection', () => copyText(t.term.getSelection()), 'button primary', 'copy'));
    body.append(button('Copy terminal scrollback', () => copyText(terminalText(t)), 'button', 'copy'));
    body.append(button('Select / search / copy as text', () => {
      const text = terminalText(t), area = el('textarea', {class: 'copy-text', value: text, readOnly: true, 'aria-label': 'Terminal scrollback'});
      modal('Terminal text', el('div', {}, area, el('div', {class: 'modal-actions'}, button('Select all', () => { area.focus(); area.select(); }), button('Copy all', () => copyText(text), 'button primary'), button('Save .txt', () => saveBlob(new Blob([text], {type: 'text/plain'}), `${t.session.name}.txt`)))));
    }, 'button', 'search'));
  }
  if (a.link.state === 'online') body.append(button('Read remote clipboard', () => showClipboard(a), 'button', 'paste'));
  if (a.remoteClipboard) body.append(button('Copy last terminal clipboard (OSC 52)', () => copyText(a.remoteClipboard), 'button', 'copy'));
  modal('Copy & clipboard', body);
}

function settingsRow(title, description, control) {
  return el('div', {class: 'settings-row'}, el('div', {class: 'settings-label'}, el('strong', {text: title}), el('p', {text: description})), control);
}
function settingsGroup(title, ...rows) { return el('section', {class: 'settings-group'}, el('h3', {text: title}), ...rows); }
function applyTheme() {
  const mode = themeMode(prefs().theme);
  document.documentElement.dataset.theme = mode;
  const light = mode === 'light';
  for (const a of machines.values()) for (const t of a.terms.values()) t.term.options.theme = {
    ...t.term.options.theme, background: light ? '#f7f8f5' : '#111314', foreground: light ? '#252b24' : '#d9dfd3',
    cursor: light ? '#875512' : '#e7a246', selectionBackground: light ? '#cbdac5' : '#455342'};
}
setInterval(() => { if (vault.data) applyTheme(); }, 60000);
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (vault.data) applyTheme(); });
function hostPreferences(a) {
  const name = el('input', {value:a.machine.friendlyName || a.machine.name, maxlength:80, 'aria-label':'Friendly host name'});
  name.onchange = async () => { a.machine.friendlyName = name.value.trim().slice(0,80) || a.machine.name; await persist(); render(); };
  const order = el('div',{class:'modal-actions'});
  for (const [delta,label] of [[-1,'Move up'],[1,'Move down']]) order.append(button(label,async()=>{
    const list=vault.data.machines, from=list.indexOf(a.machine), to=from+delta;
    if(to<0||to>=list.length)return;
    [list[from],list[to]]=[list[to],list[from]];await persist();renderMachines();
  }));
  return [settingsRow('Friendly name','Only changes the name on this device.',name),settingsRow('Host order','Choose the order in the sidebar.',order),
    settingsRow('Open by default',prefs().defaultHost === a.machine.room ? 'This host opens when the app starts.' : 'Choose the first host shown when the app starts.',button('Use this host',async()=>{vault.data.preferences.defaultHost=a.machine.room;await persist();renderSettings();}))];
}
function attentionSettings(a) {
  return ['bell','program','exit'].map(key => {
    const input=el('input',{type:'checkbox',checked:a.info?.notifications?.[key] !== false,'aria-label':key+' notifications'});
    input.onchange=async()=>{try {a.info.notifications=await a.link.request('notifications.configure',{...a.info.notifications,[key]:input.checked});}catch(e){input.checked=!input.checked;report(e);}};
    return settingsRow({bell:'Terminal bell',program:'Program notifications',exit:'Session finished'}[key],{bell:'When a terminal rings its attention bell.',program:'OSC 9 and OSC 777 notifications from terminal programs.',exit:'When the shell exits. For individual command completion, use jaunt run -- command.'}[key],input);
  });
}
function desktopUpdateStatus(value) {
  const changed=desktopUpdateState?.state!==value.state || desktopUpdateState?.automatic!==value.automatic;
  desktopUpdateState=value;
  if((!desktopUpdateOperation || desktopUpdateOperation.item.dismissed) && ['downloading','verifying','ready','installed','error'].includes(value.state))desktopUpdateOperation=activity('desktop-update','Desktop update');
  const job=desktopUpdateOperation;
  if(job){
    job.update({status:value.message+(value.target?' · '+value.target:''),percent:value.percent??null,done:false,error:false,waiting:false,action:null});
    if(value.state==='error'){job.fail(new Error(value.message));job.update({action:{label:'Try again',run:checkDesktopUpdate}});}
    else if(value.state==='ready')job.update({done:true,waiting:true,status:value.message+(value.target?' · '+value.target:'')+(value.requiresAuthorization?' System authorization will be requested.':''),action:{label:'Install and reopen',run:()=>desktop.updates('install')}});
    else if(['current','installed'].includes(value.state))job.finish(value.message);
  }
  if(view==='settings' && changed)renderSettings();
}
async function checkDesktopUpdate(){
  desktopUpdateOperation=activity('desktop-update','Desktop update');
  desktopUpdateOperation.update({status:'Checking published version…'});
  try{desktopUpdateStatus(await desktop.updates('check'));}catch(error){desktopUpdateOperation.fail(error);}
}
const hostUpdateJobs=new Map();
async function checkHostUpdate(a,allowRestart=false) {
  if(hostUpdateJobs.has(a.machine.room))return;
  const job=activity('host-update-'+a.machine.room,`Host update · ${a.machine.name}`);
  hostUpdateJobs.set(a.machine.room,job);
  try {
    job.update({status:'Checking published version…'});
    const requestedAt=Date.now()/1000;
    const started=await a.link.request('updates.install',{allowRestart});
    for(let i=0;i<600;i++) {
      await new Promise(resolve=>setTimeout(resolve,1000));
      if(!vault.data || !machines.has(a.machine.room))return;
      if(a.link.state!=='online'){if(!a.link.enabled)throw new Error('Connection stopped. Reconnect to this host to check the update result.');job.update({status:'Waiting for the host to reconnect…'});continue;}
      let result;
      try {result=await a.link.request('updates.status');} catch(error) {
        if(a.link.state!=='online')continue;
        throw error;
      }
      if(started.operation && result.operation!==started.operation)continue;
      if(!started.operation && result.checkedAt && result.checkedAt<Math.floor(requestedAt))continue;
      a.info.updates=result;
      const labels={checking:'Checking published version…',downloading:'Downloading host update…',verifying:'Verifying downloaded files…',installing:'Installing · waiting for restart…',current:'Up to date',installed:'Update installed',deferred:'Downloaded · waiting for active shells or transfers to finish',error:'Update failed'};
      const message=result.message || labels[result.state] || 'Checking…';
      job.update({status:message+(result.version?' · '+result.version:'')});
      if(['current','installed','deferred','error','disabled'].includes(result.state)) {
        if(result.state==='error')job.fail(new Error(message));
        else job.finish(message+(result.version?' · '+result.version:''));
        if(result.state==='deferred')job.update({waiting:true});
        if(result.state==='error')job.update({action:{label:'Try again',run:()=>checkHostUpdate(a)}});
        if(result.state==='deferred')job.update({action:{label:'Review update',run:()=>{selected=a.machine.room;setView('settings');}}});
        if(view==='settings')renderSettings();
        return;
      }
    }
    throw new Error('The host has not confirmed completion yet. Check again to see its current state.');
  } catch(error){job.fail(error);job.update({action:{label:'Try again',run:()=>checkHostUpdate(a)}});}
  finally {if(hostUpdateJobs.get(a.machine.room)===job)hostUpdateJobs.delete(a.machine.room);}
}
async function installLocalHost() {
  const job=activity('host-install','Install local host');job.update({status:'Downloading and installing the host…'});
  try {const result=await desktop.action('install');job.finish(result.message);machines.get('local-host')?.link.start();}
  catch(error){job.fail(error);job.update({action:{label:'Try again',run:installLocalHost}});}
}
function renderSettings() {
  if (!vault.data) return;
  const a = current(), content = $('settings-content');
  const font = el('select', {'aria-label': 'Terminal font size'});
  for (const n of [11, 12, 13, 14, 15, 16, 18, 20]) font.append(el('option', {value: n, text: `${n} px`, selected: n === (prefs().fontSize || 14)}));
  font.onchange = async () => {
    vault.data.preferences.fontSize = Number(font.value);
    for (const host of machines.values()) for (const t of host.terms.values()) t.term.options.fontSize = Number(font.value);
    await persist(); fitActive();
  };
  const lockTime = el('select', {'aria-label': 'Automatic lock delay'});
  for (const [n, label] of [[0, 'Off'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [60, '1 hour']]) lockTime.append(el('option', {value: n, text: label, selected: n === (prefs().autoLock || 0)}));
  lockTime.onchange = async () => { vault.data.preferences.autoLock = Number(lockTime.value); await persist(); };
  const reader = el('input', {type: 'checkbox', checked: !!prefs().screenReader, 'aria-label': 'Screen reader mode'});
  reader.onchange = async () => {
    vault.data.preferences.screenReader = reader.checked;
    for (const host of machines.values()) for (const t of host.terms.values()) t.term.options.screenReaderMode = reader.checked;
    await persist();
  };
  const theme = el('select', {'aria-label':'Color theme'}, ...[['dark','Dark'],['light','Light'],['system','System'],['circadian','Circadian']].map(([value,text])=>el('option',{value,text,selected:(prefs().theme||'dark')===value})));
  theme.onchange=async()=>{vault.data.preferences.theme=theme.value;applyTheme();await persist();};
  const groups = [
    settingsGroup('THIS DEVICE',
      settingsRow('Appearance','Circadian uses light from 07:00 to 19:00 in your local time zone.',theme),
      settingsRow('Local vault', vault.protected ? 'Remembered machine keys are encrypted at rest with your passphrase or PIN.' : 'Machine keys are stored in this browser profile. Protect them on a shared or unlocked device.',
        button(vault.protected ? 'Change protection' : 'Set passphrase / PIN', protectVault)),
      settingsRow('Automatic lock', 'Locks this browser after inactivity. Shells remain alive on the host. Requires vault protection.', lockTime),
      ...(vault.protected ? [settingsRow('Lock now', 'Disconnects the browser and removes terminal contents from this view.', button('Lock', lockWorkspace, 'button', 'lock'))] : []),
      el('p', {class: 'settings-notice', text: 'A six-digit PIN is less resistant to offline guessing than a long passphrase. Clearing browser data loses pairings. No account recovery or secret escrow.'})),
    settingsGroup('TERMINAL', settingsRow('Text size', 'Applies to all terminal tabs on this device.', font),
      settingsRow('Screen reader support', 'Enables xterm’s accessible text layer.', reader),
      el('p', {class: 'settings-notice', text: 'Plain PTYs survive network loss, not host daemon restarts or reboots. Use tmux for independent sessions. Open the desktop app to use the same jaunt shells locally and remotely, without tmux. Existing terminals created outside jaunt require tmux attachment.'}))
  ];
  if (a) {
    groups.push(settingsGroup('SELECTED MACHINE',
      ...hostPreferences(a),
      settingsRow(a.machine.name, `${a.info?.platform || 'Remote host'} · ${a.info?.version || 'Connecting'} · ${a.link.state}`, button('Reconnect', () => { a.link.start(); })),
      ...(a.info?.updates?.supported ? [settingsRow('Automatic host updates', a.info.updates.message || 'Checks every 15 minutes. Downloads are verified; ordinary active shells are never closed automatically.', button(a.info.updates.automatic ? 'Disable auto-update' : 'Enable auto-update', async () => { a.info.updates = await a.link.request('updates.configure', {automatic: !a.info.updates.automatic}); renderSettings(); })),
        settingsRow('Host version', a.info.version+(a.info.updates?.state==='deferred'?' · update ready: '+a.info.updates.version:''), button('Check for updates', ()=>checkHostUpdate(a))),
        settingsRow('Update and restart now', 'This explicitly closes ordinary shells and interrupts ongoing transfers. Pairing keys are preserved.', button('Update and restart', () => confirmAction('Close active shells and update?', 'This may terminate running commands in ordinary shells and interrupt file transfers on this host. Continue only when ready.', 'Close shells and update', ()=>checkHostUpdate(a,true), true), 'button danger'))] : []),
      settingsRow('Host clipboard', a.info?.clipboard?.backend || 'Unknown until connected', button('Open', () => showClipboard(a))),
      settingsRow('Authorized devices', 'Devices have the same rights as this host user. Revoke a lost phone from here or with jaunt revoke.', button('Manage', () => manageDevices(a))),
      ...(!a.machine.local ? [settingsRow('Forget this machine', 'Removes its saved key from this browser. Revoke it on the host first when possible.', button('Forget', () => forgetMachine(a), 'button danger'))] : [])));
    groups.push(settingsGroup('NOTIFICATIONS',
      ...(a.info?.sharedViews ? attentionSettings(a) : []),
      ...(!desktop ? [settingsRow(isAndroid ? 'Android background notifications' : 'Background push', isAndroid ? 'Keep an encrypted connection using an Android foreground service. A persistent notification lets you stop it. Battery restrictions can delay delivery.' : a.machine.push ? 'Registered for this machine. Delivery depends on browser/OS permissions and the host being online.' : 'Standard Web Push sent by your host. No ntfy, bot or third-party notification account.',
        button(a.machine.push ? 'Disable' : 'Enable', async () => {
          if (a.machine.push) await push.unsubscribe(vault, a.link); else await push.subscribe(vault, a.link);
          renderSettings(); toast('Notification preference saved.');
        }))] : []),
      settingsRow('Test delivery', 'Notifications show the title and message sent by the program.', button('Send test', async () => {
        const result = await a.link.request('notifications.test');
        toast(desktop ? 'Test sent. Background the desktop app to see its OS notification.' : isAndroid ? 'Test sent. Check Android notifications after enabling the background connection.' : result.delivered ? 'Push sent to the notification provider.' : result.results?.join('; ') || 'No push subscription delivered; a live in-app notification may still appear.', !desktop && !isAndroid && !result.delivered);
      })),
      el('p', {class: 'settings-notice', text: (isAndroid ? 'The Android service reconnects with your saved keys. Force-stop and some battery-saving modes prevent delivery. Notification content follows your Android lock-screen privacy settings. ' : '') + 'From any jaunt shell: jaunt notify "Need your attention". For command completion: jaunt run -- your-command. Closing/force-stopping the browser or battery restrictions can delay or block push; delivery is not guaranteed by the operating system.'})));
  }
  if (desktop) {
    const notifications=el('input',{type:'checkbox',checked:!!prefs().desktopNotifications,'aria-label':'Desktop notifications'});
    notifications.onchange=async()=>{vault.data.preferences.desktopNotifications=notifications.checked;await persist();};
    const autoDesktop=el('input',{type:'checkbox',checked:desktopUpdateState?.automatic!==false,'aria-label':'Automatic desktop updates'});
    autoDesktop.onchange=()=>desktop.updates('configure',autoDesktop.checked).then(desktopUpdateStatus).catch(report);
    groups.push(settingsGroup('DESKTOP APP',
      settingsRow('Desktop version',desktopUpdateState?.message || 'Loading update status…',button('Check desktop update',checkDesktopUpdate)),
      settingsRow('Automatic desktop updates','Downloads and verifies updates automatically. Installs when the app closes; host shells keep running. System packages may require OS authorization.',autoDesktop)));
    groups.push(settingsGroup('THIS COMPUTER',
      settingsRow('Install or update the host','Installs the official host and its background user service on this computer. Skip this if you only connect to other hosts.',button('Install / update host',installLocalHost)),
      settingsRow('Update safely','Checks the published host version. Active ordinary shells prevent a restart.',button('Check host update',()=>checkHostUpdate(checked(machines.get('local-host'))))),
      settingsRow('Restart for update','Explicitly closes ordinary shells on this computer. Use only when your jobs are finished.',button('Update and restart',()=>confirmAction('Close local shells and update?','This terminates ordinary shells and their foreground work on this computer.','Close shells and update',()=>checkHostUpdate(checked(machines.get('local-host')),true),true),'button danger')),
      settingsRow('Local host','Local and remote views share the same shells. Closing this window leaves them running.',button('Start host',async()=>{await desktop.action('start');machines.get('local-host')?.link.start();})),
      settingsRow('Start automatically','Install the user service. Active ordinary shells must be closed explicitly before replacing an existing daemon.',button('Install service',async()=>{const job=activity('host-service','Automatic host startup');try{job.update({status:'Installing and enabling the user service…'});const result=await desktop.action('service');job.finish(result.message);machines.get('local-host')?.link.start();}catch(error){job.fail(error);}})),
      settingsRow('Connect another device','Create a private one-use pairing link for this host.',button('Pair device',async()=>{const result=await desktop.action('pair');modal('Pair this computer',el('div',{},...(result.qr?[el('img',{class:'pair-qr',src:'data:image/svg+xml;base64,'+result.qr,alt:'One-use pairing QR code'})]:[]),el('p',{text:'Open this one-use link on your other device. It expires after ten minutes. Keep it private.'}),el('textarea',{class:'pair-code',readOnly:true,value:result.url}),button('Copy pairing link',()=>copyText(result.url))));})),
      settingsRow('Desktop notifications','Show the program’s notification when this window is in the background.',notifications)));
  }
  if(desktopRelease && !desktop && !isAndroid) groups.push(settingsGroup('DESKTOP APP',settingsRow('Install jaunt on this computer','Shared local and remote shells, persistent tiled tabs, host controls and native notifications.',el('a',{class:'button primary',text:'Download desktop app',href:desktopRelease,target:'_blank',rel:'noopener noreferrer'}))));
  if (androidAPK && !isAndroid) groups.push(settingsGroup('ANDROID APP', settingsRow('Install the APK', 'Native Android clipboard, camera and background notifications. Your browser pairing stays separate.', el('a', {class: 'button primary', text: 'Download Android APK', href: androidAPK}))));
  const install = button(installedPrompt ? 'Install app' : 'Installation help', async () => {
    if (installedPrompt) { await installedPrompt.prompt(); await installedPrompt.userChoice; installedPrompt = null; renderSettings(); }
    else modal('Install jaunt on your phone', el('div', {}, el('p', {class: 'modal-copy', text: 'Open the browser menu and choose “Install app” or “Add to Home screen”. On iPhone/iPad, use Safari → Share → Add to Home Screen. This installs the web app. For Android camera, clipboard and notification integration, use Download Android APK in Settings.'})));
  });
  groups.push(settingsGroup('jaunt', settingsRow(isAndroid ? 'jaunt for Android' : 'Installable web app', isAndroid ? 'Installed APK · bundled interface and native Android integrations.' : 'A focused window on your home screen, with the same remembered machines.', isAndroid ? button('Check for updates', () => nativeCall('app.updates')) : install),
    el('p', {class: 'settings-notice', text: 'jaunt 0.1.0 beta · Host-authenticated encrypted channels · Open source. The custom protocol has automated tests, not an independent security audit. The relay transports ciphertext but can see routing metadata and interrupt availability. Never pair an untrusted device.'})));
  content.replaceChildren(...groups);
}
function protectVault() {
  const first = el('input', {type: 'password', autocomplete: 'new-password', minLength: 6});
  const second = el('input', {type: 'password', autocomplete: 'new-password', minLength: 6});
  const actions = el('div', {class: 'modal-actions'}, button('Save protection', async () => {
    if (first.value !== second.value) throw new Error('The two values do not match.');
    await vault.protect(first.value); closeModal(); renderSettings(); render(); toast('Vault protection enabled.');
  }, 'button primary'));
  if (vault.protected) actions.append(button('Remove protection', () => confirmAction('Remove local protection?', 'Anyone who can use this browser profile will be able to reconnect to your hosts without a PIN.', 'Remove', async () => {
    await vault.unprotect(); renderSettings(); render();
  }, true), 'button danger'));
  modal('Protect this device', el('div', {}, el('p', {class: 'modal-copy', text: 'Choose at least six characters. A long passphrase protects better than a short PIN. This encrypts remembered keys in the browser; it is not a password sent to the relay.'}),
    field('New passphrase or PIN', first), field('Repeat it', second), actions)); first.focus();
}
async function manageDevices(a) {
  const devices = await a.link.request('devices.list');
  const body = el('div', {class: 'file-menu'});
  for (const device of devices) body.append(el('div', {class: 'settings-row'},
    el('div', {class: 'settings-label'}, el('strong', {text: device.name + (device.id === a.machine.deviceId ? ' · this browser' : '')}),
      el('p', {text: `Last seen ${new Date(device.lastSeen * 1000).toLocaleString()}`})),
    button('Revoke', () => confirmAction('Revoke this device?', `${device.name} will lose access immediately. Its existing PTYs are not terminated.`, 'Revoke', async () => {
      await a.link.request('devices.revoke', {id: device.id});
      if (device.id === a.machine.deviceId) { a.link.stop('Revoked'); toast('This device was revoked on the host.'); }
      else toast('Device revoked.');
    }, true), 'button danger')));
  modal('Authorized devices', body);
}
function forgetMachine(a) {
  confirmAction('Forget this machine?', 'This removes its key locally. It does not terminate shells or revoke other browsers. To revoke this saved identity on the host, use Authorized devices first.', 'Forget', async () => {
    if (isAndroid) await nativeCall('notifications.disable', {room: a.machine.room});
    a.link.stop(); for (const t of a.terms.values()) { t.term.dispose(); t.node.remove(); }
    machines.delete(a.machine.room); vault.data.machines = vault.data.machines.filter(m => m.room !== a.machine.room);
    if (selected === a.machine.room) selected = vault.data.machines[0]?.room || null;
    await persist(); render(); renderSettings();
  }, true);
}
async function lockWorkspace() {
  if (!vault.protected || !vault.data) return;
  closeModal(); drawer(); clearActivity(); clearFeedback();hostUpdateJobs.clear();
  for (const a of machines.values()) { a.link.stop('Locked'); for (const t of a.terms.values()) { t.term.dispose(); t.node.remove(); } }
  for (const t of transfers) if (!t.done) t.controller.abort();
  machines.clear(); transfers.length = 0;
  $('machine-list').replaceChildren(); $('tabs').replaceChildren(); $('file-list').replaceChildren(); $('settings-content').replaceChildren(); $('transfer-list').replaceChildren(); $('toasts').replaceChildren();
  $('terminal-meta').textContent = ''; $('machine-title').textContent = 'Locked';
  await vault.lock(); $('lock-screen').hidden = false; $('unlock-password').value = ''; $('unlock-error').textContent = '';
}
async function resumeWorkspace() {
  selected = null;
  if(desktop && !vault.data.machines.some(m=>m.local)){vault.data.machines.unshift({room:'local-host',name:'This computer',local:true});await persist();}
  for (const m of vault.data.machines) makeMachine(m);
  selected = machines.has(deepLink.get('host')) ? deepLink.get('host') : (machines.has(prefs().defaultHost) ? prefs().defaultHost : vault.data.machines[0]?.room) || null;
  applyTheme();
  for (const a of machines.values()) a.link.start();
  $('lock-screen').hidden = true; activeAt = Date.now(); render(); renderTransfers();
  if(isAndroid)window.dispatchEvent(new Event('jaunt-native-open'));
  if (pairedFromURL) { const code = pairedFromURL; pairedFromURL = ''; await pairMachine('jaunt1.' + code); }
}
function openNotification(host, session) {
  deepLink.set('host',host);deepLink.set('session',session || '');
  const a=machines.get(host);if(!a || !vault.data)return;
  selected=host;setView('terminal');
  if(a.sessions.some(s=>s.id===session)) {
    deepLink.delete('session');selectSession(a,session).catch(report);
  }
}
function updateModifiers() { $('ctrl-key').setAttribute('aria-pressed', String(ctrl)); $('alt-key').setAttribute('aria-pressed', String(alt)); }
let viewportTimer;
function viewport() {
  const v = window.visualViewport;
  document.documentElement.style.setProperty('--app-height', `${Math.round(v?.height || innerHeight)}px`);
  document.body.classList.toggle('keyboard-open', !!window.jauntKeyboardVisible || (!!v && innerHeight - v.height > 130));
  clearTimeout(viewportTimer);viewportTimer=setTimeout(fitActive,150);
}
function bindEvents() {
  $('menu-button').onclick = () => drawer(!$('sidebar').classList.contains('open'));
  $('drawer-backdrop').onclick = () => drawer(); $('add-machine').onclick = showPair;
  $('pair-submit').onclick = async () => { $('pair-submit').disabled = true; try { await pairMachine($('pair-code').value); } catch (e) { reportError(e,'pair'); } finally { $('pair-submit').disabled = false; } };
  $('scan-welcome').onclick = () => scan(pairMachine).catch(report);
  $('copy-install').onclick = () => copyText($('install-command').textContent).catch(report);
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);
  $('select-terminal-text').onclick = () => {try{selectTerminalText();}catch(e){report(e);}};
  $('list-sessions').onclick = () => {try{sessionList();}catch(e){report(e);}};
  $('arrange-panes').onclick = () => { try { arrangePanes('x'); } catch(e) { report(e); } };
  $('scroll-bottom').onclick = () => activeTerm(current())?.term.scrollToBottom();
  $('settings-button').onclick = () => setView('settings'); $('lock-button').onclick = () => lockWorkspace().catch(report);
  for (const id of ['new-session-top', 'new-session-tab', 'new-session-empty']) $(id).onclick = () => newSession().catch(report);
  $('split-below').onclick = () => {try {arrangePanes('y');} catch(e) {report(e);}};
  $('new-session-folder').onclick = () => browseNewSession().catch(report);
  $('rename-session').onclick = () => { try { renameSession(); } catch(e) { report(e); } };
  $('close-files').onclick = () => setView('terminal');
  $('file-path').oninput = () => { if (current()) current().pathDraft = $('file-path').value; };
  $('file-path-form').onsubmit = e => { e.preventDefault(); listFiles(online(), $('file-path').value).catch(report); };
  $('file-up').onclick = () => { const a = current(); if (a?.listing) listFiles(a, a.listing.parent).catch(report); };
  $('file-refresh').onclick = () => { if (current()) listFiles(current()).catch(report); };
  $('show-hidden').onchange = () => { if (current()) listFiles(current()).catch(report); };
  $('file-mkdir').onclick = () => {
    try {
      const a = online(), name = el('input', {placeholder: 'new-folder'});
      modal('New folder', el('div', {}, field('Name', name), el('div', {class: 'modal-actions'}, button('Create folder', async () => {
        await a.link.request('files.mkdir', {path: a.path, name: name.value}); closeModal(); await listFiles(a);
      }, 'button primary'))));
    } catch (e) { report(e); }
  };
  let uploadDestination, attachmentDestination;
  $('file-upload').onclick = () => { try { const a = online(); uploadDestination = {a, path: a.path}; $('upload-input').click(); } catch(e) { report(e); } };
  $('upload-input').onchange = async () => {
    const files = Array.from($('upload-input').files); $('upload-input').value = '';
    if (uploadDestination && files.length) await uploadFiles(uploadDestination.a, files, uploadDestination.path).catch(report);
  };
  $('attach-button').onclick = () => { try { const a = online(); const t = activeTerm(a); if (!t) throw new Error('Create a shell first.'); attachmentDestination = {a, t}; $('attachment-input').click(); } catch(e) { report(e); } };
  $('attachment-input').onchange = () => {
    const files = Array.from($('attachment-input').files); $('attachment-input').value = '';
    if (attachmentDestination) attachFiles(attachmentDestination.a, attachmentDestination.t, files).catch(report);
  };
  $('paste-button').onclick = () => pasteDevice().catch(report);
  $('copy-button').onclick = () => { try { copyMenu(); } catch (e) { report(e); } };
  $('compose-button').onclick = () => { try { compose(); } catch (e) { report(e); } };
  $('keyboard-button').onclick = () => activeTerm(current())?.term.focus();
  $('ctrl-key').onclick = () => { ctrl = !ctrl; updateModifiers(); activeTerm(current())?.term.focus(); };
  $('alt-key').onclick = () => { alt = !alt; updateModifiers(); activeTerm(current())?.term.focus(); };
  for (const b of document.querySelectorAll('[data-key]')) {
    // Preserve the mobile keyboard when pressing a modifier/arrow.
    b.onpointerdown = e => e.preventDefault();
    b.onclick = () => { try { const a = online(), t = activeTerm(a); if (!t) return;
      const data = b.dataset.key.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      sendInput(a, t, data).catch(report); t.term.focus();
    } catch (e) { report(e); } };
  }
  let dragDepth = 0;
  $('terminal-stage').ondragenter = e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth++; $('drop-target').hidden = false; } };
  $('terminal-stage').ondragover = e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); };
  $('terminal-stage').ondragleave = () => { if (--dragDepth <= 0) $('drop-target').hidden = true; };
  $('terminal-stage').ondrop = e => {
    e.preventDefault(); dragDepth = 0; $('drop-target').hidden = true;
    try { const a = online(); attachFiles(a, activeTerm(a), Array.from(e.dataTransfer.files)).catch(report); } catch (err) { report(err); }
  };
  $('files-view').ondragover = e => e.preventDefault();
  $('files-view').ondrop = e => { e.preventDefault(); try { const a = online(); uploadFiles(a, Array.from(e.dataTransfer.files)).catch(report); } catch(err) { report(err); } };
  $('unlock-form').onsubmit = async e => {
    e.preventDefault(); const b = $('unlock-form').querySelector('button'); b.disabled = true;
    try { await vault.unlock($('unlock-password').value); $('unlock-password').value = ''; $('unlock-error').textContent = ''; await resumeWorkspace(); }
    catch(err) { $('unlock-error').textContent = err.message; }
    finally { b.disabled = false; }
  };
  $('forget-vault').onclick = () => {
    // Native confirm remains accessible above the lock overlay and needs a gesture.
    if (!window.confirm('Reset all remembered machines on this browser? You will need new pairing codes. Remote authorizations must be revoked separately on each host.')) return;
    (async () => { if (isAndroid) await nativeCall('notifications.clear'); await vault.forgetAll(); location.reload(); })().catch(report);
  };
  window.addEventListener('hashchange', () => {
    const parameters = new URLSearchParams(location.hash.slice(1));
    if (!parameters.has('pair')) return;
    const code = parameters.get('pair');
    history.replaceState(null, '', location.pathname + location.search);
    if (!vault.data) { pairedFromURL = code; return; }
    pairMachine('jaunt1.' + code).catch(report);
  });
  window.addEventListener('online', () => { for (const a of machines.values()) if (a.link.state !== 'online') a.link.reconnect(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    const minutes = prefs().autoLock;
    if (minutes && vault.protected && hiddenAt && Date.now() - hiddenAt >= minutes * 60000) { lockWorkspace().catch(report); return; }
    for (const a of machines.values()) if (Date.now() - a.link.lastSeen > 50000) a.link.reconnect();
    viewport();
  });
  for (const event of ['pointerdown', 'keydown', 'input']) document.addEventListener(event, () => { activeAt = Date.now(); }, {passive: true});
  setInterval(() => { const minutes = prefs().autoLock; if (minutes && vault.protected && Date.now() - activeAt > minutes * 60000) lockWorkspace().catch(report); }, 10000);
  let layoutMobile=isMobile();
  window.addEventListener('resize', () => { viewport(); if(layoutMobile!==isMobile()){layoutMobile=isMobile();render();} });
  window.visualViewport?.addEventListener('resize', viewport);
  window.addEventListener('jaunt-insets',viewport);
  new ResizeObserver(fitActive).observe($('terminal-stage'));
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installedPrompt = e; if (view === 'settings') renderSettings(); });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); setView('settings'); }
  });
  async function nativeOpen() {
    if (!isAndroid || !vault.data) return;
    const state = await nativeCall('notifications.status');
    for (const m of vault.data.machines) m.push = !!state.enabled && (state.rooms || []).includes(m.room);
    if (view === 'settings') renderSettings();
    const target = await nativeCall('open.pending');
    const a = machines.get(target?.host);
    if (a) openNotification(target.host, target.session);
    const shared = await nativeClipboard('shared.read');
    if (shared.files.length) { const selectedMachine = current(), term = activeTerm(selectedMachine);
      if (!selectedMachine || !term) { toast('Open a shell, then share the image to jaunt again.', true); return; }
      confirmAction('Send this shared image?', `Send the image to ${term.session.name} on ${selectedMachine.machine.name}.`, 'Send image', () => pasteFiles(selectedMachine, term, shared.files));
    }
  }
  window.addEventListener('jaunt-native-open', () => nativeOpen().catch(report));
  if (isAndroid) setTimeout(() => nativeOpen().catch(report), 1500);
  let hadWebController=!!navigator.serviceWorker?.controller;
  navigator.serviceWorker?.addEventListener('controllerchange',()=>{
    if(!hadWebController){hadWebController=true;return;}
    const job=activity('web-update','Web update available');job.finish('Ready to apply. Reloading keeps your host shells open.');job.update({action:{label:'Reload now',run:()=>location.reload()}});
  });
  navigator.serviceWorker?.addEventListener('message', e => {
    if (e.data?.type !== 'open-session') return;
    openNotification(e.data.host, e.data.session);
  });
}
async function bootstrap() {
  if (!window.isSecureContext || !crypto.subtle) throw new Error('jaunt requires HTTPS, or localhost for development. Do not open index.html directly.');
  bindEvents(); viewport();
  if(desktop){desktop.onFrame(message=>{if(message.type==='desktop.update'){desktopUpdateStatus(message);return;}if(message.type==='desktop.open')openNotification(message.host,message.session);});desktop.updates('status').then(desktopUpdateStatus).catch(report);}
  await vault.load();
  if (vault.locked) { $('lock-screen').hidden = false; }
  else await resumeWorkspace();
  applicationStarted = true;
  if (isAndroid) await nativeCall('app.ready');
  if(!desktop) push.serviceWorker().catch(() => { /* Terminal still works when PWA/push are unavailable. */ });
  try {
    const response = await fetch('./config.json', {cache: 'no-store'});
    const config = await response.json();
    if (!isAndroid && /^android-v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(config.androidRelease || '')) {
      androidAPK = `https://github.com/moukrea/jaunt/releases/download/${config.androidRelease}/jaunt-${config.androidRelease}.apk`;
      const apk = el('a', {class: 'button primary', text: 'Download Android APK', href: androidAPK});
      if (view === 'settings') renderSettings();
      $('welcome').append(el('div', {class: 'android-download'}, apk, el('p', {class: 'modal-copy', text: 'Installable Android app with native clipboard, camera and background notifications.'})));
    }
    if(!desktop && !isAndroid && /^desktop-v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(config.desktopRelease||'')){
      desktopRelease=`https://github.com/moukrea/jaunt/releases/tag/${config.desktopRelease}`;
      $('welcome').append(el('div',{class:'android-download'},el('a',{class:'button',text:'Download desktop app',href:desktopRelease,target:'_blank',rel:'noopener noreferrer'}),el('p',{class:'modal-copy',text:'Linux and macOS. The host installer also adds the desktop app on graphical machines.'})));
      if(view==='settings')renderSettings();
    }
    if (!config.relay) {
      $('deployment-note').hidden = false;
      $('deployment-note').textContent = 'Project deployment pending: configure and deploy the relay before using the public installer. Local development and pairing to an existing jaunt host are available.';
    }
  } catch { $('deployment-note').hidden = false; $('deployment-note').textContent = 'Deployment configuration is unavailable. This does not affect existing paired machines.'; }
}
function fatal(error) {
  document.body.append(el('div', {class: 'fatal-note'}, el('div', {}, el('h2', {text: 'jaunt could not start'}), el('p', {class: 'modal-copy', text: error.message || String(error)}), button('Reload', () => location.reload(), 'button primary'))));
}
// One tab owns this browser's IndexedDB vault at a time; avoids last-writer-wins
// credential loss. Multiple devices and multiple terminal tabs remain supported.
if (navigator.locks) {
  navigator.locks.request('jaunt-workspace-owner', {ifAvailable: true}, async lock => {
    if (!lock) { fatal(new Error('jaunt is already open in another tab of this browser. Use that tab, or close it and reload here.')); return; }
    try { await bootstrap(); await new Promise(() => {}); } catch (e) { fatal(e); }
  }).catch(fatal);
} else bootstrap().catch(fatal);
