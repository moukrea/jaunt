import { createSignal, onMount, For, Show } from 'solid-js';
import { sendRpc } from '../lib/cairn';
import { store } from '../lib/store';
import type { SessionInfo, RpcResponse, RpcData } from '../lib/protocol';

export default function SessionList() {
  const [loading, setLoading] = createSignal(true);
  const [newName, setNewName] = createSignal('');
  const [showNew, setShowNew] = createSignal(false);

  onMount(() => refreshSessions());

  async function refreshSessions() {
    setLoading(true);
    try {
      const resp = await sendRpc({ SessionList: {} });
      if ('Ok' in resp) {
        const data = resp.Ok;
        if ('SessionList' in (data as any)) {
          store.setSessions((data as any).SessionList);
        }
      }
    } catch (e: any) {
      store.setError(e.message);
    }
    setLoading(false);
  }

  async function createSession() {
    const name = newName().trim() || undefined;
    try {
      await sendRpc({ SessionCreate: { name, shell: undefined, cwd: undefined } });
      setShowNew(false);
      setNewName('');
      await refreshSessions();
    } catch (e: any) {
      store.setError(e.message);
    }
  }

  async function killSession(id: string) {
    try {
      await sendRpc({ SessionKill: { target: id } });
      await refreshSessions();
    } catch (e: any) {
      store.setError(e.message);
    }
  }

  function attachSession(id: string) {
    store.setCurrentSession(id);
    store.setView('terminal');
  }

  return (
    <div class="flex-1 p-4 max-w-3xl mx-auto w-full">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">
          Sessions
          <span class="text-gray-500 text-sm ml-2">on {store.hostName()}</span>
        </h2>
        <div class="flex gap-2">
          <button
            class="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 rounded-lg text-sm transition-colors"
            onClick={refreshSessions}
          >
            Refresh
          </button>
          <button
            class="px-3 py-1.5 bg-accent hover:bg-accent/80 rounded-lg text-sm font-medium transition-colors"
            onClick={() => setShowNew(!showNew())}
          >
            + New
          </button>
        </div>
      </div>

      {/* New session form */}
      <Show when={showNew()}>
        <div class="bg-surface-1 rounded-lg p-4 mb-4 flex gap-2">
          <input
            type="text"
            placeholder="Session name (optional)"
            class="flex-1 bg-surface-2 border border-surface-3 rounded px-3 py-2 text-sm focus:border-accent focus:outline-none"
            value={newName()}
            onInput={(e) => setNewName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && createSession()}
          />
          <button
            class="px-4 py-2 bg-accent rounded text-sm font-medium"
            onClick={createSession}
          >
            Create
          </button>
        </div>
      </Show>

      {/* Loading */}
      <Show when={loading()}>
        <div class="text-center text-gray-500 py-8">Loading sessions...</div>
      </Show>

      {/* Empty state */}
      <Show when={!loading() && store.sessions().length === 0}>
        <div class="text-center text-gray-500 py-8">
          <p class="mb-2">No sessions running.</p>
          <button
            class="px-4 py-2 bg-accent hover:bg-accent/80 rounded-lg text-sm font-medium text-white transition-colors"
            onClick={() => { setShowNew(true); }}
          >
            Create one
          </button>
        </div>
      </Show>

      {/* Session list */}
      <div class="space-y-2">
        <For each={store.sessions()}>
          {(session) => (
            <div
              class="bg-surface-1 rounded-lg p-4 flex items-center gap-4 hover:bg-surface-2 transition-colors cursor-pointer group"
              onClick={() => attachSession(session.id)}
            >
              {/* Status indicator */}
              <div class={`w-2 h-2 rounded-full ${
                session.state === 'running' ? 'bg-success' : 'bg-gray-500'
              }`} />

              {/* Info */}
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium">
                    {session.name || session.id.slice(0, 8)}
                  </span>
                  <span class="text-gray-500 text-xs font-mono">
                    {session.shell.split('/').pop()}
                  </span>
                </div>
                <div class="text-sm text-gray-400 truncate">
                  {session.cwd.replace(/^\/home\/[^/]+/, '~')}
                  {session.fg_process && session.fg_process !== 'idle' && (
                    <span class="text-accent ml-2">{session.fg_process}</span>
                  )}
                </div>
              </div>

              {/* Attached count */}
              <Show when={session.attached > 0}>
                <span class="text-xs text-gray-500 bg-surface-3 px-2 py-1 rounded">
                  {session.attached} attached
                </span>
              </Show>

              {/* Kill button */}
              <button
                class="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-danger hover:bg-danger/10 rounded transition-all"
                onClick={(e) => { e.stopPropagation(); killSession(session.id); }}
              >
                Kill
              </button>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
