import { createSignal, For, Show } from 'solid-js';
import { store } from '../lib/store';
import type { Tab } from '../lib/store';
import SessionPicker from './SessionPicker';

export default function TabBar() {
  const [showPicker, setShowPicker] = createSignal(false);
  const [editingTabId, setEditingTabId] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal('');
  const [dragIdx, setDragIdx] = createSignal<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = createSignal<number | null>(null);

  function handleAddSession(sessionId: string, sessionName?: string) {
    store.addTab(sessionId, sessionName);
    setShowPicker(false);
  }

  function startRename(tab: Tab) {
    setEditingTabId(tab.id);
    setEditValue(tab.label);
  }

  function commitRename(tabId: string) {
    const val = editValue().trim();
    if (val) {
      store.renameTab(tabId, val);
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

  return (
    <div class="flex items-stretch bg-bg-1 border-b border-bg-3/40 shrink-0 relative h-9">
      {/* Tab list — scrollable */}
      <div class="flex-1 flex items-stretch overflow-x-auto min-w-0" style="scrollbar-width: none; -ms-overflow-style: none;">
        <For each={store.tabs()}>
          {(tab, idx) => {
            const isActive = () => tab.id === store.activeTabId();
            const isEditing = () => editingTabId() === tab.id;
            const isDragOver = () => dragOverIdx() === idx();

            return (
              <div
                class={`flex items-center gap-1 px-3 min-w-0 shrink-0 cursor-pointer select-none transition-all duration-100 border-r border-bg-3/20 ${
                  isActive()
                    ? 'bg-bg-0 text-text-0'
                    : 'text-text-3 hover:text-text-2 hover:bg-bg-2/50'
                } ${isDragOver() ? 'border-l-2 border-l-amber' : ''}`}
                draggable={!isEditing()}
                onDragStart={(e) => handleDragStart(e, idx())}
                onDragOver={(e) => handleDragOver(e, idx())}
                onDrop={(e) => handleDrop(e, idx())}
                onDragEnd={handleDragEnd}
                onClick={() => store.activateTab(tab.id)}
                onMouseDown={(e) => handleMiddleClick(e, tab.id)}
                onDblClick={() => startRename(tab)}
              >
                {/* Active indicator */}
                <Show when={isActive()}>
                  <div class="w-1 h-1 rounded-full bg-amber shrink-0" />
                </Show>

                {/* Tab label / rename input */}
                <Show
                  when={isEditing()}
                  fallback={
                    <span class={`text-xs truncate max-w-28 ${isActive() ? 'font-500' : ''}`}>
                      {tab.label}
                    </span>
                  }
                >
                  <input
                    type="text"
                    class="bg-bg-0 border border-amber/50 rounded px-1.5 py-0.5 text-xs text-text-0 outline-none w-24"
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

                {/* Close button */}
                <button
                  class={`ml-1 w-4 h-4 flex items-center justify-center rounded transition-all border-none cursor-pointer shrink-0 bg-transparent ${
                    isActive()
                      ? 'text-text-3/60 hover:text-coral hover:bg-coral/10'
                      : 'text-text-3/30 hover:text-coral hover:bg-coral/10'
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    store.closeTab(tab.id);
                  }}
                  title="Close tab"
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                </button>
              </div>
            );
          }}
        </For>
      </div>

      {/* Add tab button */}
      <div class="relative shrink-0 flex items-center">
        <button
          class="w-8 h-full flex items-center justify-center text-text-3 hover:text-amber hover:bg-bg-2 transition-colors border-none bg-transparent cursor-pointer"
          onClick={() => setShowPicker(!showPicker())}
          title="Open session in new tab"
        >
          <span class="text-sm font-500">+</span>
        </button>

        {/* Session picker dropdown */}
        <Show when={showPicker()}>
          <div class="absolute top-full right-0 mt-1">
            <SessionPicker
              onSelect={handleAddSession}
              onClose={() => setShowPicker(false)}
            />
          </div>
        </Show>
      </div>
    </div>
  );
}
