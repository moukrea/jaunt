import { createSignal, onMount, onCleanup, For, Show } from 'solid-js';
import { sendRpc } from '../lib/cairn';
import { store } from '../lib/store';
import type { SessionInfo } from '../lib/protocol';

interface SessionPickerProps {
  /** Called when a session is selected (existing or newly created) */
  onSelect: (sessionId: string, sessionName?: string) => void;
  /** Called when the picker is dismissed */
  onClose: () => void;
  /** Position anchor element rect (for positioning the dropdown) */
  anchorRect?: DOMRect;
}

export default function SessionPicker(props: SessionPickerProps) {
  const [loading, setLoading] = createSignal(true);
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal('');
  const [localSessions, setLocalSessions] = createSignal<SessionInfo[]>([]);
  let containerRef: HTMLDivElement | undefined;

  onMount(async () => {
    await refreshSessions();
    // Close on click outside
    const handler = (e: MouseEvent) => {
      if (containerRef && !containerRef.contains(e.target as Node)) {
        props.onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
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
          const id = (data as any).SessionCreated.id;
          props.onSelect(id, name);
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

  function selectSession(session: SessionInfo) {
    props.onSelect(session.id, session.name ?? undefined);
  }

  return (
    <div
      ref={containerRef}
      class="absolute z-50 w-72 max-h-80 bg-bg-1 border border-bg-3/60 rounded-xl shadow-2xl overflow-hidden"
      style="animation: viewIn 0.15s ease-out"
    >
      {/* Header */}
      <div class="px-3 py-2.5 border-b border-bg-3/40 flex items-center justify-between">
        <span class="text-xs font-500 text-text-2">Choose session</span>
        <button
          class="text-[10px] text-text-3 hover:text-text-1 bg-transparent border-none cursor-pointer"
          onClick={props.onClose}
        >
          ESC
        </button>
      </div>

      {/* Session list */}
      <div class="max-h-48 overflow-y-auto">
        <Show when={loading()}>
          <div class="px-3 py-4 flex items-center justify-center">
            <div class="spinner" />
          </div>
        </Show>
        <Show when={!loading()}>
          <Show when={localSessions().length === 0}>
            <div class="px-3 py-4 text-xs text-text-3 text-center">
              No running sessions
            </div>
          </Show>
          <For each={localSessions()}>
            {(session) => {
              const shell = () => session.shell.split('/').pop() || session.shell;
              const cwd = () => session.cwd.replace(/^\/home\/[^/]+/, '~');
              const displayName = () => session.name || session.id.slice(0, 8);
              return (
                <button
                  class="w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-bg-2 active:bg-bg-3 transition-colors cursor-pointer border-none bg-transparent"
                  onClick={() => selectSession(session)}
                >
                  <div class={`w-1.5 h-1.5 rounded-full shrink-0 ${session.state === 'running' ? 'bg-sage' : 'bg-text-3/40'}`} />
                  <div class="flex-1 min-w-0">
                    <div class="text-xs font-500 text-text-0 truncate">{displayName()}</div>
                    <div class="text-[10px] font-mono text-text-3 truncate flex items-center gap-1.5">
                      <span class="text-text-3/70">{shell()}</span>
                      <span class="truncate">{cwd()}</span>
                    </div>
                  </div>
                  <Show when={session.attached > 0}>
                    <span class="text-[9px] font-mono text-sky shrink-0">{session.attached}</span>
                  </Show>
                </button>
              );
            }}
          </For>
        </Show>
      </div>

      {/* Create new session */}
      <div class="border-t border-bg-3/40">
        <Show
          when={creating()}
          fallback={
            <button
              class="w-full text-left px-3 py-2.5 flex items-center gap-2.5 hover:bg-bg-2 active:bg-bg-3 transition-colors cursor-pointer border-none bg-transparent"
              onClick={() => setCreating(true)}
            >
              <span class="text-amber text-xs font-600">+</span>
              <span class="text-xs text-amber font-500">New session</span>
            </button>
          }
        >
          <div class="px-3 py-2.5 flex items-center gap-2" style="animation: viewIn 0.12s ease-out">
            <input
              type="text"
              class="flex-1 bg-bg-0 border border-bg-3 rounded-md px-2 py-1.5 text-xs text-text-1 placeholder-text-3 outline-none focus:border-amber/50"
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
              class="text-xs text-bg-0 bg-amber rounded-md px-2.5 py-1.5 font-500 border-none cursor-pointer hover:brightness-110"
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
