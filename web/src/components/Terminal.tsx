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

    // Create terminal
    term = new XTerm({
      theme: {
        background: '#0a0a0f',
        foreground: '#e2e8f0',
        cursor: '#6366f1',
        cursorAccent: '#0a0a0f',
        selectionBackground: '#6366f133',
        black: '#1a1a25',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e2e8f0',
        brightBlack: '#64748b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#f8fafc',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(termDiv);

    // Try WebGL renderer
    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available, fall back to canvas
    }

    fitAddon.fit();

    // Handle terminal input -> send to host via PTY channel
    term.onData((data) => {
      const bytes = new TextEncoder().encode(data);
      sendPtyInput(bytes);
    });

    // Handle terminal binary input
    term.onBinary((data) => {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
      sendPtyInput(bytes);
    });

    // Handle resize
    term.onResize(({ cols, rows }) => {
      sendResize(cols, rows);
    });

    // Receive PTY output from host
    setPtyDataCallback((data: Uint8Array) => {
      if (term) {
        term.write(data);
      }
    });

    // Attach to session
    if (store.currentSession()) {
      try {
        const resp = await sendRpc({ SessionAttach: { target: store.currentSession()! } });
        if ('Ok' in resp) {
          const data = resp.Ok;
          // Write scrollback
          if ('Output' in (data as any)) {
            term.write((data as any).Output);
          }
          setAttached(true);

          // Send initial resize
          sendResize(term.cols, term.rows);
        }
      } catch (e: any) {
        term.write(`\r\n\x1b[31mFailed to attach: ${e.message}\x1b[0m\r\n`);
      }
    }

    // Handle window resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddon) fitAddon.fit();
    });
    resizeObserver.observe(termDiv);

    onCleanup(() => {
      resizeObserver.disconnect();
      // Detach from session
      sendRpc({ SessionDetach: {} }).catch(() => {});
      setPtyDataCallback(() => {});
      term?.dispose();
    });
  });

  return (
    <div class="flex-1 flex flex-col">
      <Show when={!store.currentSession()}>
        <div class="flex-1 flex items-center justify-center text-gray-500">
          <p>Select a session from the Sessions tab to attach.</p>
        </div>
      </Show>
      <Show when={store.currentSession()}>
        <div class="flex items-center justify-between px-4 py-2 bg-surface-1 border-b border-surface-3">
          <span class="text-sm text-gray-400">
            Terminal — {store.currentSession()?.slice(0, 8)}
            <Show when={attached()}>
              <span class="text-success ml-2">attached</span>
            </Show>
          </span>
          <button
            class="text-xs text-gray-500 hover:text-gray-300 px-2 py-1"
            onClick={() => {
              sendRpc({ SessionDetach: {} }).catch(() => {});
              store.setCurrentSession(null);
              store.setView('sessions');
            }}
          >
            Detach
          </button>
        </div>
        <div
          ref={termDiv}
          class="flex-1"
          style={{ padding: '4px' }}
        />
      </Show>
    </div>
  );
}
