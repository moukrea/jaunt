import { Show, For, createSignal } from 'solid-js';
import { store } from '../lib/store';
import { useIsMobile } from '../lib/hooks';
import TabBar from './TabBar';
import PaneContainer from './PaneContainer';
import SessionPicker from './SessionPicker';
import MobileKeys from './MobileKeys';

export default function TerminalWorkspace() {
  const isMobile = useIsMobile();
  const [showSplitPicker, setShowSplitPicker] = createSignal(false);
  const [splitRequest, setSplitRequest] = createSignal<{
    paneId: string;
    direction: 'horizontal' | 'vertical';
  } | null>(null);

  function handleSplit(paneId: string, direction: 'horizontal' | 'vertical') {
    setSplitRequest({ paneId, direction });
    setShowSplitPicker(true);
  }

  function handleSplitSelect(sessionId: string, sessionName?: string) {
    const req = splitRequest();
    if (req) store.splitPane(req.paneId, req.direction, sessionId, sessionName);
    setShowSplitPicker(false);
    setSplitRequest(null);
  }

  const hasTabs = () => store.tabs().length > 0;

  return (
    <div class="flex-1 flex flex-col min-h-0 relative">
      <TabBar />

      <Show
        when={hasTabs()}
        fallback={
          <div class="flex-1 flex flex-col items-center justify-center text-center px-6 view-enter">
            {/* Empty state — atmospheric, not generic */}
            <div class="relative mb-8">
              <div
                class="w-20 h-20 rounded-2xl bg-bg-2/80 flex items-center justify-center"
              >
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" class="text-amber/30">
                  <rect x="3" y="6" width="22" height="16" rx="2" stroke="currentColor" stroke-width="1.5" />
                  <path d="M8 13l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  <path d="M14 19h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </div>
              {/* Subtle decorative line */}
              <div class="absolute -bottom-3 left-1/2 -translate-x-1/2 w-8 h-px bg-amber/15 rounded-full" />
            </div>
            <p class="text-sm font-500 text-text-2 mb-1.5">No open terminals</p>
            <p class="text-[11px] text-text-3/60 mb-6 max-w-48 leading-relaxed">
              Open a session from the <span class="text-text-2">+</span> button above, or browse sessions below
            </p>
            <button
              class="btn-ghost text-xs font-mono tracking-wide"
              onClick={() => store.setView('sessions')}
            >
              SESSIONS
            </button>
          </div>
        }
      >
        <For each={store.tabs()}>
          {(tab) => (
            <div
              class="flex-1 flex min-h-0 min-w-0"
              style={{ display: store.activeTabId() === tab.id ? 'flex' : 'none' }}
            >
              <PaneContainer layout={tab.panes} tabId={tab.id} onSplit={handleSplit} />
            </div>
          )}
        </For>
      </Show>

      {/* Mobile special keys bar */}
      <Show when={isMobile() && hasTabs()}>
        <MobileKeys />
      </Show>

      {/* Split session picker — centered overlay */}
      <Show when={showSplitPicker()}>
        <div
          class="absolute inset-0 z-40 flex items-center justify-center"
          style="background: radial-gradient(ellipse at center, #0c0c0ea0, #0c0c0ed0); backdrop-filter: blur(2px)"
        >
          <SessionPicker
            onSelect={handleSplitSelect}
            onClose={() => { setShowSplitPicker(false); setSplitRequest(null); }}
          />
        </div>
      </Show>
    </div>
  );
}
