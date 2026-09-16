import {t as tr,languages,language,preference,setLanguage,translateStatic} from './i18n.mjs';
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
import {fillIcons, icon, sessionIcon} from './icons.mjs';
import {$, el, button, toast, reportError, clearError, clearFeedback, modal, closeModal, field, confirmAction, copyText, size} from './ui.mjs';
import {scan} from './qr.mjs';
import * as push from './push.mjs';

const {Terminal, FitAddon} = terminalBundle;
const vault = new Vault(), machines = new Map(), transfers = [];
let desktopHostAvailable=false;
let androidAPK = "", desktopRelease = "", desktopUpdateState=null, desktopUpdateOperation=null;
let settingsMachine, settingsRequest = 0;
let selected = null, view = 'terminal', pairedFromURL = '', ctrl = false, alt = false;
let activeAt = Date.now(), hiddenAt = 0, installedPrompt, applicationStarted = false;
const isMobile = () => matchMedia('(max-width: 760px)').matches;
const current = () => machines.get(selected);
const activeTerm = a => a?.terms.get(a.active);
const prefs = () => vault.data?.preferences || {};
const checked = p => { if (!p) throw new Error('Choose a connected machine first.'); return p; };
const online = () => { const a = checked(current()); if (a.link.state !== 'online') throw new Error('Wait for the encrypted connection.'); return a; };
const persist = async () => { await vault.save(); for (const a of machines.values()) pushWorkspace(a).catch(() => {}); };
// ---- shared workspace (open sessions and layouts follow the host) ----------
function wsConfig(a) { return a.info?.workspace || {}; }
function workspaceSignature(a) { return JSON.stringify({o: a.machine.openSessions || [], l: a.machine.layouts || [], t: a.machine.tabOrder || [], a: a.active || ''}); }
function workspacePayload(a) { return {openSessions: a.machine.openSessions || [], layouts: a.machine.layouts || [], tabOrder: a.machine.tabOrder || [], active: a.active || ''}; }
async function pushWorkspace(a) {
  if (!wsConfig(a).sync || a.link.state !== 'online') return;
  const signature = workspaceSignature(a);
  if (signature === a.wsSent) return;
  a.wsSent = signature;
  try {
    const result = await a.link.request('workspace.update', {...workspacePayload(a), revision: a.info.workspace.revision});
    if (result.stale) { await applyHostWorkspace(a, result); render(); if (a === current() && a.active && view === 'terminal') selectSession(a, a.active).catch(() => {}); }
    a.info.workspace = result;
  }
  catch (error) { a.wsSent = ''; if (!/synchronization is off/.test(error.message)) throw error; }
}
async function applyHostWorkspace(a, w) {
  a.machine.openSessions = [...w.openSessions];
  a.machine.layouts = JSON.parse(JSON.stringify(w.layouts || []));
  a.machine.tabOrder = [...(w.tabOrder || [])];
  if (w.active && a.sessions.some(s => s.id === w.active)) a.active = w.active;
  if (!a.machine.openSessions.includes(a.active)) a.active = a.machine.openSessions[0] || '';
  a.machine.layout = a.machine.layouts.find(tree => leaves(tree).includes(a.active)) || (a.active ? {id: a.active} : null);
  for (const [id, t] of a.terms) if (!a.machine.openSessions.includes(id)) { if (t.attached && a.link.state === 'online') await a.link.request('session.detach', {id}).catch(() => {}); t.term.dispose(); t.node.remove(); a.terms.delete(id); }
  a.machine.lastSession = a.active; a.wsSent = workspaceSignature(a);
  await vault.save();
}
function displayedOnly(a) { return !!(wsConfig(a).sync && wsConfig(a).displayedOnly); }
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
translateStatic();fillIcons();
const installedWeb=!desktop&&!isAndroid&&(matchMedia('(display-mode: standalone)').matches||navigator.standalone===true);
if(installedWeb)document.title='jaunt (PWA)';
if(!desktop&&!isAndroid&&!installedWeb&&!pairedFromURL&&!new URLSearchParams(location.search).has('app')&&!deepLink.has('host')){
  document.body.classList.add('site-mode');$('site-home').hidden=false;
}
function enterWorkspace(){document.body.classList.remove('site-mode');$('site-home').hidden=true;const url=new URL(location.href);url.searchParams.set('app','1');url.hash='';history.replaceState(null,'',url);render();}
$('open-workspace').onclick=enterWorkspace;$('site-get-started').onclick=enterWorkspace;
$('site-language').replaceWith(languagePicker('site-language'));
$('site-copy-install').onclick=()=>copyText($('site-install-command').textContent);
$('site-client-install').onclick=()=>showInstallation(true);
const previews={
 shell:'~/work/project $ git status --short\n M src/app.ts\n A tests/app.test.ts\n\n~/work/project $ pwd\n/home/me/work/project\n\n~/work/project $ ▌',
 codex:'~/work/project $ codex\n\n> Explain how this project works\n\n• Reading README.md\n• Exploring src/\n\n  src/\n  ├── app.ts\n  └── terminal.ts',
 claude:'~/work/project $ claude\n\n> Explain how this project works\n\n• Reading README.md\n• Exploring src/\n\n  src/\n  ├── app.ts\n  └── terminal.ts'
};
for(const button of document.querySelectorAll('[data-preview]'))button.onclick=()=>{
 const key=button.dataset.preview;
 for(const tab of document.querySelectorAll('[data-preview]'))tab.setAttribute('aria-selected',String(tab===button));
 $('preview-desktop-output').textContent=previews[key];$('preview-phone-output').textContent=previews[key];$('preview-phone-tab').textContent=key;
 $('preview-phone-icon').replaceChildren(icon(key==='codex'?'openai':key==='claude'?'claude':'terminal',12));
};
document.querySelector('[data-preview=shell]').click();



function installationCommand(clientOnly=false){return "bash -o pipefail -c 'curl -qfL --connect-timeout 10 --max-time 120 https://moukrea.github.io/jaunt/install.sh | bash"+(clientOnly?' -s -- --client-only':'')+"'";}
function installationChoices(){return el('div',{class:'install-choices'},button(tr('Install host and desktop app'),()=>showInstallation(false),'button primary','copy'),button(tr('Install desktop client only'),()=>showInstallation(true),'button','copy'));}
function showInstallation(clientOnly){
 const code=el('code',{text:installationCommand(clientOnly),translate:'no'});
 modal(clientOnly?tr('Install desktop client only'):tr('Install host and desktop app'),el('div',{},el('p',{class:'modal-copy',text:clientOnly?tr('Connect to other hosts from this computer. Installs the desktop app without adding a CLI, daemon or local host.'):tr('Install the host service and desktop app together on this computer.')}),el('div',{class:'command'},code),el('div',{class:'modal-actions'},button(tr('Copy installation command'),()=>copyText(code.textContent),'button primary','copy'))));
}
function drawer(open = false) { $('sidebar').classList.toggle('open', open); $('drawer-backdrop').hidden = !open; }
function setView(value) {
  document.querySelectorAll('.terminal-selection-overlay').forEach(n=>n.remove());
  view = value; drawer(); if (view === 'settings') refreshSettings(); render();
  if(view==='transfers')renderTransfers();
  if (view === 'files' && current()?.link.state === 'online') listFiles(current()).catch(report);
}

function refreshSettings() {
  const a = current(), request = ++settingsRequest;
  renderSettings();
  if (a?.link.state === 'online' && a.info?.updates?.supported) {
    a.link.request('updates.status').then(value => {
      if (request !== settingsRequest || a !== current() || view !== 'settings') return;
      a.info.updates = value; renderSettings();
    }).catch(error => {
      if (request === settingsRequest && a === current() && view === 'settings') reportHost(a, error);
    });
  }
  // Runtime detection is refreshed each time Settings opens, so a runtime installed or
  // removed since the host started shows up without restarting jaunt.
  if (a?.link.state === 'online' && a.info?.bridge) {
    a.link.request('bridge.status', {refresh: true}).then(value => {
      if (request !== settingsRequest || a !== current() || view !== 'settings') return;
      a.info.bridge = value; renderSettings();
    }).catch(() => {});
  }
}
function showPair() {
  const input = el('textarea', {class: 'pair-code', rows: 4, placeholder: tr('jaunt1.… or the complete pairing link'), spellcheck: false, autocapitalize: 'off', 'aria-label': tr('Pairing code')});
  const body = el('div', {}, el('p', {class: 'modal-copy', text: tr('Run jaunt pair on the host. The QR and pairing string expire after ten minutes and can be used once.')}),
    button(tr('Scan QR code'), () => scan(pairMachine), 'button wide', 'qr'), el('div', {class: 'divider'}, el('span', {text: tr('or paste the complete string')})), input,
    el('div', {class: 'modal-actions'}, button(tr('Pair machine'), async () => { await pairMachine(input.value); closeModal(); }, 'button primary')));
  modal(tr('Pair a machine'), body); drawer();
}
async function pairMachine(value) {
  if (!vault.data) throw new Error('Unlock this device first.');
  const machine = parsePairing(value);
  if (vault.data.machines.some(m => m.room === machine.room)) throw new Error('This machine is already remembered. Reconnect from Settings, or forget it before pairing again.');
  if (vault.data.machines.length >= 12) throw new Error('Twelve machines are already remembered. Forget an old machine first.');
  // Persist BEFORE consuming the QR: a lost welcome must not strand the pairing.
  vault.data.machines.push(machine); await persist();
  const app = makeMachine(machine); selected = machine.room;
  app.link.start(); view = 'terminal'; $('pair-code').value = ''; enterWorkspace();
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
  a.link.addEventListener('revoked', () => {a.connectionError=tr('Access was revoked on the host. Pair this device again only if you want to authorize it again.');if(a===current())renderConnection();});
  a.link.addEventListener('latency', () => { if (selected === machine.room) renderConnection(); });
  a.link.addEventListener('welcome', e => {
    a.peer = e.detail.peer; a.info = e.detail.machine; a.sessions = e.detail.sessions; syncSessions(a);
    a.restartExpected = 0; if (a.link.expectRestart !== undefined) a.link.expectRestart = false;
    if (a.info?.updates) hostUpdateJobs.get(a.machine.room)?.observe(a.info.updates);
    // Only attach terminal views this browser actually opened; sessions need no viewer to run.
    for (const t of a.terms.values()) attachTerm(a, t).catch(error=>reportHost(a,error));
    if (!a.machine.openSessions) a.machine.openSessions = a.sessions.map(s=>s.id);
    if (!a.active || !a.sessions.some(s => s.id === a.active)) a.active = a.machine.openSessions[0] || '';
    if (a.info?.workspace?.sync) applyHostWorkspace(a, a.info.workspace).then(() => { if (selected === machine.room) { render(); if (a.active) selectSession(a, a.active).catch(error=>reportHost(a,error)); } }).catch(error=>reportHost(a,error));
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
    t.scrollAnchor?.marker?.dispose();t.scrollAnchor=null;
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
      message.session ? {label: tr('Open'), run: () => { selected = a.machine.room; setView('terminal'); selectSession(a, message.session).catch(error=>reportHost(a,error)); }} : null);
  } else if (message.type === 'clipboard.available') {
    toast(`${a.machine.name} shared clipboard text.`, false, {label: tr('Open'), run: () => showClipboard(a)});
  } else if (message.type === 'workspace.changed') {
    const w = message.workspace; if (a.info) a.info.workspace = w;
    if (message.from === a.peer) { a.wsSent = workspaceSignature(a); if (view === 'settings' && a === current()) renderSettings(); return; }
    if (w.sync) {
      applyHostWorkspace(a, w).then(() => { render(); if (a === current() && a.active && view === 'terminal') selectSession(a, a.active).catch(error=>reportHost(a,error)); }).catch(error=>reportHost(a,error));
    }
    if (view === 'settings' && a === current()) renderSettings();
  } else if (message.type === 'bridge.changed') {
    const {type, ...status} = message; if (a.info) a.info.bridge = status;
    if (view === 'settings' && a === current()) renderSettings();
  } else if (message.type === 'bridge.message') {
    bridgeMessageActivity(a, message);
  } else if (message.type === 'update.progress') {
    const {type, ...status} = message; hostUpdateProgress(a, status);
  } else if (message.type === 'host.restarting') {
    // The daemon replaces its runtime in place: the coming disconnection is
    // expected and shells survive it. Never show it as an outage.
    a.restartExpected = Date.now(); if (a.link.expectRestart !== undefined) a.link.expectRestart = true;
    hostUpdateJobs.get(a.machine.room)?.job.update({status: tr('Restarting the host runtime · shells are kept…')});
    if (a === current()) renderConnection();
  }
}

function renderConnection() {
  const a = current(), state = a?.link.state || 'offline';
  const labels = {online: a?.machine.local ? tr('Local connection') : tr('Encrypted'), offline: tr('Not connected'), connecting: tr('Connecting'), authenticating: tr('Verifying host'), waiting: tr('Host offline'), reconnecting: tr('Reconnecting')};
  const restarting = a && state !== 'online' && a.link.enabled && a.restartExpected && Date.now() - a.restartExpected < 180000;
  $('connection').className = 'connection ' + (restarting ? 'reconnecting' : state);
  $('connection').lastElementChild.textContent = restarting ? tr('Updating host') : labels[state] || state;
  $('latency').hidden = !(state === 'online' && a.link.latency != null);
  $('latency').textContent = a?.link.latency != null ? `${a.link.latency} ms` : '';
  $('connection-banner').hidden = !a || state === 'online';
  if(!a || state==='online')return;
  const messages={connecting:tr('Connecting with the saved device key…'),authenticating:a.machine.pending?tr('Pairing this device and verifying the host…'):tr('Verifying the saved encrypted connection…'),waiting:tr('The host is offline. jaunt will reconnect automatically when it returns.'),reconnecting:tr('Network interrupted. Reconnecting automatically with the same pairing.')};
  const text=restarting ? tr('The host is restarting to finish its update. Shells are kept; reconnecting automatically.') : a.connectionError || messages[state] || a.link.message || tr('Connection is paused. Reconnect using the saved device key.');
  const actions=a.link.enabled?[]:[button(tr('Reconnect'),()=>{a.connectionError='';a.link.start();},'text-button')];
  $('connection-banner').setAttribute('aria-busy',String(a.link.enabled));
  $('connection-banner').replaceChildren(el('span',{text:text+' '+tr('Shells remain on the host while its daemon runs. Unsent terminal input is not replayed.')}),...actions);
  if(a.connectionError || /revoked|expired|unknown device/i.test(a.link.message||''))$('connection-banner').append(button(tr('Connection settings'),()=>setView('settings'),'text-button'));

}
function renderMachines() {
  $('machine-count').textContent = machines.size;
  const nodes = [...machines.values()].sort((a,b) => vault.data.machines.indexOf(a.machine) - vault.data.machines.indexOf(b.machine)).map(a => {
    const b = button('', () => { selected = a.machine.room; drawer(); render(); if (a.active) selectSession(a, a.active); if (view === 'files') return listFiles(a); }, 'machine-item' + (selected === a.machine.room ? ' selected' : ''));
    b.title=a.machine.friendlyName||a.machine.name;b.setAttribute('aria-label',b.title);
    b.append(el('span', {class: 'machine-symbol'}, icon('monitor')), el('span', {class: 'machine-text'}, el('strong', {text: a.machine.friendlyName || a.machine.name}), el('small', {text: a.info ? `${a.info.user} · ${a.info.platform}` : a.link.state})),
      el('span', {class: `status-dot ${a.link.state === 'online' ? 'online' : a.link.enabled ? 'working' : ''}`}));
    return b;
  });
  $('machine-list').replaceChildren(...(nodes.length ? nodes : [el('p', {class: 'machine-placeholder', text: tr('Your paired machines will appear here.')})]));
}
function render() {
  if (!vault.data) return;
  const a = current(); renderMachines(); renderConnection();
  if (view === 'settings' && settingsMachine !== a) refreshSettings();
  $('machine-title').textContent = a?.machine.friendlyName || a?.machine.name || tr('Overview');
  $('breadcrumb-prefix').textContent = tr('Workspace');
  $('welcome').hidden = !!a || view === 'settings'; $('workspace').hidden = !a && view !== 'settings';
  $('new-session-top').hidden = !a; $('new-session-top').disabled = !!a?.creating || a?.link.state !== 'online';
  $('lock-button').hidden = !vault.protected;
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('selected', b.dataset.view === view);
  $('terminal-view').hidden = !a || (view !== 'terminal' && !(view === 'files' && !isMobile()));
  for (const v of ['files', 'transfers', 'settings']) $(v + '-view').hidden = (v !== 'settings' && !a) || view !== v;
  for (const b of document.querySelectorAll('#new-session-tab, #new-session-empty')) b.disabled = !!a?.creating || a?.link.state !== 'online';
  $('session-count').textContent = a?.sessions.length || '';
  for(const id of ['arrange-panes','split-below']) $(id).disabled = !a?.active || a?.link.state !== 'online';
  $('list-sessions').hidden = !!a && displayedOnly(a);
  $('terminal-empty').hidden = !!a?.active;
  for (const host of machines.values()) for (const [id, t] of host.terms) t.node.hidden = host !== a || !visibleSessions(a).includes(id);
  if (a) layoutPanes(a);
  if (a) {
    renderTabs(a);
    const s = a.sessions.find(s => s.id === a.active), t = activeTerm(a);
    $('rename-session').hidden = !s;
    $('terminal-meta').textContent = a.creating ? tr('Creating shell…') : s ? `${s.cwd}  ·  ${s.alive ? `${t?.term.cols || s.cols} × ${t?.term.rows || s.rows}` : tr("Exited ({0})",s.exitCode ?? '—')}${t?.trimmed ? '  ·  older output trimmed' : ''}` : tr('No active shell');
    if (s && !t && a.link.state === 'online') selectSession(a, s.id).catch(report);
  }
  requestAnimationFrame(fitActive);
}
function rememberLayout(a, tree) {
  if(!tree)return;
  const ids=new Set(leaves(tree)),old=a.machine.layouts||[],keep=new Set((a.machine.openSessions||a.sessions.map(s=>s.id)).filter(id=>!ids.has(id)));
  const position=old.findIndex(t=>leaves(t).some(id=>ids.has(id)));
  const next=old.map(t=>prune(t,keep)).filter(Boolean);
  next.splice(position<0?next.length:Math.min(position,next.length),0,tree);
  for(const id of keep)if(!next.some(t=>leaves(t).includes(id)))next.push({id});
  a.machine.layouts=next;a.machine.layout=tree;
}
function renameGesture(node,run) {
  node.addEventListener('dblclick',e=>{e.preventDefault();run();});
}
async function reorderTab(a,from,to) {
  if(from===to)return;
  if(isMobile()) {
    const order=a.machine.tabOrder||a.sessions.map(s=>s.id),id=order.splice(from,1)[0];order.splice(to,0,id);a.machine.tabOrder=order;
  } else {const tree=a.machine.layouts.splice(from,1)[0];a.machine.layouts.splice(to,0,tree);}
  await persist();renderTabs(a);
}
function tabDrag(node,a,index) {
  let drag;
  const scrollable=()=>$('tabs').scrollWidth>$('tabs').clientWidth+2;
  node.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    drag={x:e.clientX,y:e.clientY,id:e.pointerId,index,moving:false,armed:true};
    // On a touch screen whose tab strip scrolls, a horizontal swipe must scroll: the
    // drag is only armed after a still press, so the swipe keeps its natural meaning.
    if(e.pointerType==='touch'&&scrollable()){drag.armed=false;drag.timer=setTimeout(()=>{if(drag&&!drag.moving){drag.armed=true;node.addEventListener('touchmove',block,{passive:false});node.closest('.session-tab').classList.add('tab-armed');if(navigator.vibrate)navigator.vibrate(10);}},350);}
  });
  // A non-passive touchmove listener that is always attached stops the strip from
  // panning in Chromium even when it never prevents anything; attach it only while
  // an armed drag is in progress.
  const block=e=>{if(drag?.armed&&drag.moving)e.preventDefault();};
  node.addEventListener('pointermove',e=>{
    if(!drag)return;
    const distance=Math.hypot(e.clientX-drag.x,e.clientY-drag.y);
    if(!drag.armed){if(distance>=10){clearTimeout(drag.timer);drag=null;}return;}
    if(!drag.moving&&distance<10)return;
    drag.moving=true;node.setPointerCapture(e.pointerId);node.closest('.session-tab').classList.add('tab-dragging');
    const rows=[...$('tabs').querySelectorAll('.session-tab')];
    drag.to=rows.findIndex(row=>{const r=row.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right;});
    rows.forEach((row,i)=>row.classList.toggle('tab-drop-target',i===drag.to));
    const r=$('tabs').getBoundingClientRect();if(e.clientX>r.right-30)$('tabs').scrollLeft+=15;if(e.clientX<r.left+30)$('tabs').scrollLeft-=15;
  });
  node.addEventListener('pointerup',e=>{const d=drag;drag=null;clearTimeout(d?.timer);node.removeEventListener('touchmove',block);document.querySelectorAll('.tab-armed').forEach(n=>n.classList.remove('tab-armed'));if(!d?.moving)return;e.preventDefault();node.dataset.dragged='1';setTimeout(()=>delete node.dataset.dragged,0);document.querySelectorAll('.tab-drop-target,.tab-dragging').forEach(n=>n.classList.remove('tab-drop-target','tab-dragging'));if(d.to>=0)reorderTab(a,d.index,d.to).catch(report);});
  node.addEventListener('pointercancel',()=>{clearTimeout(drag?.timer);drag=null;node.removeEventListener('touchmove',block);document.querySelectorAll('.tab-drop-target,.tab-dragging,.tab-armed').forEach(n=>n.classList.remove('tab-drop-target','tab-dragging','tab-armed'));});
  node.addEventListener('keydown',e=>{if(e.altKey&&e.shiftKey&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const to=index+(e.key==='ArrowLeft'?-1:1);if(to>=0&&to<$('tabs').children.length)reorderTab(a,index,to).catch(report);}});
}
function renderTabs(a) {
  const sessions=a.sessions.filter(s=>!a.machine.openSessions||a.machine.openSessions.includes(s.id));
  const order=a.machine.tabOrder||[];
  const ordered=[...sessions].sort((x,y)=>(order.includes(x.id)?order.indexOf(x.id):1e6+sessions.indexOf(x))-(order.includes(y.id)?order.indexOf(y.id):1e6+sessions.indexOf(y)));
  const groups=isMobile()?ordered.map(s=>({id:s.id})):(a.machine.layouts||sessions.map(s=>({id:s.id})));
  if(isMobile())a.machine.tabOrder=ordered.map(s=>s.id);
  const signature=JSON.stringify(groups.map(tree=>leaves(tree).map(id=>{const s=sessions.find(s=>s.id===id);return [id,s?.name,s?.alive,s?.program];})));
  const update=()=>{for(const row of $('tabs').children){const active=JSON.parse(row.dataset.ids||'[]').includes(a.active);row.classList.toggle('active',active);const ids=JSON.parse(row.dataset.ids||'[]');const selected=a.sessions.find(s=>s.id===(ids.includes(a.active)?a.active:ids[0]));row.querySelector('.tab-symbol')?.replaceChildren(icon(sessionIcon(selected),15));row.querySelector('[role=tab]')?.setAttribute('aria-selected',String(active));}};
  if($('tabs').dataset.host===a.machine.room&&a.tabSignature===signature){update();return;}
  a.tabSignature=signature;$('tabs').dataset.host=a.machine.room;
  $('tabs').replaceChildren(...groups.map((tree,index) => {
    const ids=leaves(tree), group=sessions.filter(s=>ids.includes(s.id));if(!group.length)return el('span');
    const target=()=>ids.includes(a.active)?a.active:group[0].id,name=group.map(s=>s.name).join(' + ');
    const label=el('button',{type:'button',class:'tab-label',text:name,onclick:()=>{if(label.dataset.dragged)return;selectSession(a,target()).catch(report);}});
    renameGesture(label,()=>renameSession(a,a.sessions.find(s=>s.id===target())));tabDrag(label,a,index);
    label.setAttribute('role','tab');label.setAttribute('aria-selected',String(ids.includes(a.active)));
    const close=button('',()=>closeChoice(close,a,group.map(s=>s.id)),'icon-button tab-close','close');close.setAttribute('aria-label',displayedOnly(a)?tr("Terminate {0}",name):tr("Close {0}",name));
    return el('div',{class:'session-tab'+(ids.includes(a.active)?' active':''),'data-ids':JSON.stringify(ids)},el('span',{class:'tab-symbol'},icon(sessionIcon(group.find(s=>s.id===target())),15)),label,el('span',{class:`status-dot${group.some(s=>s.alive)?' online':''}`}),close);
  }));
}
function createTerm(a, session) {
  const node = el('div', {class: 'terminal-container', hidden: a !== current() || session.id !== a.active, 'data-session': session.id});
  $('terminal-containers').append(node);
  const title=button(session.name,()=>{a.active=session.id;claimSize(a,t);renderTabs(a);},'pane-name');
  renameGesture(title,()=>renameSession(a,session));
  const undock=button('',()=>undockPane(a,session.id),'icon-button','external');
  undock.setAttribute('aria-label',tr('Move pane to its own tab'));
  const closePane=button('',()=>closeChoice(closePane,a,[session.id]),'icon-button','close');
  closePane.setAttribute('aria-label',tr('Close {0}',session.name));
  node.append(el('div',{class:'pane-caption'},el('span',{class:'pane-symbol'},icon(sessionIcon(session),15)),title,undock,closePane));
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
    if(t.attached && !t.replaying && !t.resizing && d?.cols===term.cols && d?.rows===term.rows) rememberScroll(t);
  });

  const area = node.querySelector('textarea');
  if (area) { area.setAttribute('autocorrect', 'off'); area.setAttribute('autocapitalize', 'off'); area.spellcheck = false; area.setAttribute('aria-label', tr("Terminal {0}",session.name)); }
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
        if (t.attached) toast(tr('The terminal has text ready to copy.'), false, {label: tr('Copy'), run: () => copyText(a.remoteClipboard)});
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
  t.attached = false; t.replaying=true; t.node.classList.add('terminal-restoring');t.node.dataset.loadingLabel=tr('Restoring shell…');updateTermInput(a, t);
  const promise = (async () => {
    await a.link.request('session.attach', {id: t.session.id, after: t.offset});
    // xterm writes are asynchronous: drain replay before allowing parser responses/input.
    if(generation!==a.link.generation || !a.terms.has(t.session.id))return;
    await new Promise(resolve => t.term.write('', resolve));
    if (generation !== a.link.generation || a.link.state !== 'online') return;
    t.generation = generation; t.attached = true; t.replaying=false;updateTermInput(a, t);
    t.ownsSize = !a.info?.sharedViews || t.session.activeView === a.peer;
    if (a === current() && visibleSessions(a).includes(t.session.id) && !document.hidden) claimSize(a, t);
    if(!t.scrollAnchor || t.scrollAnchor.bottom)t.term.scrollToBottom();
    rememberScroll(t);
    requestAnimationFrame(()=>t.node.classList.remove('terminal-restoring'));

  })();
  t.attaching = {generation, promise};
  try { await promise; } finally { if (t.attaching?.promise === promise){t.attaching = null;t.replaying=false;t.node.classList.remove('terminal-restoring');} }
}
async function selectSession(a, id) {
  document.querySelectorAll('.split-picker').forEach(n=>n.remove());
  document.querySelectorAll('.terminal-selection-overlay').forEach(n=>n.remove());
  const session = a.sessions.find(s => s.id === id);
  if (!session) throw new Error('This terminal no longer exists.');
  selected = a.machine.room; a.active = id; a.machine.lastSession = id;
  a.machine.openSessions ||= []; if(!a.machine.openSessions.includes(id))a.machine.openSessions.push(id);
  if (!leaves(a.machine.layout).includes(id)) a.machine.layout = a.machine.layouts?.find(tree=>leaves(tree).includes(id)) || {id};
  if(!a.machine.layouts?.some(tree=>leaves(tree).includes(id)))rememberLayout(a, a.machine.layout);
  // Activate synchronously so a following keystroke cannot target the old tab.
  const t = a.terms.get(id) || createTerm(a, session);
  render();
  await persist();
  pushWorkspace(a).catch(() => {});
  if ((!t.attached || t.generation !== a.link.generation) && a.link.state === 'online') await attachTerm(a, t);
  if(!document.hidden && view==='terminal')claimSize(a,t);
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
  if(t.replaying){t.term.resize(cols,rows);return;}
  if(!t.scrollAnchor)rememberScroll(t);
  const anchor=t.scrollAnchor, generation=(t.resizeGeneration||0)+1;t.resizeGeneration=generation;t.resizing=true;
  const smooth=t.term.options.smoothScrollDuration;t.term.options.smoothScrollDuration=0;
  t.term.resize(cols, rows);
  const restore=()=>{
    t.term.scrollToLine(anchor.bottom ? t.term.buffer.active.baseY : anchor.marker && !anchor.marker.isDisposed ? anchor.marker.line : anchor.line);
    t.term.refresh(0,t.term.rows-1);
  };
  restore();requestAnimationFrame(()=>{if(t.resizeGeneration!==generation)return;restore();t.resizing=false;t.term.options.smoothScrollDuration=smooth;rememberScroll(t);});
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
      t.node.querySelector('.pane-symbol')?.replaceChildren(icon(sessionIcon(session),15));
      if (!t.attached && !t.attaching && a.link.state === 'online') attachTerm(a, t).catch(report);
      return;
    }
    const horizontal = tree.axis === 'x', r = tree.ratio;
    place(tree.first,x,y,horizontal?w*r:w,horizontal?h:h*r);
    place(tree.second,horizontal?x+w*r:x,horizontal?y:y+h*r,horizontal?w*(1-r):w,horizontal?h:h*(1-r));
    const gutter = el('div', {class: 'pane-divider '+tree.axis, role: 'separator', tabindex: 0, 'aria-label': tr('Resize terminal panes'), 'aria-orientation': horizontal?'vertical':'horizontal', 'aria-valuenow': Math.round(r*100)});
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
  const text=el('textarea',{class:'terminal-selection',readOnly:true,value:terminalText(t),'aria-label':tr('Select terminal text'),spellcheck:false});
  const overlay=el('div',{class:'terminal-selection-overlay'},button(tr('Back to terminal'),()=>overlay.remove(),'button'),text);
  $('terminal-stage').append(overlay);text.scrollTop=text.scrollHeight;
  // A native text control gives Android/iOS their own selection handles and copy menu.
}
function arrangePanes(axis) {
  const a = online(), target = a.active;
  const old = document.querySelector('.split-picker');
  if (old) old.remove();
  const picker = el('div', {class:'split-picker', role:'region', 'aria-label':tr('Choose pane session')});
  const add = async id => {
    picker.remove();
    a.machine.openSessions ||= [];
    if (!a.machine.openSessions.includes(id)) a.machine.openSessions.push(id);
    rememberLayout(a, split(a.machine.layout || {id:target}, target, id, axis));
    await persist();
    await selectSession(a,id);
  };
  picker.append(button(tr('New shell'),async()=>{picker.remove();await newSession(axis);},'button','plus'));
  for (const session of a.sessions.filter(s=>!leaves(a.machine.layout || {id:target}).includes(s.id)))
    picker.append(button(session.name,()=>add(session.id),'button','terminal'));
  picker.append(button(tr('Cancel'),()=>picker.remove(),'button','close'));
  $('terminal-stage').append(picker);
  picker.querySelector('button').focus();
  picker.onkeydown=e=>{if(e.key==='Escape')picker.remove();};
}
async function undockPane(a,id) {
  rememberLayout(a,{id});
  await persist();
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
      modal(tr('Paste multiple lines?'),el('div',{},el('p',{class:'modal-copy',text:tr('This shell does not enable bracketed paste. Newlines may execute commands immediately. Review the text with Compose instead when in doubt.')}),
        el('div',{class:'modal-actions'},button(tr('Cancel'),closeModal),button(tr('Paste anyway'),async()=>{await perform();accepted=true;closeModal();resolve();},'button danger'))),()=>{if(!accepted)reject(new Error('Paste cancelled'));});
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
    await persist();
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
  const name=el('input',{maxLength:80,placeholder:tr('Automatic')});
  const cwd=el('input',{value:directory || a.info?.home || '~',spellcheck:false,autocapitalize:'off'});
  const folders=el('div',{class:'folder-picker'});
  let listing, request=0;
  const navigate=async(path,append=false)=>{
    const version=++request;
    const result=await a.link.request('files.list',{path,offset:append?listing.next:0,limit:100,hidden:false});
    if(version!==request)return;
    if(append)result.entries=[...listing.entries,...result.entries];
    listing=result;cwd.value=result.path;
    folders.replaceChildren(button(tr('Parent folder'),()=>navigate(result.parent),'button','arrowUp'),
      ...result.entries.filter(e=>e.directory).map(e=>button(e.name,()=>navigate(result.path.replace(/\/$/,'')+'/'+e.name),'button','folder')),
      ...(result.next!==null?[button(tr('Load more'),()=>navigate(result.path,true))]:[]));
  };
  cwd.oninput=()=>{request++;};
  cwd.onchange=()=>navigate(cwd.value).catch(error=>reportError(error,cwd.isConnected?'modal':'action'));
  await navigate(cwd.value);
  modal(tr('New terminal'),el('div',{},field(tr('Session name'),name,tr('Optional — leave blank for an automatic name.')),
    field(tr('Working directory'),cwd),folders,
    el('div',{class:'modal-actions'},button(tr('Cancel'),closeModal),button(tr('Create shell'),()=>newSession(null,{name:name.value,cwd:cwd.value}),'button primary'))));
}
async function killSessions(a, ids) {
  for (const id of ids) {
    await a.link.request('session.terminate', {id});
    a.sessions = a.sessions.filter(s => s.id !== id);
  }
  syncSessions(a); await persist(); render();
}
// The × on a tab or pane: closing a view and terminating the shell are different
// actions, so the choice is made explicit right there. When the host only keeps the
// sessions that are displayed, closing is terminating and no menu is shown.
function closeChoice(anchor, a, ids) {
  document.querySelectorAll('.close-menu').forEach(n => n.remove());
  if (displayedOnly(a)) { killSessions(a, ids).catch(report); return; }
  const names = ids.map(id => a.sessions.find(s => s.id === id)?.name || id).join(' + ');
  const menu = el('div', {class: 'close-menu', role: 'menu', 'aria-label': tr('Close {0}', names)});
  const closeAll = async () => { menu.remove(); for (const id of ids) await closeView(a, id); };
  menu.append(button(tr('Close view'), closeAll, 'button', 'close'),
    el('small', {class: 'close-menu-hint', text: tr('Keeps the shell running on the host.')}),
    button(tr('Terminate session'), () => { menu.remove(); killSessions(a, ids).catch(report); }, 'button danger', 'trash'),
    el('small', {class: 'close-menu-hint', text: tr('Ends the shell and its jobs for everyone.')}));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect(), width = menu.offsetWidth, height = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8)) + 'px';
  menu.style.top = (r.bottom + height + 8 < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - height - 6)) + 'px';
  const dismiss = e => { if (e.type === 'keydown' && e.key !== 'Escape') return; if (e.type === 'pointerdown' && menu.contains(e.target)) return; menu.remove(); document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', dismiss, true); };
  setTimeout(() => { document.addEventListener('pointerdown', dismiss, true); document.addEventListener('keydown', dismiss, true); }, 0);
  menu.querySelector('button').focus();
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
    el('div',{class:'settings-label'},el('strong',{text:s.name}),el('p',{text:`${s.alive?'Running':'Exited'} · ${s.cwd}`}),el('p',{text:(s.viewers||[]).map(v=>v.name).join(', ')||tr('No open views')})),
    el('div',{class:'session-actions'},button(tr('Open'),async()=>{closeModal();view='terminal';await selectSession(a,s.id);}),
    button(tr('Rename'),()=>renameSession(a,s)),
    ...(a.machine.openSessions?.includes(s.id)?[button(tr('Close view'),async()=>{await closeView(a,s.id);sessionList();})]:[]),
    button(tr('Terminate'),()=>terminateSession(a,s),'button danger'))));
  if(!a.sessions.length)body.append(el('p',{text:tr('No sessions are running on this host.')}));
  body.append(button(tr('New shell'),newSession,'button primary'));
  modal(tr('Sessions on this host'),body);
}
function terminateSession(a, session) {
  confirmAction(tr("Terminate {0}?",session.name), session.tmux
    ? tr("This kills the underlying tmux session “{0}” and its shells, including views outside jaunt.",session.tmux)
    : tr('This ends the shell and its jobs for everyone. All connected views will close. This cannot be undone.'),
    tr('Terminate session'), async () => {
      await a.link.request('session.terminate', {id: session.id});
      a.sessions = a.sessions.filter(s => s.id !== session.id); syncSessions(a); await persist(); render();
    }, true);
}
function renameSession(a = online(), s = a.sessions.find(s => s.id === a.active)) {
  if (!s) return;
  const input = el('input', {value: s.name, maxLength: 80});
  modal(tr('Rename terminal'), el('div', {}, field(tr('Name'), input), el('div', {class: 'modal-actions'}, button(tr('Save'), async () => {
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
  if (!a.listing) { $('file-list').replaceChildren(el('p', {class: 'modal-copy', text: tr('Loading files…')})); return; }
  const result = a.listing;
  $('file-path').value = a.pathDraft ?? result.path;
  $('file-status').textContent = `${result.entries.length} / ${result.total} items · ${size(result.free)} free${result.truncated ? ' · first 5,000 entries only' : ''}`;
  const rows = result.entries.map(entry => {
    const path = result.path.replace(/\/$/, '') + '/' + entry.name;
    const main = button('', () => entry.directory ? listFiles(a, path) : fileMenu(a, entry, path), 'file-entry');
    main.append(el('span', {class: 'file-icon'}, icon(entry.directory ? 'folder' : /\.(png|jpe?g|webp|gif|avif)$/i.test(entry.name) ? 'image' : 'file', 21)),
      el('span', {class: 'file-text'}, el('span', {class: 'file-name', text: entry.name}),
        el('span', {class: 'file-details', text: `${entry.directory ? tr('Folder') : size(entry.size)}${entry.link ? ' · '+tr('symlink') : ''}${entry.unreadable ? ' · '+tr('not readable') : ''}`})));
    const more = button('', () => fileMenu(a, entry, path), 'icon-button', 'more'); more.setAttribute('aria-label', tr("Actions for {0}",entry.name));
    return el('div', {class: 'file-row'}, main, more);
  });
  if (!rows.length) rows.push(el('p', {class: 'modal-copy', text: tr('This directory is empty.')}));
  if (result.next != null) rows.push(button(tr('Load more'), () => listFiles(a, a.path, true), 'button wide'));
  $('file-list').replaceChildren(...rows);
}
function fileMenu(a, entry, path) {
  const body = el('div', {class: 'file-menu'}, el('p', {class: 'modal-copy', text: path}));
  if (entry.directory) body.append(button(tr('Open folder'), async () => { closeModal(); await listFiles(a, path); }, 'button', 'folder'));
  else {
    body.append(button(tr('Preview'), () => previewFile(a, path, entry), 'button', 'eye'));
    body.append(button(tr('Download'), async () => { closeModal(); await getFile(a, path, entry.name); }, 'button', 'download'));
    if ('showSaveFilePicker' in window) body.append(button(tr('Save directly to disk…'), async () => {
      const handle = await showSaveFilePicker({suggestedName: entry.name});
      const writer = await handle.createWritable(); closeModal(); await getFile(a, path, entry.name, writer);
    }, 'button', 'download'));
  }
  body.append(button(tr('Copy full path'), () => copyText(path), 'button', 'copy'));
  if (activeTerm(a)) body.append(button(tr('Insert path in terminal'), async () => {
    const t = activeTerm(a); closeModal(); setView('terminal'); await insertText(a, t, quotePath(path));
  }, 'button', 'terminal'));
  body.append(button(tr('Rename'), () => {
    const name = el('input', {value: entry.name});
    modal(tr('Rename file or folder'), el('div', {}, field(tr('New name'), name), el('div', {class: 'modal-actions'}, button(tr('Rename'), async () => {
      await a.link.request('files.rename', {path, name: name.value}); closeModal(); await listFiles(a);
    }, 'button primary'))));
  }, 'button', 'edit'));
  body.append(button(tr('Delete'), () => confirmAction(tr('Delete this item?'), tr("Permanently delete “{0}”? This is not a move to Trash. Non-empty folders are never deleted recursively.",entry.name), tr('Delete'), async () => {
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
  body.append(el('div', {class: 'modal-actions'}, button(tr('Download'), () => saveBlob(result.blob, result.name), 'button', 'download')));
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
    if (t.path) details.append(button(tr('Copy remote path'), () => copyText(t.path), 'text-button'));
    return el('div', {class: `transfer-item${t.error ? ' transfer-failed' : ''}`}, el('span', {class: 'transfer-icon'}, icon(t.direction === 'up' ? 'upload' : 'download', 20)), details,
      !t.done ? button(tr('Cancel'), () => { t.controller.abort(); t.status = 'Cancelling'; renderTransfers(); }, 'text-button') : null);
  }));
  if (!transfers.length) $('transfer-list').append(el('p', {class: 'modal-copy', text: tr('Files you send and receive will appear here. Transfers resume automatically after a network interruption while this page stays open.')}));
}
async function putFile(a, file, options = {}, operation = null) {
  if (file.size > (a.info?.maxFileBytes || 512 * 1024 * 1024)) throw new Error('This file exceeds the host’s transfer limit.');
  const item = transferItem(a, file.name, 'up', file.size);
  const job=operation || activity(item.key,`${file.name} → ${a.machine.name}`);
  job.update({action:{label:tr('Cancel transfer'),run:()=>item.controller.abort()}});
  try {
    const result = await upload(a.link, file, options, value=>{progressFor(item)(value);job.update({status:`${value.status} · ${size(value.offset)} / ${size(value.total)}`,percent:value.total?Math.round(value.offset/value.total*100):null});}, item.controller.signal);
    item.done = true; item.path = result.path; item.status = tr('Verified · SHA-256'); item.offset = file.size; renderTransfers();
    job.update({action:null});
    if(!operation)job.finish(tr('Uploaded and verified · SHA-256'));
    return result;
  } catch (e) { job.fail(e);item.done = true; item.error = e.name!=='AbortError'&&e.message!=='Transfer cancelled'; item.status = item.error?e.message:tr('Cancelled'); renderTransfers(); throw e; }
}
async function getFile(a, path, name, writer) {
  const item = transferItem(a, name, 'down', 0),job=activity(item.key,`${name} ← ${a.machine.name}`);
  job.update({status:tr('Preparing download…'),action:{label:tr('Cancel transfer'),run:()=>item.controller.abort()}});
  try {
    const result = await download(a.link, path, value=>{progressFor(item)(value);job.update({status:value.status+' · '+size(value.offset)+(value.total?' / '+size(value.total):''),percent:value.total?Math.round(value.offset/value.total*100):null});}, {writer, signal: item.controller.signal});
    if (result.blob) await saveBlob(result.blob, result.name);
    item.done = true; item.status = 'Downloaded'; item.offset = item.total; renderTransfers();job.finish(tr('Downloaded · ')+size(item.offset)); return result;
  } catch (e) { job.fail(e);item.done = true; item.error = e.name!=='AbortError'&&e.message!=='Transfer cancelled'; item.status = item.error?e.message:tr('Cancelled'); renderTransfers(); throw e; }
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
    el('p', {class: 'modal-copy', text: tr('Upload & insert path transfers the file to the host and inserts a safely quoted path, without Enter. Ask your CLI agent to read that path. Native paste instead puts a PNG in the host desktop clipboard, then sends Ctrl+V.')}));
  const doUpload = async native => {
    closeModal();
    for (const input of files) await deliverAttachment(a,t,input,native,files.length>1);
    selected = a.machine.room; view = 'terminal'; await selectSession(a, t.session.id);
  };
  const actions = el('div', {class: 'modal-actions'}, button(tr('Upload & insert path'), () => doUpload(false), 'button primary', 'upload'));
  if (image) {
    const native = button(tr('Native image paste'), () => doUpload(true), 'button', 'paste');
    native.disabled = !a.info?.clipboard?.image; actions.append(native);
    body.append(el('p', {class: 'modal-copy', text: a.info?.clipboard?.image
      ? tr("Desktop clipboard: {0}. The CLI must support image pasting; jaunt cannot force an arbitrary terminal program to interpret an image.",a.info.clipboard.backend)
      : tr('This host is headless or has no supported image clipboard. Use Upload & insert path. No image will be silently converted into terminal text.')}));
  }
  body.append(actions); modal(image ? tr('Send image to terminal') : tr('Attach to terminal'), body, () => { if (previewURL) URL.revokeObjectURL(previewURL); });
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
  const area = el('textarea', {class: 'copy-text', value: text, readOnly: true, 'aria-label': tr('Remote clipboard')});
  modal(tr('Remote clipboard'), el('div', {}, el('p', {class: 'modal-copy', text: tr("Text from {0}. A headless machine uses jaunt’s private text buffer (printf … | jaunt clip).",a.machine.name)}), area,
    el('div', {class: 'modal-actions'}, button(tr('Copy to this device'), () => copyText(text), 'button primary', 'copy'),
      activeTerm(a) ? button(tr('Insert in shell'), async () => { closeModal(); await insertText(a, activeTerm(a), text); }, 'button', 'terminal') : null)));
}
function compose(initial = '', label = tr('Compose text')) {
  const a = online(), t = activeTerm(a); if (!t) throw new Error('Open a terminal first.');
  const area = el('textarea', {class: 'compose-text', value: initial, placeholder: tr('Write or paste an instruction…'), spellcheck: false, 'aria-label': tr('Text to insert')});
  const execute = el('input', {type: 'checkbox', class: 'switch'});
  modal(label, el('div', {}, area, el('label', {class: 'checkbox-label compose-execute'}, execute, tr('Send Enter after inserting (may execute commands)')),
    el('div', {class: 'modal-actions'}, button(tr('Remote clipboard'), async () => { await setRemoteClipboard(a, area.value); toast(tr('Saved in the remote clipboard.')); }),
      button(tr('Insert in terminal'), async () => {
        const text = area.value; closeModal(); await insertText(a, t, text);
        // Multiline unbracketed input uses a confirmation modal. Do not send Enter before that decision.
        if (execute.checked && !( /[\r\n]/.test(text) && !t.term.modes.bracketedPasteMode)) {
          // An Enter that follows the pasted bytes too closely is read as part of the
          // paste by TUI programs (a newline, not a submit). Let the program settle first.
          await new Promise(resolve => setTimeout(resolve, 250));
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
  job.update({status:tr('Preparing image or file…')});
  try {
    const file=input.type.startsWith('image/') ? await toPNG(input) : input;
    const result=await putFile(a,file,{attachment:true},job);
    if(!a.sessions.some(s=>s.id===t.session.id && s.alive))throw new Error('Uploaded, but the destination shell closed. The file remains available in Files → Transfers.');
    job.update({status:native?tr('Copying to host clipboard and sending Ctrl+V…'):tr('Inserting the uploaded path…'),percent:null});
    if(native)await a.link.request('clipboard.image',{path:result.path,session:t.session.id,paste:true});
    else {await insertText(a,t,quotePath(result.path)+(multiple?' ':''));await a.link.request('session.list');}
    job.finish(native?tr('Host clipboard ready · Ctrl+V sent · no Enter'):tr('Uploaded and verified · path inserted · no Enter'));
  } catch(error){job.fail(error);job.update({action:{label:tr('Try again'),run:()=>deliverAttachment(a,t,input,native,multiple,operationId)}});throw error;}
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
    'aria-label': tr('Paste text or image'), 'aria-multiline': 'true',
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
    if (!zone.textContent) toast(tr('The browser did not provide image data. Choose the screenshot with Choose image.'));
  };
  zone.addEventListener('paste', receive);
  zone.addEventListener('beforeinput', event => { if (event.dataTransfer) receive(event); });
  const choose = el('input', {type: 'file', accept: 'image/*', hidden: true});
  choose.onchange = () => { const files = Array.from(choose.files); choose.value = ''; accept(files); };
  const note = a.info?.clipboard?.image
    ? tr("An image will be uploaded, copied to the host clipboard and pasted with Ctrl+V into {0}. No Enter is sent.",t.session.name)
    : tr('This host has no desktop image clipboard. Images use Upload & insert path, without Enter.');
  modal(tr('Paste text or image'), el('div', {},
    el('p', {class: 'modal-copy', text: tr('The clipboard API returned no usable content. Long-press in the area below and choose Paste, or choose your screenshot.')}),
    zone, el('p', {class: 'modal-copy', text: note}), choose,
    el('div', {class: 'modal-actions'}, button(tr('Choose image'), () => choose.click(), 'button', 'image'),
      button(tr('Insert text'), async () => { const text = zone.innerText; if (!text) throw new Error('Paste text or choose an image first.'); closeModal(); await insertText(a, t, text); }, 'button primary'))));
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
    if (t.term.getSelection()) body.append(button(tr('Copy selection'), () => copyText(t.term.getSelection()), 'button primary', 'copy'));
    body.append(button(tr('Copy terminal scrollback'), () => copyText(terminalText(t)), 'button', 'copy'));
    body.append(button(tr('Select / search / copy as text'), () => {
      const text = terminalText(t), area = el('textarea', {class: 'copy-text', value: text, readOnly: true, 'aria-label': tr('Terminal scrollback')});
      modal(tr('Terminal text'), el('div', {}, area, el('div', {class: 'modal-actions'}, button(tr('Select all'), () => { area.focus(); area.select(); }), button(tr('Copy all'), () => copyText(text), 'button primary'), button(tr('Save .txt'), () => saveBlob(new Blob([text], {type: 'text/plain'}), `${t.session.name}.txt`)))));
    }, 'button', 'search'));
  }
  if (a.link.state === 'online') body.append(button(tr('Read remote clipboard'), () => showClipboard(a), 'button', 'paste'));
  if (a.remoteClipboard) body.append(button(tr('Copy last terminal clipboard (OSC 52)'), () => copyText(a.remoteClipboard), 'button', 'copy'));
  modal(tr('Copy & clipboard'), body);
}

function workspaceSettings(a) {
  if (!a.info?.workspace) return [];
  const w = a.info.workspace;
  const sync = el('input', {type: 'checkbox', checked: !!w.sync, 'aria-label': tr('Share open sessions with this host')});
  sync.onchange = async () => { sync.disabled = true; try { a.info.workspace = await a.link.request('workspace.configure', {sync: sync.checked, ...(sync.checked ? workspacePayload(a) : {})}); if (sync.checked) a.wsSent = workspaceSignature(a); } catch (e) { sync.checked = !sync.checked; report(e); } finally { sync.disabled = false; renderSettings(); } };
  const only = el('input', {type: 'checkbox', checked: !!w.displayedOnly, disabled: !w.sync, 'aria-label': tr('Only displayed sessions exist')});
  only.onchange = async () => { only.disabled = true; try { a.info.workspace = await a.link.request('workspace.configure', {displayedOnly: only.checked}); } catch (e) { only.checked = !only.checked; report(e); } finally { only.disabled = false; renderSettings(); render(); } };
  return [settingsRow(tr('Share open sessions'), tr('Every client and the host itself show the same tabs, panes and active session for this host. Changes made anywhere follow everywhere.'), sync),
    settingsRow(tr('Only displayed sessions exist'), w.sync ? tr('Closing a tab or pane terminates its shell; the Sessions list and the close-or-terminate choice disappear for this host.') : tr('Requires shared open sessions.'), only)];
}
function hostVersionText(a) {
  const status = a.info?.updates || {}, active = hostUpdateJobs.has(a.machine.room);
  if (active) return `${a.info.version} · ${describeUpdate(status)}`;
  if (status.state === 'deferred') return `${a.info.version} · ${tr('Update {0} is downloaded and waits to install', status.version || '')}`;
  if (status.state === 'error') return `${a.info.version} · ${tr('Last update attempt failed')}`;
  return a.info.version;
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
  const name = el('input', {value:a.machine.friendlyName || a.machine.name, maxlength:80, 'aria-label':tr('Friendly host name')});
  name.onchange = async () => { a.machine.friendlyName = name.value.trim().slice(0,80) || a.machine.name; await persist(); render(); };
  const order = el('div',{class:'modal-actions'});
  for (const [delta,label] of [[-1,tr('Move up')],[1,tr('Move down')]]) order.append(button(label,async()=>{
    const list=vault.data.machines, visible=list.filter(m=>machines.has(m.room)), from=visible.indexOf(a.machine), to=from+delta;
    if(to<0||to>=visible.length)return;
    const x=list.indexOf(visible[from]),y=list.indexOf(visible[to]);[list[x],list[y]]=[list[y],list[x]];await persist();renderMachines();
  }));
  return [settingsRow(tr('Friendly name'),tr('Only changes the name on this device.'),name),settingsRow(tr('Host order'),tr('Choose the order in the sidebar.'),order),
    settingsRow(tr('Open by default'),prefs().defaultHost === a.machine.room ? tr('This host opens when the app starts.') : tr('Choose the first host shown when the app starts.'),button(tr('Use this host'),async()=>{vault.data.preferences.defaultHost=a.machine.room;await persist();renderSettings();}))];
}
function attentionSettings(a) {
  return ['bell','program','exit'].map(key => {
    const input=el('input',{type:'checkbox',checked:a.info?.notifications?.[key] !== false,'aria-label':key+' notifications'});
    input.onchange=async()=>{try {a.info.notifications=await a.link.request('notifications.configure',{...a.info.notifications,[key]:input.checked});}catch(e){input.checked=!input.checked;report(e);}};
    return settingsRow({bell:tr('Terminal bell'),program:tr('Program notifications'),exit:tr('Session finished')}[key],{bell:tr('When a terminal rings its attention bell.'),program:'OSC 9 and OSC 777 notifications from terminal programs.',exit:tr('When the shell exits. For individual command completion, use jaunt run -- command.')}[key],input);
  });
}
const bridgeJobs=new Map();
function bridgeMessageActivity(a,m){
  const key='bridge-'+a.machine.room+'-'+m.id;
  let job=bridgeJobs.get(key);
  if(!job){job=activity(key,tr("AI sessions · {0}",a.machine.name));bridgeJobs.set(key,job);}
  const who=`${m.from} → ${m.to}`;
  const labels={accepted:tr('Accepted'),delivering:tr('Delivering…'),delivered:tr('Delivered to the session'),failed:tr('Delivery failed'),cancelled:tr('Cancelled')};
  const text=`${who} · ${labels[m.state]||m.state}${m.detail?' · '+m.detail:''}${m.preview?' · '+m.preview:''}`;
  if(m.state==='failed')job.fail(new Error(text));
  else if(m.state==='delivered'||m.state==='cancelled')job.finish(text);
  else job.update({status:text});
}
function bridgeSettings(a){
  const b=a.info?.bridge;
  if(!b||!b.visible)return [];
  const runtimes=b.runtimes||{};
  const versions=['claude','codex'].map(k=>`${k==='claude'?'Claude Code':'Codex'} ${runtimes[k]?.version||'?'}`).join(' · ');
  let description,control;
  if(!b.available){
    description=(b.reason?tr(b.reason):tr('Unavailable on this host.'))+' · '+versions;
    control=el('span',{class:'settings-hint',text:tr('Unavailable')});
  } else {
    const toggle=el('input',{type:'checkbox',checked:!!b.enabled,'aria-label':tr('Claude Code ↔ Codex bridge')});
    toggle.onchange=async()=>{
      toggle.disabled=true;const job=activity('bridge-setup-'+a.machine.room,tr("AI sessions · {0}",a.machine.name));
      job.update({status:toggle.checked?tr('Preparing the integrations in Claude Code and Codex…'):tr('Turning the bridge off…')});
      try{a.info.bridge=await a.link.request('bridge.configure',{enabled:toggle.checked},120000);job.finish(toggle.checked?tr('Bridge on. Sessions opened from now on take part; sessions already open join after their next restart. Codex asks once in its terminal to trust the new hooks.'):tr('Bridge off. Existing sessions keep running; no further cross-runtime messages are delivered.'));}
      catch(error){toggle.checked=!toggle.checked;job.fail(error);}
      finally{toggle.disabled=false;renderSettings();}
    };
    description=(b.enabled?tr('On. Claude Code and Codex sessions started from jaunt shells on the same project know about each other and can message each other.'):tr('Off. Turn on to let Claude Code and Codex sessions on the same project discover and message each other automatically.'))+' · '+versions;
    control=toggle;
  }
  const rows=[settingsRow(tr('Claude Code ↔ Codex bridge'),description,control)];
  if(b.enabled){
    const participants=b.participants||[],unbridged=b.unbridged||[];
    const list=el('div',{class:'bridge-list'});
    for(const p of participants)list.append(el('div',{class:'bridge-row',text:`${p.runtime==='claude'?'Claude Code':'Codex'} · ${p.terminal} · ${p.project||p.cwd} · ${p.state==='busy'?tr('working'):tr('idle')}`}));
    for(const u of unbridged)list.append(el('div',{class:'bridge-row muted',text:tr("{0} in \"{1}\" was started before the bridge and joins after its next restart or /clear.",u.runtime==='claude'?'Claude Code':'Codex',u.terminal)}));
    if(!participants.length&&!unbridged.length)list.append(el('div',{class:'bridge-row muted',text:tr('No Claude Code or Codex session is running in a jaunt shell right now.')}));
    rows.push(settingsRow(tr('Bridged sessions'),tr('Real interactive sessions registered through their own hooks. Only sessions of the other runtime on the same project are announced to each other.'),el('span')),list);
  }
  return rows;
}
function desktopUpdateStatus(value) {
  value={...value,message:tr(value.message||'')};
  const changed=desktopUpdateState?.state!==value.state || desktopUpdateState?.automatic!==value.automatic;
  desktopUpdateState=value;
  if((!desktopUpdateOperation || desktopUpdateOperation.item.dismissed) && ['downloading','verifying','ready','installed','error'].includes(value.state))desktopUpdateOperation=activity('desktop-update',tr('Desktop update'));
  const job=desktopUpdateOperation;
  if(job){
    job.update({status:value.message+(value.target?' · '+value.target:''),percent:value.percent??null,done:false,error:false,waiting:false,action:null});
    if(value.state==='error'){job.fail(new Error(value.message));job.update({action:{label:tr('Try again'),run:checkDesktopUpdate}});}
    else if(value.state==='ready')job.update({done:true,waiting:true,status:value.message+(value.target?' · '+value.target:'')+(value.requiresAuthorization?' System authorization will be requested.':''),action:{label:tr('Install and reopen'),run:()=>desktop.updates('install')}});
    else if(['current','installed'].includes(value.state))job.finish(value.message);
  }
  if(view==='settings' && changed)renderSettings();
}
async function checkDesktopUpdate(){
  desktopUpdateOperation=activity('desktop-update',tr('Desktop update'));
  desktopUpdateOperation.update({status:tr('Checking published version…')});
  try{desktopUpdateStatus(await desktop.updates('check'));}catch(error){desktopUpdateOperation.fail(error);}
}
const hostUpdateJobs=new Map();
function updateLabels(){return {checking:tr('Checking published version…'),downloading:tr('Downloading host update…'),verifying:tr('Verifying downloaded files…'),installing:tr('Installing · shells are kept running…'),current:tr('Up to date'),installed:tr('Update installed · shells were kept'),deferred:tr('Downloaded · waiting to install'),error:tr('Update failed'),disabled:tr('Automatic updates are disabled on this host')};}
function describeUpdate(status){
  if(!status||!status.state)return '';
  const text=(status.message&&tr(status.message))||updateLabels()[status.state]||tr('Checking…');
  return text+(status.version?' · '+status.version:'');
}
// Every source of update state converges here: pushed progress, the welcome
// after a runtime handoff, and the slow fallback poll.
function hostUpdateProgress(a,status){
  if(!status||typeof status!=='object')return;
  if(a.info)a.info.updates={...a.info.updates,...status};
  // An update started elsewhere (another device, the automatic check) is shown
  // here too once it starts changing the host, so the coming restart is explained.
  if(!hostUpdateJobs.has(a.machine.room)&&['downloading','verifying','installing'].includes(status.state))followHostUpdate(a,null,status).catch(()=>{});
  hostUpdateJobs.get(a.machine.room)?.observe(status);
  if(view==='settings'&&a===current())renderSettings();
}
function checkHostUpdate(a,allowRestart=false){return followHostUpdate(a,()=>a.link.request('updates.install',{allowRestart}),null,allowRestart);}
async function followHostUpdate(a,start,initial=null,allowRestart=false) {
  const existing=hostUpdateJobs.get(a.machine.room);
  if(existing){existing.job.update({});return;}
  const job=activity('host-update-'+a.machine.room,tr("Host update · {0}",a.machine.name));
  const tracker={job,operation:initial?.operation||null,requestedAt:Date.now()/1000,settled:false};
  hostUpdateJobs.set(a.machine.room,tracker);
  let settle;const settled=new Promise(resolve=>{settle=resolve;});
  const terminal=['current','installed','deferred','error','disabled'];
  tracker.observe=status=>{
    if(tracker.settled||!status.state)return;
    if(tracker.operation&&status.operation&&status.operation!==tracker.operation)return;
    if(!tracker.operation&&status.checkedAt&&status.checkedAt<Math.floor(tracker.requestedAt)-1)return;
    const text=describeUpdate(status);
    if(!terminal.includes(status.state)){job.update({status:text,waiting:false,error:false,action:null});return;}
    tracker.settled=true;
    if(status.state==='error'){job.fail(new Error(text));job.update({action:{label:tr('Try again'),run:()=>checkHostUpdate(a,allowRestart)}});}
    else{job.finish(text);if(status.state==='deferred')job.update({waiting:true,action:{label:tr('Review update'),run:()=>{selected=a.machine.room;setView('settings');}}});}
    settle();
  };
  const onStatus=()=>{
    if(tracker.settled)return;
    if(a.link.state==='online')return;
    if(!a.link.enabled){job.update({status:tr('Connection stopped. Reconnect to this host to see the update result.')});return;}
    job.update({status:a.restartExpected?tr('Restarting the host runtime · shells are kept…'):tr('Waiting for the host to reconnect…')});
  };
  a.link.addEventListener('status',onStatus);
  const poll=setInterval(()=>{
    if(tracker.settled||a.link.state!=='online')return;
    a.link.request('updates.status',{},15000).then(status=>hostUpdateProgress(a,status)).catch(()=>{});
  },5000);
  const deadline=setTimeout(()=>{if(!tracker.settled){tracker.settled=true;job.fail(new Error(tr('The host has not confirmed completion yet. Check again to see its current state.')));job.update({action:{label:tr('Try again'),run:()=>checkHostUpdate(a,allowRestart)}});settle();}},30*60*1000);
  try {
    let started=initial||{};
    if(start){
      job.update({status:tr('Checking published version…')});
      try{started=await start();}
      catch(error){
        if(!(error.code==='connection'||/Host is restarting|Connection interrupted|Local host is offline|Wait for the encrypted connection/.test(error.message)))throw error;
        job.update({status:tr('Waiting for the host to reconnect…')});
        if(a.link.enabled)a.link.reconnect();
      }
    }
    if(started.operation)tracker.operation=started.operation;
    if(started.state)tracker.observe(started);
    await settled;
  } catch(error){if(!tracker.settled){tracker.settled=true;job.fail(error);job.update({action:{label:tr('Try again'),run:()=>checkHostUpdate(a,allowRestart)}});}}
  finally {clearInterval(poll);clearTimeout(deadline);a.link.removeEventListener('status',onStatus);if(hostUpdateJobs.get(a.machine.room)===tracker)hostUpdateJobs.delete(a.machine.room);if(view==='settings'&&a===current())renderSettings();}
}
function languagePicker(id) {
 const select=el('select',{'aria-label':tr('Language'),id});
 for(const [value,name] of [['system',tr('System language')],...Object.entries(languages)])select.append(el('option',{value,text:name,selected:value===preference()}));
 select.onchange=async()=>{if(isAndroid)await nativeCall('app.language',{language:select.value});if(desktop?.setLanguage)await desktop.setLanguage(select.value);setLanguage(select.value);};
 return select;
}
function renderSettings() {
  if (!vault.data) return;
  const a = current(), content = $('settings-content');
  settingsMachine = a;
  const font = el('select', {'aria-label': tr('Terminal font size')});
  for (const n of [11, 12, 13, 14, 15, 16, 18, 20]) font.append(el('option', {value: n, text: `${n} px`, selected: n === (prefs().fontSize || 14)}));
  font.onchange = async () => {
    vault.data.preferences.fontSize = Number(font.value);
    for (const host of machines.values()) for (const t of host.terms.values()) t.term.options.fontSize = Number(font.value);
    await persist(); fitActive();
  };
  const lockTime = el('select', {'aria-label': tr('Automatic lock delay')});
  for (const [n, label] of [[0, 'Off'], [1, '1 minute'], [5, '5 minutes'], [15, '15 minutes'], [60, '1 hour']]) lockTime.append(el('option', {value: n, text: tr(label), selected: n === (prefs().autoLock || 0)}));
  lockTime.onchange = async () => { vault.data.preferences.autoLock = Number(lockTime.value); await persist(); };
  const reader = el('input', {type: 'checkbox', checked: !!prefs().screenReader, 'aria-label': tr('Screen reader mode')});
  reader.onchange = async () => {
    vault.data.preferences.screenReader = reader.checked;
    for (const host of machines.values()) for (const t of host.terms.values()) t.term.options.screenReaderMode = reader.checked;
    await persist();
  };
  const theme = el('select', {'aria-label':tr('Color theme')}, ...[['dark',tr('Dark')],['light',tr('Light')],['system',tr('System')],['circadian',tr('Circadian')]].map(([value,text])=>el('option',{value,text,selected:(prefs().theme||'dark')===value})));
  theme.onchange=async()=>{vault.data.preferences.theme=theme.value;applyTheme();await persist();};
  const groups = [
    settingsGroup(tr('THIS DEVICE'),
      settingsRow(tr('Language'),tr('Use the system language or choose a language for this device.'),languagePicker('app-language')),
      settingsRow(tr('Appearance'),tr('Circadian uses light from 07:00 to 19:00 in your local time zone.'),theme),
      settingsRow(tr('Local vault'), vault.protected ? tr('Remembered machine keys are encrypted at rest with your passphrase or PIN.') : tr('Machine keys are stored in this browser profile. Protect them on a shared or unlocked device.'),
        button(vault.protected ? tr('Change protection') : tr('Set passphrase / PIN'), protectVault)),
      settingsRow(tr('Automatic lock'), tr('Locks this browser after inactivity. Shells remain alive on the host. Requires vault protection.'), lockTime),
      ...(vault.protected ? [settingsRow(tr('Lock now'), tr('Disconnects the browser and removes terminal contents from this view.'), button(tr('Lock'), lockWorkspace, 'button', 'lock'))] : []),
      el('p', {class: 'settings-notice', text: tr('A six-digit PIN is less resistant to offline guessing than a long passphrase. Clearing browser data loses pairings. No account recovery or secret escrow.')})),
    settingsGroup(tr('TERMINAL'), settingsRow(tr('Text size'), tr('Applies to all terminal tabs on this device.'), font),
      settingsRow(tr('Screen reader support'), tr('Enables xterm’s accessible text layer.'), reader),
      el('p', {class: 'settings-notice', text: tr('jaunt shells survive disconnections and compatible host updates. Stopping the host or rebooting the computer still ends ordinary shells. The desktop app and connected clients share the same sessions.')}))
  ];
  if (a) {
    groups.push(settingsGroup(tr('SELECTED MACHINE'),
      ...hostPreferences(a),
      settingsRow(a.machine.name, `${a.info?.platform || tr('Remote host')} · ${a.info?.version || tr('Connecting')} · ${a.link.state}`, button(tr('Reconnect'), () => { a.link.start(); })),
      ...(a.info?.updates?.supported ? [settingsRow(tr('Automatic host updates'), tr('Checks every 15 minutes. Downloads are verified; ordinary active shells are never closed automatically.'), button(a.info.updates.automatic ? tr('Disable auto-update') : tr('Enable auto-update'), async () => { a.info.updates = await a.link.request('updates.configure', {automatic: !a.info.updates.automatic}); renderSettings(); })),
        settingsRow(tr('Host version'), hostVersionText(a), hostUpdateJobs.has(a.machine.room) ? el('span', {class: 'settings-hint', text: tr('Update in progress…')}) : button(tr('Check for updates'), ()=>checkHostUpdate(a))),
        ...(a.info.seamlessUpdates ? [settingsRow(tr('Keep shells running'),tr('This host replaces its runtime during updates while keeping shell processes and their history. Transfers finish before installation.'))] : [settingsRow(tr('Update and restart now'), tr('This explicitly closes ordinary shells and interrupts ongoing transfers. Pairing keys are preserved.'), button(tr('Update and restart'), () => confirmAction(tr('Close active shells and update?'), tr('This may terminate running commands in ordinary shells and interrupt file transfers on this host. Continue only when ready.'), tr('Close shells and update'), ()=>checkHostUpdate(a,true), true), 'button danger'))])] : []),
      ...workspaceSettings(a),
      settingsRow(tr('Host clipboard'), a.info?.clipboard?.backend || tr('Unknown until connected'), button(tr('Open'), () => showClipboard(a))),
      settingsRow(tr('Authorized devices'), tr('Devices have the same rights as this host user. Revoke a lost phone from here or with jaunt revoke.'), button(tr('Manage'), () => manageDevices(a))),
      ...(!a.machine.local ? [settingsRow(tr('Forget this machine'), tr('Removes its saved key from this browser. Revoke it on the host first when possible.'), button(tr('Forget'), () => forgetMachine(a), 'button danger'))] : [])));
    if(a.info?.bridge?.visible)groups.push(settingsGroup(tr('AI SESSIONS'),...bridgeSettings(a)));
    groups.push(settingsGroup(tr('NOTIFICATIONS'),
      ...(a.info?.sharedViews ? attentionSettings(a) : []),
      ...(!desktop ? [settingsRow(isAndroid ? tr('Android background notifications') : tr('Background push'), isAndroid ? tr('Keep an encrypted connection using an Android foreground service. A persistent notification lets you stop it. Battery restrictions can delay delivery.') : a.machine.push ? tr('Registered for this machine. Delivery depends on browser/OS permissions and the host being online.') : tr('Standard Web Push sent by your host. No ntfy, bot or third-party notification account.'),
        button(a.machine.push ? tr('Disable') : tr('Enable'), async () => {
          if (a.machine.push) await push.unsubscribe(vault, a.link); else await push.subscribe(vault, a.link);
          renderSettings(); toast(tr('Notification preference saved.'));
        }))] : []),
      settingsRow(tr('Test delivery'), tr('Notifications show the title and message sent by the program.'), button(tr('Send test'), async () => {
        const result = await a.link.request('notifications.test');
        toast(desktop ? tr('Test sent. Background the desktop app to see its OS notification.') : isAndroid ? tr('Test sent. Check Android notifications after enabling the background connection.') : result.delivered ? tr('Push sent to the notification provider.') : result.results?.join('; ') || tr('No push subscription delivered; a live in-app notification may still appear.'), !desktop && !isAndroid && !result.delivered);
      })),
      el('p', {class: 'settings-notice', text: (isAndroid ? tr('The Android service reconnects with your saved keys. Force-stop and some battery-saving modes prevent delivery. Notification content follows your Android lock-screen privacy settings. ') : '') + tr('From any jaunt shell: jaunt notify "Need your attention". For command completion: jaunt run -- your-command. Closing/force-stopping the browser or battery restrictions can delay or block push; delivery is not guaranteed by the operating system.')})));
  }
  if (desktop) {
    const notifications=el('input',{type:'checkbox',checked:!!prefs().desktopNotifications,'aria-label':tr('Desktop notifications')});
    notifications.onchange=async()=>{vault.data.preferences.desktopNotifications=notifications.checked;await persist();};
    const autoDesktop=el('input',{type:'checkbox',checked:desktopUpdateState?.automatic!==false,'aria-label':tr('Automatic desktop updates')});
    autoDesktop.onchange=()=>desktop.updates('configure',autoDesktop.checked).then(desktopUpdateStatus).catch(report);
    groups.push(settingsGroup(tr('DESKTOP APP'),
      settingsRow(tr('Desktop version'),desktopUpdateState?.message || tr('Loading update status…'),button(tr('Check desktop update'),checkDesktopUpdate)),
      settingsRow(tr('Automatic desktop updates'),tr('Downloads and verifies updates automatically. Installs when the app closes; host shells keep running. System packages may require OS authorization.'),autoDesktop),
      settingsRow(tr('Desktop notifications'),tr('Show the program’s notification when this window is in the background.'),notifications)));
    if (desktopHostAvailable && (!a || a.machine.local)) groups.push(settingsGroup(tr('LOCAL HOST ON THIS COMPUTER'),
      settingsRow(tr('Local host'),tr('Local and remote views share the same shells. Closing this window leaves them running.'),button(tr('Start host'),async()=>{await desktop.action('start');machines.get('local-host')?.link.start();})),
      settingsRow(tr('Start automatically'),tr('Install the user service. Active ordinary shells must be closed explicitly before replacing an existing daemon.'),button(tr('Install service'),async()=>{const job=activity('host-service',tr('Automatic host startup'));try{job.update({status:tr('Installing and enabling the user service…')});const result=await desktop.action('service');job.finish(result.message);machines.get('local-host')?.link.start();}catch(error){job.fail(error);}})),
      settingsRow(tr('Connect another device'),tr('Create a private one-use pairing link for this host.'),button(tr('Pair device'),async()=>{const result=await desktop.action('pair');modal(tr('Pair this computer'),el('div',{},...(result.qr?[el('img',{class:'pair-qr',src:'data:image/svg+xml;base64,'+result.qr,alt:tr('One-use pairing QR code')})]:[]),el('p',{text:tr('Open this one-use link on your other device. It expires after ten minutes. Keep it private.')}),el('textarea',{class:'pair-code',readOnly:true,value:result.url}),button(tr('Copy pairing link'),()=>copyText(result.url))));}))));
  }
  if(!desktop && !isAndroid) groups.push(settingsGroup(tr('DESKTOP APP'),installationChoices()));
  if (androidAPK && !isAndroid) groups.push(settingsGroup(tr('ANDROID APP'), settingsRow(tr('Install the APK'), tr('Native Android clipboard, camera and background notifications. Your browser pairing stays separate.'), el('a', {class: 'button primary', text: tr('Download Android APK'), href: androidAPK}))));
  const install = button(installedPrompt ? tr('Install app') : tr('Installation help'), async () => {
    if (installedPrompt) { await installedPrompt.prompt(); await installedPrompt.userChoice; installedPrompt = null; renderSettings(); }
    else modal(tr('Install jaunt on your phone'), el('div', {}, el('p', {class: 'modal-copy', text: tr('Open the browser menu and choose “Install app” or “Add to Home screen”. On iPhone/iPad, use Safari → Share → Add to Home Screen. This installs the web app. For Android camera, clipboard and notification integration, use Download Android APK in Settings.')})));
  });
  groups.push(settingsGroup(tr('jaunt'), settingsRow(isAndroid ? 'jaunt for Android' : tr('Installable web app'), isAndroid ? tr('Installed APK · bundled interface and native Android integrations.') : 'A focused window on your home screen, with the same remembered machines.', isAndroid ? button(tr('Check for updates'), () => nativeCall('app.updates')) : install),
    el('p', {class: 'settings-notice', text: tr('jaunt 0.1.0 beta · Host-authenticated encrypted channels · Open source. The custom protocol has automated tests, not an independent security audit. The relay transports ciphertext but can see routing metadata and interrupt availability. Never pair an untrusted device.')})));
  content.replaceChildren(...groups);
}
function protectVault() {
  const first = el('input', {type: 'password', autocomplete: 'new-password', minLength: 6});
  const second = el('input', {type: 'password', autocomplete: 'new-password', minLength: 6});
  const actions = el('div', {class: 'modal-actions'}, button(tr('Save protection'), async () => {
    if (first.value !== second.value) throw new Error('The two values do not match.');
    await vault.protect(first.value); closeModal(); renderSettings(); render(); toast(tr('Vault protection enabled.'));
  }, 'button primary'));
  if (vault.protected) actions.append(button(tr('Remove protection'), () => confirmAction(tr('Remove local protection?'), tr('Anyone who can use this browser profile will be able to reconnect to your hosts without a PIN.'), tr('Remove'), async () => {
    await vault.unprotect(); renderSettings(); render();
  }, true), 'button danger'));
  modal(tr('Protect this device'), el('div', {}, el('p', {class: 'modal-copy', text: tr('Choose at least six characters. A long passphrase protects better than a short PIN. This encrypts remembered keys in the browser; it is not a password sent to the relay.')}),
    field(tr('New passphrase or PIN'), first), field(tr('Repeat it'), second), actions)); first.focus();
}
async function manageDevices(a) {
  const devices = await a.link.request('devices.list');
  const body = el('div', {class: 'file-menu'});
  for (const device of devices) body.append(el('div', {class: 'settings-row'},
    el('div', {class: 'settings-label'}, el('strong', {text: device.name + (device.id === a.machine.deviceId ? ' · '+tr('this browser') : '')}),
      el('p', {text: tr("Last seen {0}",new Date(device.lastSeen * 1000).toLocaleString())})),
    button(tr('Revoke'), () => confirmAction(tr('Revoke this device?'), `${device.name} will lose access immediately. Its existing PTYs are not terminated.`, tr('Revoke'), async () => {
      await a.link.request('devices.revoke', {id: device.id});
      if (device.id === a.machine.deviceId) { a.link.stop('Revoked'); toast(tr('This device was revoked on the host.')); }
      else toast(tr('Device revoked.'));
    }, true), 'button danger')));
  modal(tr('Authorized devices'), body);
}
function forgetMachine(a) {
  confirmAction(tr('Forget this machine?'), tr('This removes its key locally. It does not terminate shells or revoke other browsers. To revoke this saved identity on the host, use Authorized devices first.'), tr('Forget'), async () => {
    if (isAndroid) await nativeCall('notifications.disable', {room: a.machine.room});
    a.link.stop(); for (const t of a.terms.values()) { t.term.dispose(); t.node.remove(); }
    machines.delete(a.machine.room); vault.data.machines = vault.data.machines.filter(m => m.room !== a.machine.room);
    if (selected === a.machine.room) selected = [...machines.keys()][0] || null;
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
  $('terminal-meta').textContent = ''; $('machine-title').textContent = tr('Locked');
  await vault.lock(); $('lock-screen').hidden = false; $('unlock-password').value = ''; $('unlock-error').textContent = '';
}
async function resumeWorkspace() {
  selected = null;
  if(desktopHostAvailable && !vault.data.machines.some(m=>m.local)){vault.data.machines.unshift({room:'local-host',name:tr('This computer'),local:true});await persist();}
  for (const m of vault.data.machines) if(!m.local||desktopHostAvailable)makeMachine(m);
  selected = machines.has(deepLink.get('host')) ? deepLink.get('host') : (machines.has(prefs().defaultHost) ? prefs().defaultHost : [...machines.keys()][0]) || null;
  applyTheme();try{const saved=localStorage.getItem('jaunt-sidebar-collapsed');if(saved!==null)vault.data.preferences.sidebarCollapsed=saved==='true';}catch{}document.body.classList.toggle('sidebar-collapsed',!!prefs().sidebarCollapsed);$('sidebar-toggle').setAttribute('aria-expanded',String(!prefs().sidebarCollapsed));$('sidebar-toggle').setAttribute('aria-label',prefs().sidebarCollapsed?tr('Expand sidebar'):tr('Collapse sidebar'));
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
  $('sidebar-toggle').onclick=async()=>{vault.data.preferences.sidebarCollapsed=!prefs().sidebarCollapsed;try{localStorage.setItem('jaunt-sidebar-collapsed',String(prefs().sidebarCollapsed));}catch{}document.body.classList.toggle('sidebar-collapsed',prefs().sidebarCollapsed);$('sidebar-toggle').setAttribute('aria-expanded',String(!prefs().sidebarCollapsed));$('sidebar-toggle').setAttribute('aria-label',prefs().sidebarCollapsed?tr('Expand sidebar'):tr('Collapse sidebar'));await persist();fitActive();};
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
      modal(tr('New folder'), el('div', {}, field(tr('Name'), name), el('div', {class: 'modal-actions'}, button(tr('Create folder'), async () => {
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
    if (!window.confirm(tr('Reset all remembered machines on this browser? You will need new pairing codes. Remote authorizations must be revoked separately on each host.'))) return;
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
      if (!selectedMachine || !term) { toast(tr('Open a shell, then share the image to jaunt again.'), true); return; }
      confirmAction(tr('Send this shared image?'), tr("Send the image to {0} on {1}.",term.session.name,selectedMachine.machine.name), tr('Send image'), () => pasteFiles(selectedMachine, term, shared.files));
    }
  }
  window.addEventListener('jaunt-native-open', () => nativeOpen().catch(report));
  if (isAndroid) setTimeout(() => nativeOpen().catch(report), 1500);
  let hadWebController=!!navigator.serviceWorker?.controller;
  navigator.serviceWorker?.addEventListener('controllerchange',()=>{
    if(!hadWebController){hadWebController=true;return;}
    const job=activity('web-update',tr('Web update available'));job.finish(tr('Ready to apply. Reloading keeps your host shells open.'));job.update({action:{label:tr('Reload now'),run:()=>location.reload()}});
  });
  navigator.serviceWorker?.addEventListener('message', e => {
    if (e.data?.type !== 'open-session') return;
    openNotification(e.data.host, e.data.session);
  });
}
async function bootstrap() {
  if (!window.isSecureContext || !crypto.subtle) throw new Error('jaunt requires HTTPS, or localhost for development. Do not open index.html directly.');
  bindEvents(); viewport();
  if(desktop){desktopHostAvailable=(await desktop.capabilities()).localHost;desktop.onFrame(message=>{if(message.type==='desktop.update'){desktopUpdateStatus(message);return;}if(message.type==='desktop.open')openNotification(message.host,message.session);});desktop.updates('status').then(desktopUpdateStatus).catch(report);}
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
      const apk = el('a', {class: 'button primary', text: tr('Download Android APK'), href: androidAPK});
      if (view === 'settings') renderSettings();
      $('welcome').append(el('div', {class: 'android-download'}, apk, el('p', {class: 'modal-copy', text: tr('Installable Android app with native clipboard, camera and background notifications.')})));
    }
    if(!desktop && !isAndroid && /^desktop-v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(config.desktopRelease||'')){
      desktopRelease=`https://github.com/moukrea/jaunt/releases/tag/${config.desktopRelease}`;
      $('welcome').append(el('div',{class:'android-download'},installationChoices()));
    }
    if(androidAPK)$('site-android-download').href=androidAPK;
    if (!config.relay) {
      $('deployment-note').hidden = false;
      $('deployment-note').textContent = tr('Project deployment pending: configure and deploy the relay before using the public installer. Local development and pairing to an existing jaunt host are available.');
    }
  } catch { $('deployment-note').hidden = false; $('deployment-note').textContent = tr('Deployment configuration is unavailable. This does not affect existing paired machines.'); }
}
function fatal(error) {
  document.body.append(el('div', {class: 'fatal-note'}, el('div', {}, el('h2', {text: tr('jaunt could not start')}), el('p', {class: 'modal-copy', text: error.message || String(error)}), button(tr('Reload'), () => location.reload(), 'button primary'))));
}
// One tab owns this browser's IndexedDB vault at a time; avoids last-writer-wins
// credential loss. Multiple devices and multiple terminal tabs remain supported.
if (navigator.locks) {
  navigator.locks.request('jaunt-workspace-owner', {ifAvailable: true}, async lock => {
    if (!lock) { fatal(new Error('jaunt is already open in another tab of this browser. Use that tab, or close it and reload here.')); return; }
    try { await bootstrap(); await new Promise(() => {}); } catch (e) { fatal(e); }
  }).catch(fatal);
} else bootstrap().catch(fatal);
