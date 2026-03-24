import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { sendRpc, sendPtyInput, sendResize, setPtyDataCallback } from '../lib/cairn';
import { store } from '../lib/store';

export default function TerminalComponent() {
  let termDiv: HTMLDivElement | undefined;
  let term: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  const [attached, setAttached] = createSignal(false);

  onMount(async () => {
    if (!termDiv) return;

    // Warm charcoal terminal theme — matches app palette
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

    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available
    }

    fitAddon.fit();

    term.onData((data) => {
      sendPtyInput(new TextEncoder().encode(data));
    });

    term.onBinary((data) => {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
      sendPtyInput(bytes);
    });

    term.onResize(({ cols, rows }) => sendResize(cols, rows));

    setPtyDataCallback((data: Uint8Array) => {
      term?.write(data);
    });

    // Attach to session
    if (store.currentSession()) {
      try {
        const resp = await sendRpc({ SessionAttach: { target: store.currentSession()! } });
        if ('Ok' in resp) {
          const data = resp.Ok;
          if ('Output' in (data as any)) {
            term.write((data as any).Output);
          }
          setAttached(true);
          sendResize(term.cols, term.rows);
        }
      } catch (e: any) {
        term.write(`\r\n\x1b[38;2;224;108;90m Connection failed: ${e.message}\x1b[0m\r\n`);
      }
    }

    const resizeObserver = new ResizeObserver(() => fitAddon?.fit());
    resizeObserver.observe(termDiv);

    onCleanup(() => {
      resizeObserver.disconnect();
      sendRpc({ SessionDetach: {} }).catch(() => {});
      setPtyDataCallback(() => {});
      term?.dispose();
    });
  });

  function detach() {
    sendRpc({ SessionDetach: {} }).catch(() => {});
    store.setCurrentSession(null);
    store.setView('sessions');
  }

  return (
    <div class="flex-1 flex flex-col min-h-0">
      <Show when={!store.currentSession()}>
        <div class="flex-1 flex flex-col items-center justify-center text-center px-6 view-enter">
          <div class="w-14 h-14 rounded-2xl bg-bg-2 flex items-center justify-center mb-5">
            <span class="text-2xl text-amber/40">_</span>
          </div>
          <p class="text-sm text-text-2 mb-1">No session attached</p>
          <p class="text-xs text-text-3 mb-5">Pick a session from the list to connect</p>
          <button
            class="btn-ghost text-sm"
            onClick={() => store.setView('sessions')}
          >
            View sessions
          </button>
        </div>
      </Show>

      <Show when={store.currentSession()}>
        {/* Terminal toolbar — minimal, stays out of the way */}
        <div class="flex items-center justify-between px-3 h-9 bg-bg-1 border-b border-bg-3/30 shrink-0">
          <div class="flex items-center gap-2 text-xs min-w-0">
            <div class={`w-1.5 h-1.5 rounded-full shrink-0 ${attached() ? 'bg-sage pulse' : 'bg-text-3'}`} />
            <span class="font-mono text-text-2 truncate">
              {store.currentSession()?.slice(0, 12)}
            </span>
          </div>
          <button
            class="text-[11px] text-text-3 hover:text-text-1 bg-transparent border-none cursor-pointer transition-colors px-2 py-1"
            onClick={detach}
          >
            Detach
          </button>
        </div>

        {/* Terminal — full bleed, no wasted space */}
        <div
          ref={termDiv}
          class="flex-1 min-h-0"
          style={{ padding: '6px 4px 4px 8px' }}
        />
      </Show>
    </div>
  );
}
