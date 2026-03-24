import { createSignal, onMount } from 'solid-js';
import { loadSettings, saveSettings, listHosts, removeHost, type HostConfig } from '../lib/store';
import { store } from '../lib/store';

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

  return (
    <div class="flex-1 p-4 max-w-2xl mx-auto w-full">
      <h2 class="text-xl font-semibold mb-6">Settings</h2>

      {/* Cairn Infrastructure Config */}
      <div class="bg-surface-1 rounded-xl p-6 mb-6">
        <h3 class="text-lg font-medium mb-4">Cairn Infrastructure</h3>
        <p class="text-sm text-gray-400 mb-4">
          Configure signaling and relay servers for Tier 1+ connectivity.
          Not needed for Tier 0 or QR/link pairing (config is embedded automatically).
        </p>

        <div class="space-y-4">
          <div>
            <label class="block text-sm text-gray-300 mb-1">Signaling Server</label>
            <input
              type="text"
              placeholder="wss://signal.example.com"
              class="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none"
              value={signalServer()}
              onInput={(e) => setSignalServer(e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">Auth Token</label>
            <input
              type="password"
              placeholder="Optional"
              class="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none"
              value={signalToken()}
              onInput={(e) => setSignalToken(e.currentTarget.value)}
            />
          </div>
          <div>
            <label class="block text-sm text-gray-300 mb-1">TURN Server</label>
            <input
              type="text"
              placeholder="turn:relay.example.com:3478"
              class="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none"
              value={turnServer()}
              onInput={(e) => setTurnServer(e.currentTarget.value)}
            />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm text-gray-300 mb-1">TURN Username</label>
              <input
                type="text"
                class="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none"
                value={turnUser()}
                onInput={(e) => setTurnUser(e.currentTarget.value)}
              />
            </div>
            <div>
              <label class="block text-sm text-gray-300 mb-1">TURN Password</label>
              <input
                type="password"
                class="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-sm focus:border-accent focus:outline-none"
                value={turnPass()}
                onInput={(e) => setTurnPass(e.currentTarget.value)}
              />
            </div>
          </div>

          <button
            class="px-4 py-2 bg-accent hover:bg-accent/80 rounded-lg text-sm font-medium transition-colors"
            onClick={handleSave}
          >
            {saved() ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Paired Hosts */}
      <div class="bg-surface-1 rounded-xl p-6">
        <h3 class="text-lg font-medium mb-4">Paired Hosts</h3>
        {hosts().length === 0 ? (
          <p class="text-sm text-gray-500">No paired hosts yet.</p>
        ) : (
          <div class="space-y-2">
            {hosts().map((host) => (
              <div class="flex items-center justify-between bg-surface-2 rounded-lg px-4 py-3">
                <div>
                  <div class="font-medium text-sm">{host.hostName}</div>
                  <div class="text-xs text-gray-500 font-mono">{host.peerId.slice(0, 16)}...</div>
                  <div class="text-xs text-gray-500">
                    Paired: {new Date(host.pairedAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  class="text-xs text-danger hover:text-danger/80"
                  onClick={() => handleRemoveHost(host.peerId)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Back to pairing */}
      {!store.connected() && (
        <div class="text-center mt-6">
          <button
            class="text-sm text-gray-500 hover:text-gray-300"
            onClick={() => { store.setConnected(false); store.setView('pairing'); }}
          >
            Back to Pairing
          </button>
        </div>
      )}
    </div>
  );
}
