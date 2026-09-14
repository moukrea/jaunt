import terminalBundle from '../vendor/xterm.mjs';
import {Link, parsePairing} from './link.mjs';
import {Vault} from './vault.mjs';
import {b64, unb64, random, utf8} from './crypto.mjs';
import {upload, download, toPNG, saveBlob, quotePath} from './transfers.mjs';
import {fillIcons, icon} from './icons.mjs';
import {$, el, button, toast, modal, closeModal, field, confirmAction, copyText, size} from './ui.mjs';
import {scan} from './qr.mjs';
import * as push from './push.mjs';

const {Terminal, FitAddon} = terminalBundle;
const vault = new Vault(), machines = new Map(), transfers = [];
let selected = null, view = 'terminal', pairedFromURL = '', ctrl = false, alt = false;
let activeAt = Date.now(), hiddenAt = 0, installedPrompt, applicationStarted = false;
const isMobile = () => matchMedia('(max-width: 760px)').matches;
const current = () => machines.get(selected);
const activeTerm = a => a?.terms.get(a.active);
const prefs = () => vault.data?.preferences || {};
const checked = p => { if (!p) throw new Error('Choose a connected machine first.'); return p; };
const online = () => { const a = checked(current()); if (a.link.state !== 'online') throw new Error('Wait for the encrypted connection.'); return a; };
const persist = () => vault.save();
const report = error => toast(error.message || String(error), true);

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
  view = value; drawer(); render();
  if (view === 'files' && current()?.link.state === 'online') listFiles(current()).catch(report);
  if (view === 'settings') renderSettings();
}
function showPair() {
  const input = el('textarea', {class: 'pair-code', rows: 4, placeholder: 'JAUNT1.… or the complete pairing link', spellcheck: false, autocapitalize: 'off', 'aria-label': 'Pairing code'});
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
  toast('Verifying the host. You will not need to pair again when changing networks.');
}
function makeMachine(machine) {
  const a = {machine, link: null, info: null, sessions: [], terms: new Map(), active: machine.lastSession || '',
    path: machine.lastPath || '~', pathDraft: null, listing: null, listingVersion: 0, remoteClipboard: '', fileError: ''};
  a.link = new Link(machine, persist); machines.set(machine.room, a);
  a.link.addEventListener('status', () => {
    for (const t of a.terms.values()) {
      if (a.link.state !== 'online') t.attached = false;
      updateTermInput(a, t);
    }
    render();
  });
  a.link.addEventListener('error', e => toast(`${machine.name}: ${e.detail}`, true));
  a.link.addEventListener('revoked', () => toast(`${machine.name}: access revoked. Forget this machine or pair it again.`, true));
  a.link.addEventListener('latency', () => { if (selected === machine.room) renderConnection(); });
  a.link.addEventListener('welcome', e => {
    a.info = e.detail.machine; a.sessions = e.detail.sessions; syncSessions(a);
    // Only attach terminal views this browser actually opened; sessions need no viewer to run.
    for (const t of a.terms.values()) attachTerm(a, t).catch(report);
    if (!a.active || !a.sessions.some(s => s.id === a.active)) a.active = a.sessions[0]?.id || '';
    if (selected === machine.room) {
      render(); if (a.active) selectSession(a, a.active).catch(report);
      if (view === 'files') listFiles(a).catch(report);
      if (view === 'settings') renderSettings();
    }
    if (machine.pending === false && machine.push) {
      // Host already retains subscription; no permission prompt on reconnect.
    }
    if (deepLink.get('host') === machine.room && deepLink.get('session')) {
      selected = machine.room; if (a.sessions.some(s => s.id === deepLink.get('session'))) selectSession(a, deepLink.get('session')).catch(report);
      deepLink.delete('session'); render();
    }
  });
  a.link.addEventListener('message', e => handleMessage(a, e.detail));
  return a;
}
function syncSessions(a) {
  for (const [id, t] of a.terms) {
    const s = a.sessions.find(s => s.id === id);
    if (!s) { t.term.dispose(); t.node.remove(); a.terms.delete(id); }
    else { t.session = s; updateTermInput(a, t); }
  }
  if (!a.sessions.some(s => s.id === a.active)) a.active = a.sessions[0]?.id || '';
}
function handleMessage(a, message) {
  if (message.type === 'sessions') { a.sessions = message.sessions; syncSessions(a); render(); }
  else if (message.type === 'terminal.reset') {
    const t = a.terms.get(message.id); if (!t) return;
    t.term.reset(); t.offset = message.offset; t.trimmed = message.trimmed;
    if (message.cols && message.rows) t.term.resize(message.cols, message.rows);
  } else if (message.type === 'terminal.output') {
    const t = a.terms.get(message.id); if (!t) return;
    const raw = unb64(message.data), expected = t.offset ?? message.offset;
    if (message.offset > expected) {
      if (!t.repairing) { t.repairing = true; attachTerm(a, t).finally(() => { t.repairing = false; }).catch(report); }
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
    toast(`${message.title}${message.body ? ' — ' + message.body : ''}`, false,
      message.session ? {label: 'Open', run: () => { selected = a.machine.room; setView('terminal'); selectSession(a, message.session).catch(report); }} : null);
  } else if (message.type === 'clipboard.available') {
    toast(`${a.machine.name} shared clipboard text.`, false, {label: 'Open', run: () => showClipboard(a)});
  }
}

function renderConnection() {
  const a = current(), state = a?.link.state || 'offline';
  const labels = {online: 'Encrypted', offline: 'Not connected', connecting: 'Connecting', authenticating: 'Verifying host', waiting: 'Host offline', reconnecting: 'Reconnecting'};
  $('connection').className = 'connection ' + state;
  $('connection').lastElementChild.textContent = labels[state] || state;
  $('latency').hidden = !(state === 'online' && a.link.latency != null);
  $('latency').textContent = a?.link.latency != null ? `${a.link.latency} ms` : '';
  $('connection-banner').hidden = !a || state === 'online';
  $('connection-banner').textContent = state === 'offline'
    ? (a?.link.message || 'Not connected. Open Settings and choose Reconnect to use the saved pairing.')
    : 'Reconnecting without a new pairing. Remote shells stay alive while the host daemon is running.';
}
function renderMachines() {
  $('machine-count').textContent = machines.size;
  const nodes = [...machines.values()].map(a => {
    const b = button('', () => { selected = a.machine.room; drawer(); render(); if (a.active) selectSession(a, a.active); if (view === 'files') return listFiles(a); }, 'machine-item' + (selected === a.machine.room ? ' selected' : ''));
    b.append(el('span', {class: 'machine-symbol'}, icon('monitor')), el('span', {class: 'machine-text'}, el('strong', {text: a.machine.name}), el('small', {text: a.info ? `${a.info.user} · ${a.info.platform}` : a.link.state})),
      el('span', {class: `status-dot ${a.link.state === 'online' ? 'online' : a.link.enabled ? 'working' : ''}`}));
    return b;
  });
  $('machine-list').replaceChildren(...(nodes.length ? nodes : [el('p', {class: 'machine-placeholder', text: 'Your paired machines will appear here.'})]));
}
function render() {
  if (!vault.data) return;
  const a = current(); renderMachines(); renderConnection();
  $('machine-title').textContent = a?.machine.name || 'Overview';
  $('breadcrumb-prefix').textContent = 'Workspace';
  $('welcome').hidden = !!a; $('workspace').hidden = !a;
  $('new-session-top').hidden = !a; $('new-session-top').disabled = a?.link.state !== 'online';
  $('lock-button').hidden = !vault.protected;
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('selected', b.dataset.view === view);
  $('terminal-view').hidden = !a || (view !== 'terminal' && !(view === 'files' && !isMobile()));
  for (const v of ['files', 'transfers', 'settings']) $(v + '-view').hidden = !a || view !== v;
  for (const b of document.querySelectorAll('#new-session-tab, #new-session-empty')) b.disabled = a?.link.state !== 'online';
  $('session-count').textContent = a?.sessions.length || '';
  $('terminal-empty').hidden = !!a?.active;
  for (const host of machines.values()) for (const [id, t] of host.terms) t.node.hidden = host !== a || id !== a.active;
  if (a) {
    renderTabs(a);
    const s = a.sessions.find(s => s.id === a.active), t = activeTerm(a);
    $('rename-session').hidden = !s;
    $('terminal-meta').textContent = s ? `${s.cwd}  ·  ${s.alive ? `${t?.term.cols || s.cols} × ${t?.term.rows || s.rows}` : `Exited (${s.exitCode ?? '—'})`}${t?.trimmed ? '  ·  older output trimmed' : ''}` : 'No active shell';
    if (s && !t && a.link.state === 'online') selectSession(a, s.id).catch(report);
  }
  requestAnimationFrame(fitActive);
}
function renderTabs(a) {
  $('tabs').replaceChildren(...a.sessions.map(s => {
    const label = button(s.name, () => selectSession(a, s.id), 'tab-label');
    label.setAttribute('role', 'tab'); label.setAttribute('aria-selected', String(s.id === a.active));
    const close = button('', () => closeSession(a, s), 'icon-button tab-close', 'close'); close.setAttribute('aria-label', `Close ${s.name}`);
    return el('div', {class: 'session-tab' + (s.id === a.active ? ' active' : '')},
      el('span', {class: 'tab-symbol'}, icon('terminal', 15)), label,
      el('span', {class: `status-dot${s.alive ? ' online' : ''}`}), close);
  }));
}
function createTerm(a, session) {
  const node = el('div', {class: 'terminal-container', hidden: a !== current() || session.id !== a.active, 'data-session': session.id});
  $('terminal-containers').append(node);
  const term = new Terminal({fontSize: prefs().fontSize || 14, fontFamily: 'ui-monospace, "Cascadia Code", "Liberation Mono", Menlo, monospace', lineHeight: 1.18,
    cursorBlink: true, cursorStyle: 'bar', scrollback: 10000, allowProposedApi: true, convertEol: false,
    screenReaderMode: !!prefs().screenReader, scrollOnUserInput: true,
    linkHandler: {activate: (_event, uri) => { try { const u = new URL(uri); if (['https:', 'http:'].includes(u.protocol)) window.open(u.href, '_blank', 'noopener,noreferrer'); } catch {} }},
    theme: {background: '#111314', foreground: '#d9dfd3', cursor: '#e7a246', selectionBackground: '#455342', black: '#151918', brightBlack: '#70786f', red: '#d8897c', green: '#a3c391', yellow: '#e7bc73', blue: '#88adcb', magenta: '#c59bc7', cyan: '#8fc5bf', white: '#dbe0d3', brightWhite: '#f1f3eb'}});
  const fit = new FitAddon(); term.loadAddon(fit); term.open(node);
  const t = {session, node, term, fit, offset: null, attached: false, attaching: null, repairing: false, generation: -1};
  a.terms.set(session.id, t);
  const area = node.querySelector('textarea');
  if (area) { area.setAttribute('autocorrect', 'off'); area.setAttribute('autocapitalize', 'off'); area.spellcheck = false; area.setAttribute('aria-label', `Terminal ${session.name}`); }
  updateTermInput(a, t);
  let initialFit = false;
  term.onRender(() => { if (!initialFit && !node.hidden) { initialFit = true; requestAnimationFrame(fitActive); } });
  term.onData(data => {
    if (!t.attached || a.link.state !== 'online') return;
    if (ctrl && data.length === 1) { data = String.fromCharCode(data.toUpperCase().charCodeAt(0) & 31); ctrl = false; }
    if (alt) { data = '\x1b' + data; alt = false; }
    updateModifiers(); sendInput(a, t, data).catch(report);
  });
  term.onBinary(data => { if (t.attached) a.link.send({type: 'terminal.input', id: session.id, data: b64(Uint8Array.from(data, c => c.charCodeAt(0) & 255))}).catch(report); });
  term.onResize(({cols, rows}) => {
    if (a === current() && a.active === session.id && t.attached && a.link.state === 'online') a.link.send({type: 'terminal.resize', id: session.id, cols, rows}).catch(() => {});
  });
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
      copyText(term.getSelection() || terminalText(t)).catch(report); return false;
    }
    return true;
  });
  node.addEventListener('paste', event => {
    const files = clipboardFiles(event.clipboardData);
    if (files.length) { event.preventDefault(); event.stopImmediatePropagation(); pasteFiles(a, t, files).catch(report); }
    else {
      const text = event.clipboardData?.getData('text/plain');
      if (text) { event.preventDefault(); event.stopImmediatePropagation(); insertText(a, t, text).catch(report); }
      else { event.preventDefault(); event.stopImmediatePropagation(); showPastePanel(a, t); }
    }
  }, true);
  return t;
}
function updateTermInput(a, t) {
  const disabled = a.link.state !== 'online' || !t.session.alive || !t.attached;
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
    await new Promise(resolve => t.term.write('', resolve));
    if (generation !== a.link.generation || a.link.state !== 'online') return;
    t.generation = generation; t.attached = true; updateTermInput(a, t);
    if (a === current() && a.active === t.session.id) {
      fitActive();
      await a.link.send({type: 'terminal.resize', id: t.session.id, cols: t.term.cols, rows: t.term.rows});
    }
  })();
  t.attaching = {generation, promise};
  try { await promise; } finally { if (t.attaching?.promise === promise) t.attaching = null; }
}
async function selectSession(a, id) {
  const session = a.sessions.find(s => s.id === id);
  if (!session) throw new Error('This terminal no longer exists.');
  selected = a.machine.room; a.active = id; a.machine.lastSession = id;
  const t = a.terms.get(id) || createTerm(a, session);
  render();
  if ((!t.attached || t.generation !== a.link.generation) && a.link.state === 'online') await attachTerm(a, t);
  await persist();
  requestAnimationFrame(fitActive);
}
function fitActive() {
  const a = current(), t = activeTerm(a);
  if (!t || $('terminal-view').hidden || t.node.hidden || vault.locked) return;
  try { t.fit.fit(); $('terminal-meta').textContent = `${t.session.cwd}  ·  ${t.term.cols} × ${t.term.rows}${t.session.alive ? '' : ' · exited'}${t.trimmed ? ' · older output trimmed' : ''}`; } catch { /* Hidden/zero-size layout; ResizeObserver retries. */ }
}
async function sendInput(a, t, text) {
  if (a.link.state !== 'online' || !t.session.alive || !t.attached) throw new Error('This terminal is not ready for input.');
  const bytes = utf8(text);
  for (let i = 0; i < bytes.length; i += 8192) await a.link.send({type: 'terminal.input', id: t.session.id, data: b64(bytes.subarray(i, i + 8192))});
}
async function insertText(a, t, text) {
  if (!t) throw new Error('Open a shell before pasting.');
  if (utf8(text).length > 1024 * 1024) throw new Error('Paste is limited to 1 MiB. Upload a file for larger content.');
  if (a.link.state !== 'online' || !t.attached) throw new Error('Wait for the terminal to reconnect before pasting.');
  // Do not allow clipboard text to terminate bracketed paste or smuggle terminal controls.
  const clean = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  const perform = async () => { t.term.paste(clean); };
  if (/[\r\n]/.test(clean) && !t.term.modes.bracketedPasteMode) {
    confirmAction('Paste multiple lines?', 'This shell does not enable bracketed paste. Newlines may execute commands immediately. Review the text with Compose instead when in doubt.', 'Paste anyway', perform, true);
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
async function newSession() {
  const a = online(), id = random(12);
  const name = el('input', {value: `Shell ${a.sessions.length + 1}`, maxLength: 80});
  const cwd = el('input', {value: a.info?.home || '~', spellcheck: false, autocapitalize: 'off'});
  const mode = el('select', {}, el('option', {value: '', text: 'New shell — survives network disconnects'}));
  let tmux = [];
  if (a.info?.tmux) {
    tmux = await a.link.request('tmux.list');
    mode.append(el('option', {value: '__new__', text: 'New tmux session — survives host daemon restarts'}));
    for (const s of tmux) mode.append(el('option', {value: s.name, text: `Attach tmux: ${s.name} (${s.windows} windows)`}));
  }
  const body = el('div', {}, field('Session name', name), field('Working directory', cwd), field('Session type', mode,
    a.info?.tmux ? 'Closing a tmux view does not kill the underlying tmux session.' : 'Install tmux on the host for attachment to external terminals and survival across daemon restarts.'),
    el('div', {class: 'modal-actions'}, button('Cancel', closeModal), button('Create shell', async () => {
      const result = await a.link.request('session.create', {id, name: name.value, cwd: cwd.value,
        tmux: mode.value === '__new__' ? `jaunt-${id}` : mode.value, tmuxCreate: mode.value === '__new__', cols: 100, rows: 30});
      if (!a.sessions.some(s => s.id === result.id)) a.sessions.push(result);
      closeModal(); view = 'terminal'; await selectSession(a, result.id);
      if (!isMobile()) activeTerm(a)?.term.focus();
    }, 'button primary')));
  modal('New terminal', body); name.focus(); name.select();
}
function closeSession(a, session) {
  confirmAction(`Close ${session.name}?`, session.tmux
    ? `This detaches the Jaunt view. The tmux session “${session.tmux}” will keep running.`
    : 'This terminates the shell and its foreground job. Simply closing the browser leaves it running.',
    session.tmux ? 'Detach view' : 'Close shell', async () => {
      await a.link.request('session.close', {id: session.id});
      a.sessions = a.sessions.filter(s => s.id !== session.id); syncSessions(a); render();
    }, true);
}
function renameSession() {
  const a = online(), s = a.sessions.find(s => s.id === a.active); if (!s) return;
  const input = el('input', {value: s.name, maxLength: 80});
  modal('Rename terminal', el('div', {}, field('Name', input), el('div', {class: 'modal-actions'}, button('Save', async () => {
    await a.link.request('session.rename', {id: s.id, name: input.value}); closeModal();
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
function progressFor(item) { return value => { Object.assign(item, value); renderTransfers(); }; }
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
async function putFile(a, file, options = {}) {
  if (file.size > (a.info?.maxFileBytes || 512 * 1024 * 1024)) throw new Error('This file exceeds the host’s transfer limit.');
  const item = transferItem(a, file.name, 'up', file.size);
  try {
    const result = await upload(a.link, file, options, progressFor(item), item.controller.signal);
    item.done = true; item.path = result.path; item.status = 'Verified · SHA-256'; item.offset = file.size; renderTransfers();
    return result;
  } catch (e) { item.done = true; item.error = true; item.status = e.message; renderTransfers(); throw e; }
}
async function getFile(a, path, name, writer) {
  const item = transferItem(a, name, 'down', 0);
  try {
    const result = await download(a.link, path, progressFor(item), {writer, signal: item.controller.signal});
    if (result.blob) saveBlob(result.blob, result.name);
    item.done = true; item.status = 'Downloaded'; item.offset = item.total; renderTransfers(); return result;
  } catch (e) { item.done = true; item.error = true; item.status = e.message; renderTransfers(); throw e; }
}
async function uploadFiles(a, files, path = a.path) {
  for (const file of files) {
    try { await putFile(a, file, {path}); }
    catch (e) { toast(`${file.name}: ${e.message}`, true); }
  }
  await listFiles(a, path);
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
    for (const input of files) {
      const file = input.type.startsWith('image/') ? await toPNG(input) : input;
      const result = await putFile(a, file, {attachment: true});
      if (!a.sessions.some(s => s.id === t.session.id && s.alive)) {
        toast('File uploaded, but the destination shell has closed. Find its path in Transfers.', true); continue;
      }
      if (native) await a.link.request('clipboard.image', {path: result.path, session: t.session.id, paste: true});
      else await insertText(a, t, quotePath(result.path) + (files.length > 1 ? ' ' : ''));
      toast(native ? 'Image sent to the host clipboard; Ctrl+V delivered to the shell.' : 'File uploaded. Its path was inserted without executing anything.');
    }
    selected = a.machine.room; view = 'terminal'; await selectSession(a, t.session.id);
  };
  const actions = el('div', {class: 'modal-actions'}, button('Upload & insert path', () => doUpload(false), 'button primary', 'upload'));
  if (image) {
    const native = button('Native image paste', () => doUpload(true), 'button', 'paste');
    native.disabled = !a.info?.clipboard?.image; actions.append(native);
    body.append(el('p', {class: 'modal-copy', text: a.info?.clipboard?.image
      ? `Desktop clipboard: ${a.info.clipboard.backend}. The CLI must support image pasting; Jaunt cannot force an arbitrary terminal program to interpret an image.`
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
  modal('Remote clipboard', el('div', {}, el('p', {class: 'modal-copy', text: `Text from ${a.machine.name}. A headless machine uses Jaunt’s private text buffer (printf … | jaunt clip).`}), area,
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
async function pasteFiles(a, t, files) {
  // The destination is captured before any async clipboard read or upload.
  // Unsupported hosts keep the explicit upload/path choice, never a fake paste.
  if (files.length !== 1 || !files[0].type.startsWith('image/') || !a.info?.clipboard?.image) {
    await attachFiles(a, t, files); return;
  }
  closeModal();
  const file = await toPNG(files[0]);
  const result = await putFile(a, file, {attachment: true});
  if (!a.sessions.some(s => s.id === t.session.id && s.alive)) {
    throw new Error('Image uploaded, but the destination shell has closed. Find its path in Transfers.');
  }
  await a.link.request('clipboard.image', {path: result.path, session: t.session.id, paste: true});
  toast(`Image copied to the host clipboard; Ctrl+V sent to ${t.session.name}.`);
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
  const groups = [
    settingsGroup('THIS DEVICE',
      settingsRow('Local vault', vault.protected ? 'Remembered machine keys are encrypted at rest with your passphrase or PIN.' : 'Machine keys are stored in this browser profile. Protect them on a shared or unlocked device.',
        button(vault.protected ? 'Change protection' : 'Set passphrase / PIN', protectVault)),
      settingsRow('Automatic lock', 'Locks this browser after inactivity. Shells remain alive on the host. Requires vault protection.', lockTime),
      ...(vault.protected ? [settingsRow('Lock now', 'Disconnects the browser and removes terminal contents from this view.', button('Lock', lockWorkspace, 'button', 'lock'))] : []),
      el('p', {class: 'settings-notice', text: 'A six-digit PIN is less resistant to offline guessing than a long passphrase. Clearing browser data loses pairings. No account recovery or secret escrow.'})),
    settingsGroup('TERMINAL', settingsRow('Text size', 'Applies to all terminal tabs on this device.', font),
      settingsRow('Screen reader support', 'Enables xterm’s accessible text layer.', reader),
      el('p', {class: 'settings-notice', text: 'Plain PTYs survive network loss, not host daemon restarts or reboots. Use tmux for independent sessions. A running terminal outside Jaunt can only be attached when it is already in tmux (or screen from a shell).'}))
  ];
  if (a) {
    groups.push(settingsGroup('SELECTED MACHINE',
      settingsRow(a.machine.name, `${a.info?.platform || 'Remote host'} · ${a.info?.version || 'Connecting'} · ${a.link.state}`, button('Reconnect', () => { a.link.start(); })),
      settingsRow('Host clipboard', a.info?.clipboard?.backend || 'Unknown until connected', button('Open', () => showClipboard(a))),
      settingsRow('Authorized devices', 'Devices have the same rights as this host user. Revoke a lost phone from here or with jaunt revoke.', button('Manage', () => manageDevices(a))),
      settingsRow('Forget this machine', 'Removes its saved key from this browser. Revoke it on the host first when possible.', button('Forget', () => forgetMachine(a), 'button danger'))));
    groups.push(settingsGroup('NOTIFICATIONS',
      settingsRow('Background push', a.machine.push ? 'Registered for this machine. Delivery depends on browser/OS permissions and the host being online.' : 'Standard Web Push sent by your host. No ntfy, bot or third-party notification account.',
        button(a.machine.push ? 'Disable' : 'Enable', async () => {
          if (a.machine.push) await push.unsubscribe(vault, a.link); else await push.subscribe(vault, a.link);
          renderSettings(); toast('Notification preference saved.');
        })),
      settingsRow('Test delivery', 'Background notifications omit command output by default.', button('Send test', async () => {
        const result = await a.link.request('notifications.test');
        toast(result.delivered ? 'Push sent to the notification provider.' : result.results?.join('; ') || 'No push subscription delivered; a live in-app notification may still appear.', !result.delivered);
      })),
      el('p', {class: 'settings-notice', text: 'From any Jaunt shell: jaunt notify "Need your attention". For command completion: jaunt run -- your-command. Closing/force-stopping the browser or battery restrictions can delay or block push; this is not a native Android foreground service.'})));
  }
  const install = button(installedPrompt ? 'Install app' : 'Installation help', async () => {
    if (installedPrompt) { await installedPrompt.prompt(); await installedPrompt.userChoice; installedPrompt = null; renderSettings(); }
    else modal('Install Jaunt on your phone', el('div', {}, el('p', {class: 'modal-copy', text: 'Open the browser menu and choose “Install app” or “Add to Home screen”. On iPhone/iPad, use Safari → Share → Add to Home Screen. This is the web app; a native Android client is not included in this release.'})));
  });
  groups.push(settingsGroup('JAUNT', settingsRow('Installable web app', 'A focused window on your home screen, with the same remembered machines.', install),
    el('p', {class: 'settings-notice', text: 'Jaunt 0.1.0 beta · Host-authenticated encrypted channels · Open source. The custom protocol has automated tests, not an independent security audit. The relay transports ciphertext but can see routing metadata and interrupt availability. Never pair an untrusted device.'})));
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
    a.link.stop(); for (const t of a.terms.values()) { t.term.dispose(); t.node.remove(); }
    machines.delete(a.machine.room); vault.data.machines = vault.data.machines.filter(m => m.room !== a.machine.room);
    if (selected === a.machine.room) selected = vault.data.machines[0]?.room || null;
    await persist(); render(); renderSettings();
  }, true);
}
async function lockWorkspace() {
  if (!vault.protected || !vault.data) return;
  closeModal(); drawer();
  for (const a of machines.values()) { a.link.stop('Locked'); for (const t of a.terms.values()) { t.term.dispose(); t.node.remove(); } }
  for (const t of transfers) if (!t.done) t.controller.abort();
  machines.clear(); transfers.length = 0;
  $('machine-list').replaceChildren(); $('tabs').replaceChildren(); $('file-list').replaceChildren(); $('settings-content').replaceChildren(); $('transfer-list').replaceChildren(); $('toasts').replaceChildren();
  $('terminal-meta').textContent = ''; $('machine-title').textContent = 'Locked';
  await vault.lock(); $('lock-screen').hidden = false; $('unlock-password').value = ''; $('unlock-error').textContent = '';
}
async function resumeWorkspace() {
  selected = null;
  for (const m of vault.data.machines) makeMachine(m);
  selected = machines.has(deepLink.get('host')) ? deepLink.get('host') : vault.data.machines[0]?.room || null;
  for (const a of machines.values()) a.link.start();
  $('lock-screen').hidden = true; activeAt = Date.now(); render(); renderTransfers();
  if (pairedFromURL) { const code = pairedFromURL; pairedFromURL = ''; await pairMachine('JAUNT1.' + code); }
}
function updateModifiers() { $('ctrl-key').setAttribute('aria-pressed', String(ctrl)); $('alt-key').setAttribute('aria-pressed', String(alt)); }
function viewport() {
  const v = window.visualViewport;
  document.documentElement.style.setProperty('--app-height', `${Math.round(v?.height || innerHeight)}px`);
  document.body.classList.toggle('keyboard-open', !!v && innerHeight - v.height > 130);
  fitActive();
}
function bindEvents() {
  $('menu-button').onclick = () => drawer(!$('sidebar').classList.contains('open'));
  $('drawer-backdrop').onclick = () => drawer(); $('add-machine').onclick = showPair;
  $('pair-submit').onclick = async () => { $('pair-submit').disabled = true; try { await pairMachine($('pair-code').value); } catch (e) { report(e); } finally { $('pair-submit').disabled = false; } };
  $('scan-welcome').onclick = () => scan(pairMachine).catch(report);
  $('copy-install').onclick = () => copyText($('install-command').textContent).catch(report);
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);
  $('settings-button').onclick = () => setView('settings'); $('lock-button').onclick = () => lockWorkspace().catch(report);
  for (const id of ['new-session-top', 'new-session-tab', 'new-session-empty']) $(id).onclick = () => newSession().catch(report);
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
    vault.forgetAll().then(() => location.reload()).catch(report);
  };
  window.addEventListener('hashchange', () => {
    const parameters = new URLSearchParams(location.hash.slice(1));
    if (!parameters.has('pair')) return;
    const code = parameters.get('pair');
    history.replaceState(null, '', location.pathname + location.search);
    if (!vault.data) { pairedFromURL = code; return; }
    pairMachine('JAUNT1.' + code).catch(report);
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
  window.addEventListener('resize', () => { viewport(); render(); });
  window.visualViewport?.addEventListener('resize', viewport);
  new ResizeObserver(fitActive).observe($('terminal-stage'));
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installedPrompt = e; if (view === 'settings') renderSettings(); });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); setView('settings'); }
  });
  navigator.serviceWorker?.addEventListener('message', e => {
    if (e.data?.type !== 'open-session' || !vault.data) return;
    const a = machines.get(e.data.host); if (!a) return;
    selected = a.machine.room; setView('terminal'); if (a.sessions.some(s => s.id === e.data.session)) selectSession(a, e.data.session).catch(report);
  });
}
async function bootstrap() {
  if (!window.isSecureContext || !crypto.subtle) throw new Error('Jaunt requires HTTPS, or localhost for development. Do not open index.html directly.');
  bindEvents(); viewport();
  await vault.load();
  if (vault.locked) { $('lock-screen').hidden = false; }
  else await resumeWorkspace();
  applicationStarted = true;
  push.serviceWorker().catch(() => { /* Terminal still works when PWA/push are unavailable. */ });
  try {
    const response = await fetch('./config.json', {cache: 'no-store'});
    const config = await response.json();
    if (!config.relay) {
      $('deployment-note').hidden = false;
      $('deployment-note').textContent = 'Project deployment pending: configure and deploy the relay before using the public installer. Local development and pairing to an existing Jaunt host are available.';
    }
  } catch { $('deployment-note').hidden = false; $('deployment-note').textContent = 'Deployment configuration is unavailable. This does not affect existing paired machines.'; }
}
function fatal(error) {
  document.body.append(el('div', {class: 'fatal-note'}, el('div', {}, el('h2', {text: 'Jaunt could not start'}), el('p', {class: 'modal-copy', text: error.message || String(error)}), button('Reload', () => location.reload(), 'button primary'))));
}
// One tab owns this browser's IndexedDB vault at a time; avoids last-writer-wins
// credential loss. Multiple devices and multiple terminal tabs remain supported.
if (navigator.locks) {
  navigator.locks.request('jaunt-workspace-owner', {ifAvailable: true}, async lock => {
    if (!lock) { fatal(new Error('Jaunt is already open in another tab of this browser. Use that tab, or close it and reload here.')); return; }
    try { await bootstrap(); await new Promise(() => {}); } catch (e) { fatal(e); }
  }).catch(fatal);
} else bootstrap().catch(fatal);
