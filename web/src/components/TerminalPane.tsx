import { onMount, onCleanup, createSignal, createEffect, createMemo } from 'solid-js';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { sendRpc, sendPtyInput, sendResize, setPtyDataCallback } from '../lib/cairn';
import { store } from '../lib/store';
import type { Pane } from '../lib/store';

interface TerminalPaneProps {
  pane: Pane;
  tabId: string;
}

export default function TerminalPane(props: TerminalPaneProps) {
  let termDiv: HTMLDivElement | undefined;
  let term: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  const [attached, setAttached] = createSignal(false);

  // Compute focused state reactively from the store
  const isFocused = createMemo(() => {
    const tab = store.tabs().find((t) => t.id === props.tabId);
    return tab?.focusedPaneId === props.pane.id && store.activeTabId() === props.tabId;
  });

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

    try {
      term.loadAddon(new WebglAddon());
    } catch {
      // WebGL not available
    }

    fitAddon.fit();

    // Input handling -- only send if this pane is focused
    term.onData((data) => {
      if (isFocused()) {
        sendPtyInput(new TextEncoder().encode(data));
      }
    });

    term.onBinary((data) => {
      if (isFocused()) {
        const bytes = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
        sendPtyInput(bytes);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (isFocused()) {
        sendResize(cols, rows);
      }
    });

    // Attach to session if this pane is focused
    if (isFocused()) {
      await attachToSession();
    }

    const resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit();
    });
    resizeObserver.observe(termDiv);

    onCleanup(() => {
      resizeObserver.disconnect();
      // Only send detach if this pane is currently focused (i.e. it owns
      // the protocol-level attachment). Detaching a non-focused pane would
      // accidentally tear down the focused pane's session attachment.
      if (attached() && isFocused()) {
        sendRpc({ SessionDetach: {} }).catch(() => {});
      }
      setAttached(false);
      setPtyDataCallback(() => {});
      term?.dispose();
    });
  });

  // React to focus changes: attach when gaining focus, refit terminal
  createEffect(async () => {
    const focused = isFocused();
    if (!term) return;

    if (focused) {
      // Refit in case the container was hidden (display:none) and is now visible
      requestAnimationFrame(() => fitAddon?.fit());
      await attachToSession();
    }
    // When losing focus, we do NOT detach -- the next focused pane will
    // issue its own attach which implicitly detaches the previous one
    // at the protocol level. We just stop routing PTY data to this terminal.
  });

  async function attachToSession() {
    if (!term) return;
    try {
      // Register PTY data callback for this pane
      setPtyDataCallback((data: Uint8Array) => {
        term?.write(data);
      });

      const resp = await sendRpc({ SessionAttach: { target: props.pane.sessionId } });
      if ('Ok' in resp) {
        const data = resp.Ok;
        if ('Output' in (data as any)) {
          term.write((data as any).Output);
        }
        setAttached(true);
        if (term) {
          sendResize(term.cols, term.rows);
        }
      }
    } catch (e: any) {
      term?.write(`\r\n\x1b[38;2;224;108;90m Connection failed: ${e.message}\x1b[0m\r\n`);
    }
  }

  function handleClick() {
    if (!isFocused()) {
      store.focusPane(props.pane.id);
    }
  }

  const displayName = () => props.pane.sessionName || props.pane.sessionId.slice(0, 12);

  return (
    <div
      class="flex-1 flex flex-col min-h-0 min-w-0 group/pane"
      onClick={handleClick}
    >
      {/* Pane header -- compact, stays out of the way */}
      <div class={`flex items-center justify-between px-2.5 h-7 shrink-0 border-b transition-colors duration-150 ${
        isFocused()
          ? 'bg-bg-1 border-amber/30'
          : 'bg-bg-1/80 border-bg-3/30'
      }`}>
        <div class="flex items-center gap-1.5 text-[11px] min-w-0">
          <div class={`w-1.5 h-1.5 rounded-full shrink-0 ${attached() ? 'bg-sage pulse' : 'bg-text-3'}`} />
          <span class={`font-mono truncate ${isFocused() ? 'text-text-1' : 'text-text-3'}`}>
            {displayName()}
          </span>
        </div>
        <div class="flex items-center gap-0.5">
          {/* Split left-right */}
          <button
            class="text-text-3/60 hover:text-amber bg-transparent border-none cursor-pointer p-0.5 rounded hover:bg-bg-2 transition-colors opacity-0 group-hover/pane:opacity-100"
            on:click={(e) => {
              e.stopPropagation();
              const event = new CustomEvent('pane-split', {
                bubbles: true,
                detail: { paneId: props.pane.id, direction: 'horizontal' },
              });
              (e.currentTarget as HTMLElement).dispatchEvent(event);
            }}
            title="Split left/right"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="4" height="10" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="7" y="1" width="4" height="10" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>
          </button>
          {/* Split top-bottom */}
          <button
            class="text-text-3/60 hover:text-amber bg-transparent border-none cursor-pointer p-0.5 rounded hover:bg-bg-2 transition-colors opacity-0 group-hover/pane:opacity-100"
            on:click={(e) => {
              e.stopPropagation();
              const event = new CustomEvent('pane-split', {
                bubbles: true,
                detail: { paneId: props.pane.id, direction: 'vertical' },
              });
              (e.currentTarget as HTMLElement).dispatchEvent(event);
            }}
            title="Split top/bottom"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="1" y="7" width="10" height="4" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>
          </button>
          {/* Close pane */}
          <button
            class="text-text-3/40 hover:text-coral bg-transparent border-none cursor-pointer p-0.5 rounded hover:bg-coral/10 transition-colors opacity-0 group-hover/pane:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              store.closePane(props.pane.id);
            }}
            title="Close pane"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>

      {/* Terminal surface */}
      <div
        ref={termDiv}
        class="flex-1 min-h-0 min-w-0"
        style={{ padding: '4px 4px 2px 6px' }}
      />
    </div>
  );
}
