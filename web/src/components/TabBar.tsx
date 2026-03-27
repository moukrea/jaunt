import { createSignal, For, Show } from 'solid-js';
import { store } from '../lib/store';
import type { Tab, Pane } from '../lib/store';
import { sendRpc } from '../lib/cairn';
import { useIsMobile } from '../lib/hooks';
import SessionPicker from './SessionPicker';

const selectArrowSvg = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 4 4-4' fill='none' stroke='%235a5955' stroke-width='1.2'/%3E%3C/svg%3E\")";
const selectStyle = {
  'background-image': selectArrowSvg,
  'background-repeat': 'no-repeat',
  'background-position': 'right 6px center',
  'padding-right': '18px',
};

export default function TabBar() {
  const isMobile = useIsMobile();
  const [showPicker, setShowPicker] = createSignal(false);
  const [editingTabId, setEditingTabId] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal('');
  const [dragIdx, setDragIdx] = createSignal<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = createSignal<number | null>(null);

  function handleAddSession(sessionId: string, sessionName?: string) {
    store.addTab(sessionId, sessionName);
    setShowPicker(false);
  }

  function startRename(tab: Tab, e?: Event) {
    e?.stopPropagation();
    setEditingTabId(tab.id);
    setEditValue(tab.label);
  }

  async function commitRename(tabId: string) {
    const val = editValue().trim();
    if (val) {
      store.renameTab(tabId, val);
      // Also rename at the host level
      const tab = store.tabs().find(t => t.id === tabId);
      if (tab) {
        const pane = store.findFocusedPane(tab);
        if (pane) {
          sendRpc({ SessionRename: { target: pane.sessionId, new_name: val } }).catch(() => {});
        }
      }
    }
    setEditingTabId(null);
  }

  function handleMiddleClick(e: MouseEvent, tabId: string) {
    if (e.button === 1) {
      e.preventDefault();
      store.closeTab(tabId);
    }
  }

  function handleDragStart(e: DragEvent, idx: number) {
    setDragIdx(idx);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    }
  }

  function handleDragOver(e: DragEvent, idx: number) {
    e.preventDefault();
    setDragOverIdx(idx);
  }

  function handleDrop(e: DragEvent, toIdx: number) {
    e.preventDefault();
    const fromIdx = dragIdx();
    if (fromIdx !== null && fromIdx !== toIdx) {
      store.reorderTabs(fromIdx, toIdx);
    }
    setDragIdx(null);
    setDragOverIdx(null);
  }

  function handleDragEnd() {
    setDragIdx(null);
    setDragOverIdx(null);
  }

  const hasTabs = () => store.tabs().length > 0;

  return (
    <div class="flex items-stretch bg-bg-1 shrink-0 relative" style="min-height: 36px">
      <Show
        when={!isMobile()}
        fallback={
          /* Mobile: tab + pane selectors on one row */
          <MobileTabRow hasTabs={hasTabs()} />
        }
      >
        {/* Desktop: tab list — scrollable, each tab is a precision strip */}
        <div
          class="flex-1 flex items-stretch overflow-x-auto min-w-0"
          style="scrollbar-width: none; -ms-overflow-style: none;"
        >
          <For each={store.tabs()}>
            {(tab, idx) => {
              const isActive = () => tab.id === store.activeTabId();
              const isEditing = () => editingTabId() === tab.id;
              const isDragOver = () => dragOverIdx() === idx();

              return (
                <div
                  class={`relative flex items-center gap-1.5 px-3.5 min-w-0 shrink-0 cursor-pointer select-none transition-all duration-150 ${
                    isActive()
                      ? 'bg-bg-0 text-text-0'
                      : 'text-text-3 hover:text-text-1 hover:bg-bg-0/40'
                  } ${isDragOver() ? 'ring-1 ring-inset ring-amber/40' : ''}`}
                  draggable={!isEditing()}
                  onDragStart={(e) => handleDragStart(e, idx())}
                  onDragOver={(e) => handleDragOver(e, idx())}
                  onDrop={(e) => handleDrop(e, idx())}
                  onDragEnd={handleDragEnd}
                  onClick={() => store.activateTab(tab.id)}
                  onMouseDown={(e) => handleMiddleClick(e, tab.id)}
                  onDblClick={() => startRename(tab)}
                >
                  {/* Active bottom edge — precision amber line */}
                  <Show when={isActive()}>
                    <div
                      class="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-amber"
                    />
                  </Show>

                  {/* Separator between inactive tabs */}
                  <Show when={!isActive() && idx() > 0}>
                    <div class="absolute left-0 top-2 bottom-2 w-px bg-bg-3/30" />
                  </Show>

                  {/* Tab label / rename input */}
                  <Show
                    when={isEditing()}
                    fallback={
                      <span
                        class={`text-[11px] font-mono truncate max-w-32 leading-none ${
                          isActive() ? 'font-500 text-text-0' : ''
                        }`}
                      >
                        {tab.label}
                      </span>
                    }
                  >
                    <input
                      type="text"
                      class="bg-bg-0 border border-amber/40 rounded px-1.5 py-0.5 text-[11px] font-mono text-text-0 outline-none w-28 focus:border-amber/70"
                      value={editValue()}
                      onInput={(e) => setEditValue(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(tab.id);
                        if (e.key === 'Escape') setEditingTabId(null);
                      }}
                      onBlur={() => commitRename(tab.id)}
                      autofocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Show>

                  {/* Close button — appears on hover, fades in */}
                  <button
                    class={`ml-0.5 w-4 h-4 flex items-center justify-center rounded-sm transition-all duration-150 border-none cursor-pointer shrink-0 bg-transparent ${
                      isActive()
                        ? 'text-text-3/50 hover:text-coral hover:bg-coral/10'
                        : 'text-transparent hover:text-coral hover:bg-coral/10'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      store.closeTab(tab.id);
                    }}
                    title="Close tab"
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                    </svg>
                  </button>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      {/* Add tab — the + affordance */}
      <div class="relative shrink-0 flex items-center border-l border-bg-3/20">
        <button
          data-testid="add-tab"
          class={`w-9 h-full flex items-center justify-center transition-all duration-150 border-none cursor-pointer ${
            showPicker()
              ? 'text-amber bg-bg-0'
              : 'text-text-3 hover:text-amber hover:bg-bg-0/40 bg-transparent'
          }`}
          onClick={() => setShowPicker(!showPicker())}
          title="Open session in new tab"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>

        {/* Session picker dropdown */}
        <Show when={showPicker()}>
          <div class="absolute top-full right-0 mt-1 z-50">
            <SessionPicker
              onSelect={handleAddSession}
              onClose={() => setShowPicker(false)}
            />
          </div>
        </Show>
      </div>

      {/* Bottom border for the whole bar */}
      <div class="absolute bottom-0 left-0 right-0 h-px bg-bg-3/40" />

      {/* Show hint when no tabs (desktop only) */}
      <Show when={!hasTabs() && !isMobile()}>
        <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span class="text-[11px] text-text-3/40 font-mono tracking-wider">NO OPEN TABS</span>
        </div>
      </Show>
    </div>
  );
}

/** Mobile: tab selector + pane selector on one compact row */
function MobileTabRow(props: { hasTabs: boolean }) {
  const activeTab = () => store.tabs().find(t => t.id === store.activeTabId());
  const activePanes = () => activeTab() ? store.collectPanes(activeTab()!.panes) : [];
  const hasManyPanes = () => activePanes().length > 1;
  const focusedPaneId = () => activeTab()?.focusedPaneId ?? activePanes()[0]?.id;

  function paneName(pane: Pane) {
    return pane.sessionName || pane.sessionId.slice(0, 8);
  }

  return (
    <div class="flex-1 flex items-center px-2 gap-1.5 min-w-0">
      <Show
        when={props.hasTabs}
        fallback={
          <span class="text-[11px] text-text-3/40 font-mono tracking-wider flex-1">NO OPEN TABS</span>
        }
      >
        {/* Tab selector */}
        <select
          data-testid="mobile-tab-select"
          class="bg-bg-0 border border-bg-3/50 rounded-md px-2 py-1 text-[11px] font-mono text-text-0 outline-none min-w-0 appearance-none"
          style={{ ...selectStyle, 'flex': hasManyPanes() ? '1' : '2' }}
          value={store.activeTabId() ?? ''}
          onChange={(e) => { if (e.currentTarget.value) store.activateTab(e.currentTarget.value); }}
        >
          <For each={store.tabs()}>
            {(tab) => <option value={tab.id}>{tab.label}</option>}
          </For>
        </select>

        {/* Pane selector — only when active tab has multiple panes */}
        <Show when={hasManyPanes()}>
          <select
            data-testid="mobile-pane-select"
            class="flex-1 bg-bg-0 border border-bg-3/50 rounded-md px-2 py-1 text-[11px] font-mono text-text-0 outline-none min-w-0 appearance-none"
            style={selectStyle}
            value={focusedPaneId()}
            onChange={(e) => store.focusPane(e.currentTarget.value)}
          >
            <For each={activePanes()}>
              {(pane, idx) => <option value={pane.id}>P{idx() + 1} {paneName(pane)}</option>}
            </For>
          </select>
        </Show>
      </Show>
    </div>
  );
}
