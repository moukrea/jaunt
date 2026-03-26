import { createSignal } from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import { get, set, del, keys } from 'idb-keyval';
import type { ConnectionProfile } from './profile';
import type { SessionInfo, DirEntry } from './protocol';

// --- App State ---

export type AppView = 'pairing' | 'sessions' | 'terminal' | 'files' | 'settings';

export interface HostConfig {
  peerId: string;
  hostName: string;
  cairnConfig: Partial<ConnectionProfile>;
  pairedAt: number;
  lastSeen: number;
}

// --- Tabs & Panes ---

export interface Pane {
  id: string;
  sessionId: string;
  sessionName?: string;
}

export type PaneLayout =
  | { type: 'single'; pane: Pane }
  | { type: 'hsplit'; left: PaneLayout; right: PaneLayout; ratio: number }
  | { type: 'vsplit'; top: PaneLayout; bottom: PaneLayout; ratio: number };

export interface Tab {
  id: string;
  label: string;
  panes: PaneLayout;
  focusedPaneId: string;
}

// Reactive signals for simple state
const [view, setView] = createSignal<AppView>('pairing');
const [connected, setConnected] = createSignal(false);
const [hostName, setHostName] = createSignal('');
const [peerId, setPeerId] = createSignal('');
const [sessions, setSessions] = createSignal<SessionInfo[]>([]);
const [currentSession, setCurrentSession] = createSignal<string | null>(null);
const [dirEntries, setDirEntries] = createSignal<DirEntry[]>([]);
const [currentPath, setCurrentPath] = createSignal('~');
const [showHidden, setShowHidden] = createSignal(false);
const [latency, setLatency] = createSignal(0);
const [tier, setTier] = createSignal('Tier 0');
const [error, setError] = createSignal<string | null>(null);
const [activeTabId, setActiveTabId] = createSignal<string | null>(null);

// Deep reactive store for tabs -- allows fine-grained updates
// that preserve object identity (critical for <For> stability)
const [tabStore, setTabStore] = createStore<{ tabs: Tab[] }>({ tabs: [] });

// --- Tab & Pane helpers ---

function generateId(): string {
  return crypto.randomUUID();
}

function createPaneObj(sessionId: string, sessionName?: string): Pane {
  return { id: generateId(), sessionId, sessionName };
}

function createTabObj(sessionId: string, sessionName?: string): Tab {
  const pane = createPaneObj(sessionId, sessionName);
  const label = sessionName || sessionId.slice(0, 8);
  return { id: generateId(), label, panes: { type: 'single', pane }, focusedPaneId: pane.id };
}

function tabs(): Tab[] {
  return tabStore.tabs;
}

function addTab(sessionId: string, sessionName?: string): Tab {
  const tab = createTabObj(sessionId, sessionName);
  setTabStore('tabs', (prev) => [...prev, tab]);
  setActiveTabId(tab.id);
  setCurrentSession(sessionId);
  setView('terminal');
  return tab;
}

function closeTab(tabId: string): void {
  const current = tabStore.tabs;
  const idx = current.findIndex((t) => t.id === tabId);
  if (idx === -1) return;

  setTabStore('tabs', (prev) => prev.filter((t) => t.id !== tabId));

  if (activeTabId() === tabId) {
    const remaining = tabStore.tabs;
    if (remaining.length > 0) {
      const newIdx = Math.min(idx, remaining.length - 1);
      setActiveTabId(remaining[newIdx].id);
      const focusedPane = findFocusedPane(remaining[newIdx]);
      setCurrentSession(focusedPane?.sessionId ?? null);
    } else {
      setActiveTabId(null);
      setCurrentSession(null);
      setView('sessions');
    }
  }
}

function activateTab(tabId: string): void {
  setActiveTabId(tabId);
  const tab = tabStore.tabs.find((t) => t.id === tabId);
  if (tab) {
    const pane = findFocusedPane(tab);
    setCurrentSession(pane?.sessionId ?? null);
  }
}

function renameTab(tabId: string, newLabel: string): void {
  const idx = tabStore.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  setTabStore('tabs', idx, 'label', newLabel);
}

function getActiveTab(): Tab | undefined {
  return tabStore.tabs.find((t) => t.id === activeTabId());
}

/** Find the focused pane in a tab */
function findFocusedPane(tab: Tab): Pane | undefined {
  return findPaneById(tab.panes, tab.focusedPaneId);
}

/** Recursively find a pane by id in a layout */
function findPaneById(layout: PaneLayout, paneId: string): Pane | undefined {
  if (layout.type === 'single') {
    return layout.pane.id === paneId ? layout.pane : undefined;
  }
  if (layout.type === 'hsplit') {
    return findPaneById(layout.left, paneId) ?? findPaneById(layout.right, paneId);
  }
  if (layout.type === 'vsplit') {
    return findPaneById(layout.top, paneId) ?? findPaneById(layout.bottom, paneId);
  }
  return undefined;
}

/** Collect all panes in a layout */
function collectPanes(layout: PaneLayout): Pane[] {
  if (layout.type === 'single') return [layout.pane];
  if (layout.type === 'hsplit') return [...collectPanes(layout.left), ...collectPanes(layout.right)];
  if (layout.type === 'vsplit') return [...collectPanes(layout.top), ...collectPanes(layout.bottom)];
  return [];
}

/** Focus a pane within the active tab */
function focusPane(paneId: string): void {
  const tabId = activeTabId();
  if (!tabId) return;
  const idx = tabStore.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  const pane = findPaneById(tabStore.tabs[idx].panes, paneId);
  if (!pane) return;
  setCurrentSession(pane.sessionId);
  setTabStore('tabs', idx, 'focusedPaneId', paneId);
}

/** Rename a pane's session (updates sessionName in the layout tree) */
function renamePaneSession(paneId: string, newName: string): void {
  for (let i = 0; i < tabStore.tabs.length; i++) {
    const pane = findPaneById(tabStore.tabs[i].panes, paneId);
    if (pane) {
      // Walk the layout to find and update the pane's sessionName.
      // We need to clone + replace the layout since the pane is nested.
      const rawPanes: PaneLayout = structuredClone(unwrap(tabStore.tabs[i].panes));
      function updateName(layout: PaneLayout): void {
        if (layout.type === 'single') {
          if (layout.pane.id === paneId) layout.pane.sessionName = newName;
          return;
        }
        if (layout.type === 'hsplit') { updateName(layout.left); updateName(layout.right); }
        if (layout.type === 'vsplit') { updateName(layout.top); updateName(layout.bottom); }
      }
      updateName(rawPanes);
      setTabStore('tabs', i, 'panes', rawPanes);
      break;
    }
  }
}

/** Split a pane within the active tab */
function splitPane(
  paneId: string,
  direction: 'horizontal' | 'vertical',
  sessionId: string,
  sessionName?: string
): void {
  const tabId = activeTabId();
  if (!tabId) return;
  const idx = tabStore.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  const newPane = createPaneObj(sessionId, sessionName);

  function splitLayout(layout: PaneLayout): PaneLayout {
    if (layout.type === 'single' && layout.pane.id === paneId) {
      if (direction === 'horizontal') {
        return { type: 'hsplit', left: { type: 'single', pane: layout.pane }, right: { type: 'single', pane: newPane }, ratio: 0.5 };
      } else {
        return { type: 'vsplit', top: { type: 'single', pane: layout.pane }, bottom: { type: 'single', pane: newPane }, ratio: 0.5 };
      }
    }
    if (layout.type === 'hsplit') {
      return { type: 'hsplit', left: splitLayout(layout.left), right: splitLayout(layout.right), ratio: layout.ratio };
    }
    if (layout.type === 'vsplit') {
      return { type: 'vsplit', top: splitLayout(layout.top), bottom: splitLayout(layout.bottom), ratio: layout.ratio };
    }
    return layout;
  }

  // unwrap() strips the store proxy so splitLayout works with plain objects.
  // We clone then assign directly (no reconcile!) so SolidJS creates a fresh
  // proxy tree -- critical for Switch/Match in PaneContainer to detect the
  // layout type change (e.g. single -> hsplit).
  const rawPanes: PaneLayout = structuredClone(unwrap(tabStore.tabs[idx].panes));
  const newLayout = splitLayout(rawPanes);

  setTabStore('tabs', idx, 'panes', newLayout);
  setTabStore('tabs', idx, 'focusedPaneId', newPane.id);
  setCurrentSession(sessionId);
}

/** Close a pane within the active tab; collapses the split */
function closePane(paneId: string): void {
  const tabId = activeTabId();
  if (!tabId) return;

  const tab = tabStore.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const allPanesBeforeRemove = collectPanes(tab.panes);
  if (allPanesBeforeRemove.length <= 1) {
    closeTab(tabId);
    return;
  }

  const idx = tabStore.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;

  function removeFromLayout(layout: PaneLayout): PaneLayout | null {
    if (layout.type === 'single') {
      return layout.pane.id === paneId ? null : layout;
    }
    if (layout.type === 'hsplit') {
      const left = removeFromLayout(layout.left);
      const right = removeFromLayout(layout.right);
      if (!left && !right) return null;
      if (!left) return right;
      if (!right) return left;
      return { type: 'hsplit', left, right, ratio: layout.ratio };
    }
    if (layout.type === 'vsplit') {
      const top = removeFromLayout(layout.top);
      const bottom = removeFromLayout(layout.bottom);
      if (!top && !bottom) return null;
      if (!top) return bottom;
      if (!bottom) return top;
      return { type: 'vsplit', top, bottom, ratio: layout.ratio };
    }
    return layout;
  }

  // unwrap + structuredClone to work with plain objects, then replace directly.
  // No reconcile -- direct assignment creates a fresh proxy tree so Switch/Match
  // in PaneContainer detects the layout type change.
  const rawPanes: PaneLayout = structuredClone(unwrap(tabStore.tabs[idx].panes));
  const newLayout = removeFromLayout(rawPanes);
  if (!newLayout) return;

  const remaining = collectPanes(newLayout);
  const currentFocused = tabStore.tabs[idx].focusedPaneId;
  const focusedStillExists = remaining.some((p) => p.id === currentFocused);
  const newFocusedId = focusedStillExists ? currentFocused : (remaining[0]?.id ?? '');
  const fp = remaining.find((p) => p.id === newFocusedId);

  setTabStore('tabs', idx, 'panes', newLayout);
  setTabStore('tabs', idx, 'focusedPaneId', newFocusedId);
  if (fp) setCurrentSession(fp.sessionId);
}

/** Update the split ratio for a pane layout.
 *  Uses produce for fine-grained mutation -- only the ratio property
 *  changes, so PaneContainer's style bindings update without
 *  recreating the terminal instances.
 */
function updateSplitRatio(tabId: string, childPaneId: string, newRatio: number): void {
  const idx = tabStore.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;

  function mutateRatio(layout: PaneLayout): boolean {
    if (layout.type === 'single') return false;
    if (layout.type === 'hsplit') {
      const leftPanes = collectPanes(layout.left);
      const rightPanes = collectPanes(layout.right);
      if (leftPanes.some((p) => p.id === childPaneId) || rightPanes.some((p) => p.id === childPaneId)) {
        (layout as any).ratio = newRatio;
        return true;
      }
      return mutateRatio(layout.left) || mutateRatio(layout.right);
    }
    if (layout.type === 'vsplit') {
      const topPanes = collectPanes(layout.top);
      const bottomPanes = collectPanes(layout.bottom);
      if (topPanes.some((p) => p.id === childPaneId) || bottomPanes.some((p) => p.id === childPaneId)) {
        (layout as any).ratio = newRatio;
        return true;
      }
      return mutateRatio(layout.top) || mutateRatio(layout.bottom);
    }
    return false;
  }

  setTabStore('tabs', idx, produce((t: Tab) => {
    mutateRatio(t.panes);
  }));
}

/** Reorder tabs by moving a tab from one index to another */
function reorderTabs(fromIndex: number, toIndex: number): void {
  setTabStore('tabs', produce((arr: Tab[]) => {
    const [moved] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, moved);
  }));
}

export const store = {
  // Getters
  view, connected, hostName, peerId, sessions,
  currentSession, dirEntries, currentPath, showHidden,
  latency, tier, error, tabs, activeTabId,
  // Setters
  setView, setConnected, setHostName, setPeerId, setSessions,
  setCurrentSession, setDirEntries, setCurrentPath, setShowHidden,
  setLatency, setTier, setError, setActiveTabId,
  // Tab & Pane operations
  addTab, closeTab, activateTab, renameTab, getActiveTab,
  findFocusedPane, findPaneById, collectPanes,
  focusPane, renamePaneSession, splitPane, closePane,
  updateSplitRatio, reorderTabs,
};

// --- IndexedDB persistence ---

export async function saveHost(config: HostConfig): Promise<void> {
  await set(`host:${config.peerId}`, config);
}

export async function loadHost(peerId: string): Promise<HostConfig | undefined> {
  return await get(`host:${peerId}`);
}

export async function listHosts(): Promise<HostConfig[]> {
  const allKeys = await keys();
  const hostKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith('host:'));
  const hosts: HostConfig[] = [];
  for (const key of hostKeys) {
    const host = await get(key);
    if (host) hosts.push(host as HostConfig);
  }
  return hosts;
}

export async function removeHost(peerId: string): Promise<void> {
  await del(`host:${peerId}`);
}

// Settings persistence
export async function saveSettings(settings: Record<string, string>): Promise<void> {
  await set('settings', settings);
}

export async function loadSettings(): Promise<Record<string, string>> {
  return (await get('settings')) || {};
}
