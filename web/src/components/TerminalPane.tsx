import { onMount, onCleanup, createSignal, createEffect, createMemo, Show } from 'solid-js';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { sendRpc, sendPtyInput, sendResize, setPtyDataCallback, setSessionEventCallback } from '../lib/cairn';
import { store } from '../lib/store';
import type { Pane } from '../lib/store';

interface TerminalPaneProps {
  pane: Pane;
  tabId: string;
  onSplit?: (paneId: string, direction: 'horizontal' | 'vertical') => void;
  isMobile?: boolean;
}

export default function TerminalPane(props: TerminalPaneProps) {
  let termDiv: HTMLDivElement | undefined;
  let term: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  const [attached, setAttached] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const [renameValue, setRenameValue] = createSignal('');

  const isFocused = createMemo(() => {
    const tab = store.tabs().find((t) => t.id === props.tabId);
    return tab?.focusedPaneId === props.pane.id && store.activeTabId() === props.tabId;
  });

  const displayName = () => props.pane.sessionName || props.pane.sessionId.slice(0, 10);
  const shellName = () => {
    // Try to get shell from sessions list
    const info = store.sessions().find(s => s.id === props.pane.sessionId);
    return info?.shell?.split('/').pop() || 'sh';
  };

  function startRename() {
    setRenameValue(displayName());
    setRenaming(true);
  }

  async function commitRename() {
    const val = renameValue().trim();
    if (val && val !== displayName()) {
      // Update the pane's sessionName in the store (so displayName refreshes)
      store.renamePaneSession(props.pane.id, val);
      // Update tab label
      store.renameTab(props.tabId, val);
      // Update at host level (uses full session ID, not truncated)
      sendRpc({ SessionRename: { target: props.pane.sessionId, new_name: val } }).catch(() => {});
    }
    setRenaming(false);
  }

  onMount(async () => {
    if (!termDiv) return;

    term = new XTerm({
      theme: {
        background: '#0c0c0e',
        foreground: '#c8c5bd',
        cursor: '#e8a245',
        cursorAccent: '#0c0c0e',
        selectionBackground: '#e8a24525',
        selectionForeground: '#eae8e3',
        black: '#1c1c21',
        red: '#e06c5a',
        green: '#7dba6e',
        yellow: '#e8a245',
        blue: '#6ba3d6',
        magenta: '#b07dc9',
        cyan: '#5db8a8',
        white: '#c8c5bd',
        brightBlack: '#5a5955',
        brightRed: '#ef8a7a',
        brightGreen: '#9dd490',
        brightYellow: '#f0b86a',
        brightBlue: '#8dbde8',
        brightMagenta: '#c99dda',
        brightCyan: '#7dd0c0',
        brightWhite: '#eae8e3',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 14,
      lineHeight: 1.35,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      scrollback: 10000,
      allowProposedApi: true,
      drawBoldTextInBrightColors: true,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termDiv);

    try { term.loadAddon(new WebglAddon()); } catch { /* WebGL not available */ }

    fitAddon.fit();

    term.onData((data) => {
      if (isFocused()) sendPtyInput(new TextEncoder().encode(data));
    });
    term.onBinary((data) => {
      if (isFocused()) {
        const bytes = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
        sendPtyInput(bytes);
      }
    });
    term.onResize(({ cols, rows }) => {
      if (isFocused()) sendResize(cols, rows);
    });

    if (isFocused()) await attachToSession();

    // Handle unsolicited session events (killed, stolen)
    setSessionEventCallback((event, sessionId) => {
      if (sessionId === props.pane.sessionId && term) {
        const msg = event === 'stolen'
          ? '\r\n\x1b[38;2;232;162;69m[Session stolen by another client]\x1b[0m\r\n'
          : '\r\n\x1b[38;2;224;108;90m[Session killed]\x1b[0m\r\n';
        term.write(msg);
        setAttached(false);
      }
    });

    const resizeObserver = new ResizeObserver(() => fitAddon?.fit());
    resizeObserver.observe(termDiv);

    onCleanup(() => {
      resizeObserver.disconnect();
      if (attached() && isFocused()) {
        sendRpc({ SessionDetach: {} }).catch(() => {});
      }
      setAttached(false);
      setPtyDataCallback(() => {});
      setSessionEventCallback(null);
      term?.dispose();
    });
  });

  createEffect(async () => {
    const focused = isFocused();
    if (!term) return;
    if (focused) {
      requestAnimationFrame(() => fitAddon?.fit());
      await attachToSession();
    }
  });

  async function attachToSession() {
    if (!term) return;
    try {
      setPtyDataCallback((data: Uint8Array) => { term?.write(data); });
      const resp = await sendRpc({ SessionAttach: { target: props.pane.sessionId } });
      if ('Ok' in resp) {
        const data = resp.Ok;
        if ('Output' in (data as any)) term.write((data as any).Output);
        setAttached(true);
        if (term) sendResize(term.cols, term.rows);
      }
    } catch (e: any) {
      term?.write(`\r\n\x1b[38;2;224;108;90m Connection failed: ${e.message}\x1b[0m\r\n`);
    }
  }

  function handleClick() {
    if (!isFocused()) store.focusPane(props.pane.id);
  }

  return (
    <div
      data-testid="terminal-pane"
      class="flex-1 flex flex-col min-h-0 min-w-0 group/pane"
      onClick={handleClick}
    >
      {/* Pane header — precision instrument strip */}
      <div
        class={`flex items-center justify-between px-2.5 shrink-0 transition-all duration-200 ${
          isFocused()
            ? 'bg-bg-1'
            : 'bg-bg-1/60'
        }`}
        style={{
          height: '28px',
          'border-top': isFocused()
            ? '2px solid #e8a24580'
            : '2px solid transparent',
          'border-bottom': `1px solid ${isFocused() ? '#e8a24520' : '#252529'}`,
        }}
      >
        {/* Left: status + name + shell badge */}
        <div class="flex items-center gap-2 min-w-0">
          {/* Status dot */}
          <div
            class={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-300 ${
              attached() ? 'bg-sage' : 'bg-text-3/40'
            }`}
          />

          {/* Session name — double-click to rename */}
          <Show
            when={renaming()}
            fallback={
              <span
                class={`text-[11px] font-mono truncate cursor-default transition-colors duration-150 ${
                  isFocused() ? 'text-text-0' : 'text-text-3'
                }`}
                data-testid="pane-session-name"
                onDblClick={(e) => { e.stopPropagation(); startRename(); }}
                title="Double-click to rename"
              >
                {displayName()}
              </span>
            }
          >
            <input
              type="text"
              data-testid="pane-rename-input"
              class="bg-bg-0 border border-amber/40 rounded px-1.5 py-px text-[11px] font-mono text-text-0 outline-none w-28 focus:border-amber/70"
              value={renameValue()}
              onInput={(e) => setRenameValue(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              onBlur={() => commitRename()}
              autofocus
              onClick={(e) => e.stopPropagation()}
            />
          </Show>

          {/* Shell pill badge */}
          <span
            class={`text-[9px] font-mono px-1.5 py-px rounded-sm tracking-wider uppercase shrink-0 transition-colors duration-150 ${
              isFocused()
                ? 'bg-bg-3/60 text-text-2'
                : 'bg-bg-3/30 text-text-3/60'
            }`}
          >
            {shellName()}
          </span>
        </div>

        {/* Right: action buttons — reveal on hover (hidden on mobile) */}
        <Show when={!props.isMobile}>
          <div class="flex items-center gap-px">
            {/* Split left-right */}
            <button
              data-testid="split-horizontal"
              class="w-6 h-5 flex items-center justify-center text-text-3/40 hover:text-amber bg-transparent border-none cursor-pointer rounded-sm hover:bg-amber/8 transition-all duration-150 opacity-0 group-hover/pane:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                props.onSplit?.(props.pane.id, 'horizontal');
              }}
              title="Split left / right"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <rect x="1.5" y="1.5" width="4" height="10" rx="1" stroke="currentColor" stroke-width="1.1" />
                <rect x="7.5" y="1.5" width="4" height="10" rx="1" stroke="currentColor" stroke-width="1.1" />
              </svg>
            </button>
            {/* Split top-bottom */}
            <button
              data-testid="split-vertical"
              class="w-6 h-5 flex items-center justify-center text-text-3/40 hover:text-amber bg-transparent border-none cursor-pointer rounded-sm hover:bg-amber/8 transition-all duration-150 opacity-0 group-hover/pane:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                props.onSplit?.(props.pane.id, 'vertical');
              }}
              title="Split top / bottom"
            >
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <rect x="1.5" y="1.5" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.1" />
                <rect x="1.5" y="7.5" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.1" />
              </svg>
            </button>
            {/* Close pane */}
            <button
              class="w-6 h-5 flex items-center justify-center text-text-3/30 hover:text-coral bg-transparent border-none cursor-pointer rounded-sm hover:bg-coral/8 transition-all duration-150 opacity-0 group-hover/pane:opacity-100"
              onClick={(e) => { e.stopPropagation(); store.closePane(props.pane.id); }}
              title="Close pane"
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                <path d="M1.5 1.5l6 6M7.5 1.5l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
              </svg>
            </button>
          </div>
        </Show>
      </div>

      {/* Terminal surface */}
      <div
        ref={termDiv}
        class="flex-1 min-h-0 min-w-0"
        style={{ padding: '4px 4px 2px 8px' }}
      />
    </div>
  );
}
