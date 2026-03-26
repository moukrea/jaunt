import { createSignal, onMount, onCleanup, For, Show, createMemo } from 'solid-js';
import { sendRpc } from '../lib/cairn';
import { store } from '../lib/store';
import type { SessionInfo } from '../lib/protocol';

interface SessionPickerProps {
  onSelect: (sessionId: string, sessionName?: string) => void;
  onClose: () => void;
}

export default function SessionPicker(props: SessionPickerProps) {
  const [loading, setLoading] = createSignal(true);
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal('');
  const [search, setSearch] = createSignal('');
  const [localSessions, setLocalSessions] = createSignal<SessionInfo[]>([]);
  let containerRef: HTMLDivElement | undefined;
  let searchRef: HTMLInputElement | undefined;

  const filtered = createMemo(() => {
    const q = search().toLowerCase();
    if (!q) return localSessions();
    return localSessions().filter(s => {
      const name = (s.name || s.id).toLowerCase();
      const shell = s.shell.toLowerCase();
      const cwd = s.cwd.toLowerCase();
      return name.includes(q) || shell.includes(q) || cwd.includes(q);
    });
  });

  onMount(async () => {
    await refreshSessions();
    searchRef?.focus();
    const handler = (e: MouseEvent) => {
      if (containerRef && !containerRef.contains(e.target as Node)) props.onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    onCleanup(() => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    });
  });

  async function refreshSessions() {
    setLoading(true);
    try {
      const resp = await sendRpc({ SessionList: {} });
      if ('Ok' in resp) {
        const data = resp.Ok;
        if ('SessionList' in (data as any)) {
          const list = (data as any).SessionList as SessionInfo[];
          setLocalSessions(list);
          store.setSessions(list);
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
      const resp = await sendRpc({ SessionCreate: { name, shell: null, cwd: null } });
      if ('Ok' in resp) {
        const data = resp.Ok;
        if ('SessionCreated' in (data as any)) {
          props.onSelect((data as any).SessionCreated.id, name);
          return;
        }
      }
      if ('Error' in resp) {
        store.setError((resp as any).Error.message || 'Session creation failed');
      }
    } catch (e: any) {
      store.setError(e.message);
    }
  }

  return (
    <div
      ref={containerRef}
      class="w-72 max-h-96 bg-bg-1 border border-bg-3/50 rounded-xl overflow-hidden"
      style="animation: viewIn 0.12s cubic-bezier(0.16,1,0.3,1); box-shadow: 0 8px 40px #00000060, 0 0 0 1px #ffffff06 inset"
    >
      {/* Search input — always visible, auto-focused */}
      <div class="px-3 pt-3 pb-2">
        <div class="relative">
          <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3/50" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="5" cy="5" r="3.5" stroke="currentColor" stroke-width="1.2" />
            <path d="M7.5 7.5L10.5 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
          <input
            ref={searchRef}
            type="text"
            class="w-full bg-bg-0 border border-bg-3/50 rounded-lg pl-7 pr-3 py-2 text-xs text-text-1 placeholder-text-3/50 outline-none focus:border-amber/40 transition-colors"
            placeholder="Search sessions..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
      </div>

      {/* Session list */}
      <div class="max-h-52 overflow-y-auto px-1.5 pb-1.5">
        <Show when={loading()}>
          <div class="px-3 py-6 flex items-center justify-center">
            <div class="spinner" />
          </div>
        </Show>
        <Show when={!loading()}>
          <Show when={filtered().length === 0}>
            <div class="px-3 py-5 text-[11px] text-text-3/60 text-center font-mono">
              {search() ? 'No matches' : 'No running sessions'}
            </div>
          </Show>
          <For each={filtered()}>
            {(session) => {
              const shell = () => session.shell.split('/').pop() || session.shell;
              const cwd = () => session.cwd.replace(/^\/home\/[^/]+/, '~');
              const name = () => session.name || session.id.slice(0, 8);
              const isRunning = () => session.state === 'running';

              return (
                <button
                  class="w-full text-left px-2.5 py-2 flex items-center gap-2.5 rounded-lg hover:bg-bg-2/80 active:bg-bg-3/60 transition-all duration-100 cursor-pointer border-none bg-transparent group"
                  onClick={() => props.onSelect(session.id, session.name ?? undefined)}
                >
                  {/* Status indicator */}
                  <div class="flex flex-col items-center gap-1 shrink-0 w-5">
                    <div
                      class={`w-1.5 h-1.5 rounded-full ${isRunning() ? 'bg-sage' : 'bg-text-3/30'}`}
                      style={isRunning() ? { 'box-shadow': '0 0 4px #7dba6e40' } : {}}
                    />
                    <span class="text-[8px] font-mono text-text-3/50 uppercase leading-none">{shell()}</span>
                  </div>

                  {/* Session info */}
                  <div class="flex-1 min-w-0">
                    <div class="text-xs font-mono font-500 text-text-0 truncate group-hover:text-amber transition-colors duration-100">
                      {name()}
                    </div>
                    <div class="text-[10px] font-mono text-text-3/60 truncate mt-0.5">
                      {cwd()}
                    </div>
                  </div>

                  {/* Viewer count */}
                  <Show when={session.attached > 0}>
                    <div class="flex items-center gap-1 shrink-0">
                      <div class="w-1 h-1 rounded-full bg-sky/60" />
                      <span class="text-[9px] font-mono text-sky/70">{session.attached}</span>
                    </div>
                  </Show>
                </button>
              );
            }}
          </For>
        </Show>
      </div>

      {/* Create new — bottom action strip */}
      <div class="border-t border-bg-3/30">
        <Show
          when={creating()}
          fallback={
            <button
              class="w-full text-left px-3.5 py-2.5 flex items-center gap-2 hover:bg-amber/5 active:bg-amber/10 transition-colors cursor-pointer border-none bg-transparent"
              onClick={() => { setCreating(true); setSearch(''); }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" class="text-amber">
                <path d="M5.5 1.5v8M1.5 5.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
              </svg>
              <span class="text-xs text-amber font-500">New session</span>
            </button>
          }
        >
          <div class="px-3 py-2.5 flex items-center gap-2" style="animation: viewIn 0.1s ease-out">
            <input
              type="text"
              class="flex-1 bg-bg-0 border border-bg-3/50 rounded-md px-2.5 py-1.5 text-xs font-mono text-text-1 placeholder-text-3/40 outline-none focus:border-amber/40"
              placeholder="Name (optional)"
              value={newName()}
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createSession();
                if (e.key === 'Escape') setCreating(false);
              }}
              autofocus
            />
            <button
              class="text-xs text-bg-0 bg-amber rounded-md px-3 py-1.5 font-600 border-none cursor-pointer hover:brightness-110 active:brightness-95 transition-all"
              onClick={createSession}
            >
              Create
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}
