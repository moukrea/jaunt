import { createSignal, onMount, For, Show, onCleanup } from 'solid-js';
import { store, listHosts, type HostConfig, type SavedConnection } from '../lib/store';
import { disconnect, tryResumeConnection } from '../lib/cairn';

export default function HostSwitcher() {
  const [open, setOpen] = createSignal(false);
  const [hosts, setHosts] = createSignal<HostConfig[]>([]);
  const [switching, setSwitching] = createSignal(false);
  let dropdownRef: HTMLDivElement | undefined;

  onMount(async () => {
    const allHosts = await listHosts();
    setHosts(allHosts);

    // Close on outside click
    const handler = (e: MouseEvent) => {
      if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    onCleanup(() => document.removeEventListener('mousedown', handler));
  });

  async function switchToHost(host: HostConfig) {
    if (host.peerId === store.peerId()) return; // already connected
    if (switching()) return;

    setSwitching(true);
    setOpen(false);

    try {
      // Disconnect from current host
      if (store.connected()) {
        await disconnect();
        store.setConnected(false);
      }

      // Attempt to connect to the new host
      const saved: SavedConnection = {
        hostLibp2pPeerId: host.peerId,
        hostAddrs: (host.cairnConfig as any)?.ws_addrs || [],
        hostName: host.hostName,
        libp2pSeed: [],
        connectedAt: Date.now(),
      };

      store.setReconnecting(true);
      store.setReconnectHostName(host.hostName);

      const ok = await tryResumeConnection(saved);
      store.setReconnecting(false);

      if (ok) {
        store.setView('sessions');
      } else {
        store.setError(`Could not connect to ${host.hostName}`);
        store.setView('pairing');
      }
    } catch (e: any) {
      store.setError(e.message);
      store.setReconnecting(false);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div ref={dropdownRef} class="relative">
      <button
        class="flex items-center gap-1.5 bg-transparent border-none cursor-pointer p-0 group"
        onClick={async () => {
          if (!open()) {
            const allHosts = await listHosts();
            setHosts(allHosts);
          }
          setOpen(!open());
        }}
      >
        <span class="text-sm font-500 text-text-0 truncate max-w-40 group-hover:text-amber transition-colors">
          {store.hostName() || 'Not connected'}
        </span>
        <svg
          class={`w-3 h-3 text-text-3 transition-transform duration-150 ${open() ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12" fill="none"
        >
          <path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>

      <Show when={open()}>
        <div
          class="absolute top-full left-0 mt-1.5 w-56 bg-bg-1 border border-bg-3/50 rounded-xl overflow-hidden shadow-xl z-50"
          style="animation: viewIn 0.1s ease-out"
        >
          <div class="px-3 py-2 text-[10px] font-mono text-text-3/60 uppercase tracking-wider border-b border-bg-3/30">
            Paired Hosts
          </div>
          <div class="max-h-48 overflow-y-auto">
            <Show when={hosts().length > 0} fallback={
              <div class="px-3 py-4 text-xs text-text-3/60 text-center">No paired hosts</div>
            }>
              <For each={hosts()}>
                {(host) => {
                  const isCurrent = () => host.peerId === store.peerId();
                  return (
                    <button
                      class={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 border-none cursor-pointer transition-all duration-100 ${
                        isCurrent()
                          ? 'bg-amber/8 text-amber'
                          : 'bg-transparent text-text-1 hover:bg-bg-2/80'
                      }`}
                      onClick={() => switchToHost(host)}
                      disabled={switching()}
                    >
                      <div class={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isCurrent() && store.connected() ? 'bg-sage' : 'bg-text-3/30'
                      }`} />
                      <div class="flex-1 min-w-0">
                        <div class="text-xs font-500 truncate">{host.hostName}</div>
                        <div class="text-[9px] font-mono text-text-3/50 truncate">
                          {host.peerId.slice(0, 16)}...
                        </div>
                      </div>
                      <Show when={isCurrent()}>
                        <span class="text-[9px] font-mono text-amber/70">current</span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </Show>
          </div>
          <div class="border-t border-bg-3/30">
            <button
              class="w-full text-left px-3 py-2 text-xs text-text-3 hover:text-amber hover:bg-amber/5 border-none bg-transparent cursor-pointer transition-colors"
              onClick={() => { setOpen(false); store.setView('settings'); }}
            >
              Manage hosts...
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
