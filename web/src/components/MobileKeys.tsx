import { createSignal, onMount, onCleanup, For, Show } from 'solid-js';
import { sendPtyInput } from '../lib/cairn';

interface MobileKeysProps {
  terminalContainerRef?: HTMLDivElement;
}

export default function MobileKeys(props: MobileKeysProps) {
  const [ctrlActive, setCtrlActive] = createSignal(false);
  const [altActive, setAltActive] = createSignal(false);
  const [shiftActive, setShiftActive] = createSignal(false);
  const [kbVisible, setKbVisible] = createSignal(false);
  const [kbHeight, setKbHeight] = createSignal(0);
  let hiddenInput: HTMLInputElement | undefined;

  const encoder = new TextEncoder();

  // ANSI escape sequences for arrow keys and nav keys
  const ANSI: Record<string, string> = {
    UP: '\x1b[A',
    DOWN: '\x1b[B',
    RIGHT: '\x1b[C',
    LEFT: '\x1b[D',
    PGUP: '\x1b[5~',
    PGDN: '\x1b[6~',
    HOME: '\x1b[H',
    END: '\x1b[F',
  };

  onMount(() => {
    if (window.visualViewport) {
      const handler = () => {
        const height = window.innerHeight - window.visualViewport!.height;
        setKbHeight(Math.max(0, height));
      };
      window.visualViewport.addEventListener('resize', handler);
      onCleanup(() => window.visualViewport?.removeEventListener('resize', handler));
    }
  });

  function sendBytes(data: string) {
    sendPtyInput(encoder.encode(data));
  }

  function sendWithModifiers(data: string) {
    let modified = data;

    if (ctrlActive()) {
      // Ctrl+letter: send the control character (ASCII 1-26 for a-z)
      if (data.length === 1) {
        const code = data.toLowerCase().charCodeAt(0);
        if (code >= 97 && code <= 122) {
          modified = String.fromCharCode(code - 96);
        }
      }
      setCtrlActive(false);
    }

    if (altActive()) {
      modified = '\x1b' + modified;
      setAltActive(false);
    }

    if (shiftActive()) {
      modified = modified.toUpperCase();
      setShiftActive(false);
    }

    sendBytes(modified);
  }

  function handleSpecialKey(key: string) {
    switch (key) {
      case 'ESC':
        sendBytes('\x1b');
        break;
      case 'TAB':
        sendBytes('\t');
        break;
      case '|':
        sendWithModifiers('|');
        break;
      case '~':
        sendWithModifiers('~');
        break;
      case 'CTRL':
        setCtrlActive(!ctrlActive());
        return;
      case 'ALT':
        setAltActive(!altActive());
        return;
      case 'SHIFT':
        setShiftActive(!shiftActive());
        return;
      default:
        if (ANSI[key]) {
          sendBytes(ANSI[key]);
        }
        break;
    }
  }

  function toggleKeyboard() {
    if (kbVisible()) {
      hiddenInput?.blur();
      setKbVisible(false);
    } else {
      hiddenInput?.focus();
      setKbVisible(true);
    }
  }

  function handleHiddenInput(e: InputEvent) {
    const target = e.target as HTMLInputElement;
    const val = target.value;
    if (val) {
      sendWithModifiers(val);
      target.value = '';
    }
  }

  const row1 = ['ESC', 'TAB', 'CTRL', 'ALT', 'SHIFT', '|', '~'];
  const row2 = [
    { label: '\u2191', key: 'UP' },
    { label: '\u2193', key: 'DOWN' },
    { label: '\u2190', key: 'LEFT' },
    { label: '\u2192', key: 'RIGHT' },
    { label: 'PGUP', key: 'PGUP' },
    { label: 'PGDN', key: 'PGDN' },
    { label: 'HOME', key: 'HOME' },
    { label: 'END', key: 'END' },
  ];

  function isModifierActive(key: string): boolean {
    if (key === 'CTRL') return ctrlActive();
    if (key === 'ALT') return altActive();
    if (key === 'SHIFT') return shiftActive();
    return false;
  }

  function isModifier(key: string): boolean {
    return key === 'CTRL' || key === 'ALT' || key === 'SHIFT';
  }

  return (
    <div
      class="bg-bg-1 shrink-0 border-t border-bg-3/40"
      data-testid="mobile-keys"
    >
      {/* Hidden input for soft keyboard */}
      <input
        ref={hiddenInput}
        type="text"
        class="absolute opacity-0 pointer-events-none"
        style={{ width: '1px', height: '1px', position: 'fixed', top: '-100px' }}
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck={false}
        onInput={(e) => handleHiddenInput(e as InputEvent)}
        onBlur={() => setKbVisible(false)}
      />

      {/* Row 1: Special keys + modifiers */}
      <div class="flex items-center gap-1 px-2 pt-1.5 pb-0.5">
        <For each={row1}>
          {(key) => (
            <button
              class={`flex-1 h-7 flex items-center justify-center rounded-md text-[10px] font-mono font-500 border transition-all duration-100 cursor-pointer ${
                isModifier(key) && isModifierActive(key)
                  ? 'bg-bg-2 border-amber/60 text-amber'
                  : 'bg-bg-2 border-bg-3/60 text-text-2 active:bg-bg-3 active:text-text-0'
              }`}
              onClick={() => handleSpecialKey(key)}
            >
              {key}
            </button>
          )}
        </For>
      </div>

      {/* Row 2: Arrow keys + nav keys + keyboard toggle */}
      <div class="flex items-center gap-1 px-2 pt-0.5 pb-1.5">
        <For each={row2}>
          {(item) => (
            <button
              class="flex-1 h-7 flex items-center justify-center bg-bg-2 border border-bg-3/60 rounded-md text-[10px] font-mono font-500 text-text-2 active:bg-bg-3 active:text-text-0 transition-all duration-100 cursor-pointer"
              onClick={() => handleSpecialKey(item.key)}
            >
              {item.label}
            </button>
          )}
        </For>

        {/* Keyboard toggle */}
        <button
          class={`w-8 h-7 flex items-center justify-center rounded-md border transition-all duration-100 cursor-pointer ${
            kbVisible()
              ? 'bg-bg-2 border-amber/60 text-amber'
              : 'bg-bg-2 border-bg-3/60 text-text-2 active:bg-bg-3 active:text-text-0'
          }`}
          onClick={toggleKeyboard}
          title="Toggle keyboard"
        >
          <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
            <rect x="0.5" y="0.5" width="13" height="10" rx="1.5" stroke="currentColor" stroke-width="1" />
            <rect x="2.5" y="2.5" width="1.5" height="1.5" rx="0.3" fill="currentColor" />
            <rect x="5" y="2.5" width="1.5" height="1.5" rx="0.3" fill="currentColor" />
            <rect x="7.5" y="2.5" width="1.5" height="1.5" rx="0.3" fill="currentColor" />
            <rect x="10" y="2.5" width="1.5" height="1.5" rx="0.3" fill="currentColor" />
            <rect x="2.5" y="5" width="1.5" height="1.5" rx="0.3" fill="currentColor" />
            <rect x="5" y="5" width="1.5" height="1.5" rx="0.3" fill="currentColor" />
            <rect x="7.5" y="5" width="1.5" height="1.5" rx="0.3" fill="currentColor" />
            <rect x="10" y="5" width="1.5" height="1.5" rx="0.3" fill="currentColor" />
            <rect x="4" y="7.5" width="6" height="1.5" rx="0.3" fill="currentColor" />
          </svg>
        </button>
      </div>

      {/* Spacer that pushes terminal up when keyboard is visible */}
      <Show when={kbHeight() > 0}>
        <div style={{ height: `${kbHeight()}px` }} />
      </Show>
    </div>
  );
}
