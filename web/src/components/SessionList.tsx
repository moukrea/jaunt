import { createSignal, onMount, For, Show } from 'solid-js';
import { sendRpc } from '../lib/cairn';
import { store } from '../lib/store';

export default function SessionList() {
  const [loading, setLoading] = createSignal(true);
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal('');

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
      setCreating(false);
      setNewName('');
      await refreshSessions();
    } catch (e: any) {
      store.setError(e.message);
    }
  }

  async function killSession(id: string, e: Event) {
    e.stopPropagation();
    try {
      await sendRpc({ SessionKill: { target: id } });
      await refreshSessions();
    } catch (e: any) {
      store.setError((e as Error).message);
    }
  }

  function attachSession(id: string) {
    store.setCurrentSession(id);
    store.setView('terminal');
  }

  return (
    <div class="flex-1 flex flex-col px-4 pt-4 pb-2 max-w-2xl mx-auto w-full">
      {/* Header */}
      <div class="flex items-center justify-between mb-5">
        <div>
          <h2 class="text-lg font-600 text-text-0 leading-none mb-1">Sessions</h2>
          <p class="text-xs text-text-3">{store.sessions().length} active</p>
        </div>
        <div class="flex items-center gap-2">
          <button class="btn-ghost text-xs" onClick={refreshSessions}>
            Refresh
          </button>
          <button class="btn-primary text-xs py-2" onClick={() => setCreating(!creating())}>
            New session
          </button>
        </div>
      </div>

      {/* Inline create */}
      <Show when={creating()}>
        <div class="surface-raised p-3 mb-4 flex gap-2 items-center" style="animation: viewIn 0.2s ease-out">
          <input
            type="text"
            class="input-field flex-1"
            placeholder="Name (optional)"
            value={newName()}
            onInput={(e) => setNewName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && createSession()}
            autofocus
          />
          <button class="btn-primary text-xs whitespace-nowrap" onClick={createSession}>
            Create
          </button>
          <button class="btn-ghost text-xs" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      </Show>

      {/* Loading skeleton */}
      <Show when={loading()}>
        <div class="space-y-2">
          <div class="h-18 surface-raised animate-pulse" />
          <div class="h-18 surface-raised animate-pulse" style="animation-delay:0.1s" />
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!loading() && store.sessions().length === 0}>
        <div class="flex-1 flex flex-col items-center justify-center text-center py-16">
          <div class="w-12 h-12 rounded-2xl bg-bg-2 flex items-center justify-center mb-4">
            <div class="w-5 h-5 rounded bg-amber/20" />
          </div>
          <p class="text-sm text-text-2 mb-1">No sessions running</p>
          <p class="text-xs text-text-3 mb-5">Create one to get started</p>
          <button class="btn-primary" onClick={() => setCreating(true)}>
            New session
          </button>
        </div>
      </Show>

      {/* Session list */}
      <div class="flex-1 overflow-y-auto -mx-1 px-1 space-y-1.5 stagger">
        <For each={store.sessions()}>
          {(session) => {
            const shell = () => session.shell.split('/').pop() || session.shell;
            const cwd = () => session.cwd.replace(/^\/home\/[^/]+/, '~');
            const fg = () => session.fg_process && session.fg_process !== 'idle' ? session.fg_process : null;
            const isRunning = () => session.state === 'running';
            const displayName = () => session.name || session.id.slice(0, 8);

            return (
              <div
                class="w-full text-left surface-raised p-4 flex items-start gap-3.5 cursor-pointer transition-all duration-150 hover:bg-bg-3/60 active:scale-[0.995] group"
                role="button"
                tabIndex={0}
                onClick={() => attachSession(session.id)}
                onKeyDown={(e) => e.key === 'Enter' && attachSession(session.id)}
              >
                {/* Status + shell badge */}
                <div class="pt-0.5 flex flex-col items-center gap-1.5">
                  <div class={`w-2 h-2 rounded-full shrink-0 ${isRunning() ? 'bg-sage' : 'bg-text-3/40'}`} />
                  <span class="text-[10px] font-mono text-text-3 leading-none">{shell()}</span>
                </div>

                {/* Info */}
                <div class="flex-1 min-w-0">
                  <div class="flex items-baseline gap-2 mb-0.5">
                    <span class="text-sm font-500 text-text-0 truncate">{displayName()}</span>
                    <Show when={session.attached > 0}>
                      <span class="text-[10px] font-mono text-sky shrink-0">{session.attached} viewer{session.attached > 1 ? 's' : ''}</span>
                    </Show>
                  </div>
                  <div class="flex items-center gap-1.5 text-xs text-text-3 font-mono truncate">
                    <span class="truncate">{cwd()}</span>
                    <Show when={fg()}>
                      <span class="text-amber/80 shrink-0">{fg()}</span>
                    </Show>
                  </div>
                </div>

                {/* Kill button */}
                <button
                  class="opacity-0 group-hover:opacity-100 focus:opacity-100 btn-danger text-[11px] py-1 px-2 shrink-0 transition-opacity"
                  onClick={(e) => killSession(session.id, e)}
                  title="Kill session"
                >
                  End
                </button>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
