import { createSignal, onMount, For, Show } from 'solid-js';
import {
  loadSettings,
  saveSettings,
  listHosts,
  removeHost,
  type HostConfig,
} from '../lib/store';
import { store } from '../lib/store';
import { disconnect } from '../lib/cairn';

export default function Settings() {
  const [signalServer, setSignalServer] = createSignal('');
  const [signalToken, setSignalToken] = createSignal('');
  const [turnServer, setTurnServer] = createSignal('');
  const [turnUser, setTurnUser] = createSignal('');
  const [turnPass, setTurnPass] = createSignal('');
  const [saved, setSaved] = createSignal(false);
  const [hosts, setHosts] = createSignal<HostConfig[]>([]);

  onMount(async () => {
    const settings = await loadSettings();
    setSignalServer(settings.signalServer || '');
    setSignalToken(settings.signalToken || '');
    setTurnServer(settings.turnServer || '');
    setTurnUser(settings.turnUser || '');
    setTurnPass(settings.turnPass || '');
    setHosts(await listHosts());
  });

  async function handleSave() {
    await saveSettings({
      signalServer: signalServer(),
      signalToken: signalToken(),
      turnServer: turnServer(),
      turnUser: turnUser(),
      turnPass: turnPass(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleRemoveHost(peerId: string) {
    await removeHost(peerId);
    setHosts(await listHosts());
  }

  function handleDisconnect() {
    disconnect();
    store.setView('pairing');
  }

  return (
    <div class="flex-1 overflow-y-auto px-4 pt-4 pb-6 max-w-xl mx-auto w-full">
      <h2 class="text-lg font-600 text-text-0 mb-6">Settings</h2>

      {/* Infrastructure */}
      <section class="mb-8">
        <div class="text-xs font-500 text-text-3 tracking-wider uppercase mb-3">
          Network Infrastructure
        </div>
        <div class="surface-card p-5 space-y-4">
          <p class="text-xs text-text-3 leading-relaxed -mt-1">
            Configure signaling and relay servers for Tier 1+ connectivity.
            Not needed for Tier 0 (zero-config) or QR/link pairing.
          </p>

          <div>
            <label class="label-text">Signaling Server</label>
            <input
              type="text"
              class="input-field font-mono text-xs"
              placeholder="wss://signal.example.com"
              value={signalServer()}
              onInput={(e) => setSignalServer(e.currentTarget.value)}
            />
          </div>

          <div>
            <label class="label-text">Auth Token</label>
            <input
              type="password"
              class="input-field font-mono text-xs"
              placeholder="Optional"
              value={signalToken()}
              onInput={(e) => setSignalToken(e.currentTarget.value)}
            />
          </div>

          <div>
            <label class="label-text">TURN Relay Server</label>
            <input
              type="text"
              class="input-field font-mono text-xs"
              placeholder="turn:relay.example.com:3478"
              value={turnServer()}
              onInput={(e) => setTurnServer(e.currentTarget.value)}
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="label-text">TURN Username</label>
              <input
                type="text"
                class="input-field font-mono text-xs"
                value={turnUser()}
                onInput={(e) => setTurnUser(e.currentTarget.value)}
              />
            </div>
            <div>
              <label class="label-text">TURN Password</label>
              <input
                type="password"
                class="input-field font-mono text-xs"
                value={turnPass()}
                onInput={(e) => setTurnPass(e.currentTarget.value)}
              />
            </div>
          </div>

          <button class="btn-primary text-xs" onClick={handleSave}>
            {saved() ? 'Saved' : 'Save'}
          </button>
        </div>
      </section>

      {/* Paired hosts */}
      <section class="mb-8">
        <div class="text-xs font-500 text-text-3 tracking-wider uppercase mb-3">
          Paired Hosts
        </div>
        <Show
          when={hosts().length > 0}
          fallback={
            <div class="surface-card p-5 text-xs text-text-3">
              No hosts paired yet. Connect to a host to save it here.
            </div>
          }
        >
          <div class="space-y-1.5">
            <For each={hosts()}>
              {(host) => (
                <div class="surface-raised p-4 flex items-center gap-3">
                  <div class="w-8 h-8 rounded-lg bg-amber/10 flex items-center justify-center shrink-0">
                    <div class="w-3 h-3 rounded-sm bg-amber/40" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-500 text-text-0 truncate">{host.hostName}</div>
                    <div class="text-[10px] font-mono text-text-3 truncate">
                      {host.peerId.slice(0, 20)}...
                    </div>
                  </div>
                  <button
                    class="btn-danger text-[11px] shrink-0"
                    onClick={() => handleRemoveHost(host.peerId)}
                  >
                    Remove
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      {/* Connection */}
      <Show when={store.connected()}>
        <section>
          <div class="text-xs font-500 text-text-3 tracking-wider uppercase mb-3">
            Connection
          </div>
          <div class="surface-card p-5 flex items-center justify-between">
            <div>
              <div class="text-sm text-text-1">
                Connected to <span class="font-500 text-text-0">{store.hostName()}</span>
              </div>
              <div class="text-xs text-text-3 font-mono mt-0.5">{store.tier()}</div>
            </div>
            <button class="btn-danger text-xs" onClick={handleDisconnect}>
              Disconnect
            </button>
          </div>
        </section>
      </Show>

      <Show when={!store.connected()}>
        <div class="text-center mt-4">
          <button
            class="text-xs text-text-3 hover:text-text-2 bg-transparent border-none cursor-pointer transition-colors"
            onClick={() => {
              store.setConnected(false);
              store.setView('pairing');
            }}
          >
            Back to pairing
          </button>
        </div>
      </Show>
    </div>
  );
}
