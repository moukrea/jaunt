import { Show, For, createSignal, onMount, onCleanup } from 'solid-js';
import { store } from '../lib/store';
import TabBar from './TabBar';
import PaneContainer from './PaneContainer';
import SessionPicker from './SessionPicker';

export default function TerminalWorkspace() {
  const [showSplitPicker, setShowSplitPicker] = createSignal(false);
  const [splitRequest, setSplitRequest] = createSignal<{
    paneId: string;
    direction: 'horizontal' | 'vertical';
  } | null>(null);
  let workspaceRef: HTMLDivElement | undefined;

  // Listen for pane-split custom events from TerminalPane
  onMount(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.paneId && detail?.direction) {
        setSplitRequest({ paneId: detail.paneId, direction: detail.direction });
        setShowSplitPicker(true);
      }
    };
    workspaceRef?.addEventListener('pane-split', handler);
    onCleanup(() => workspaceRef?.removeEventListener('pane-split', handler));
  });

  function handleSplitSelect(sessionId: string, sessionName?: string) {
    const req = splitRequest();
    if (req) {
      store.splitPane(req.paneId, req.direction, sessionId, sessionName);
    }
    setShowSplitPicker(false);
    setSplitRequest(null);
  }

  const hasTabs = () => store.tabs().length > 0;

  return (
    <div ref={workspaceRef} class="flex-1 flex flex-col min-h-0 relative">
      {/* Tab bar -- always visible when in terminal view */}
      <TabBar />

      {/* Tab content area */}
      <Show
        when={hasTabs()}
        fallback={
          <div class="flex-1 flex flex-col items-center justify-center text-center px-6 view-enter">
            <div class="w-14 h-14 rounded-2xl bg-bg-2 flex items-center justify-center mb-5">
              <span class="text-2xl text-amber/40">_</span>
            </div>
            <p class="text-sm text-text-2 mb-1">No tabs open</p>
            <p class="text-xs text-text-3 mb-5">Open a session from the tab bar or session list</p>
            <button
              class="btn-ghost text-sm"
              onClick={() => store.setView('sessions')}
            >
              View sessions
            </button>
          </div>
        }
      >
        {/* Render all tabs, show only the active one.
            Using For keyed by tab.id ensures each tab's DOM tree persists
            when switching between tabs, preserving xterm instances. */}
        <For each={store.tabs()}>
          {(tab) => (
            <div
              class="flex-1 flex min-h-0 min-w-0"
              style={{ display: store.activeTabId() === tab.id ? 'flex' : 'none' }}
            >
              <PaneContainer layout={tab.panes} tabId={tab.id} />
            </div>
          )}
        </For>
      </Show>

      {/* Split session picker overlay */}
      <Show when={showSplitPicker()}>
        <div class="absolute inset-0 z-40 flex items-center justify-center bg-bg-0/60 backdrop-blur-sm">
          <SessionPicker
            onSelect={handleSplitSelect}
            onClose={() => {
              setShowSplitPicker(false);
              setSplitRequest(null);
            }}
          />
        </div>
      </Show>
    </div>
  );
}
