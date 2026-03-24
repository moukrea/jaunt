import { createSignal } from 'solid-js';
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

// Reactive signals
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

export const store = {
  // Getters
  view, connected, hostName, peerId, sessions,
  currentSession, dirEntries, currentPath, showHidden,
  latency, tier, error,
  // Setters
  setView, setConnected, setHostName, setPeerId, setSessions,
  setCurrentSession, setDirEntries, setCurrentPath, setShowHidden,
  setLatency, setTier, setError,
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
