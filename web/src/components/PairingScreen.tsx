import { createSignal, onMount } from 'solid-js';
import { decodeProfileFromFragment, type ConnectionProfile } from '../lib/profile';
import { initNode, pairScanQr, pairEnterPin, connectToHost } from '../lib/cairn';
import { store, saveHost } from '../lib/store';

export default function PairingScreen() {
  const [pin, setPin] = createSignal('');
  const [status, setStatus] = createSignal('');
  const [pairing, setPairing] = createSignal(false);

  // Check URL fragment for connection profile on mount
  onMount(async () => {
    const fragment = window.location.hash.slice(1);
    if (fragment) {
      try {
        setStatus('Decoding connection profile...');
        setPairing(true);
        const profile = decodeProfileFromFragment(fragment);
        await pairFromProfile(profile);
      } catch (e: any) {
        setStatus(`Failed: ${e.message}`);
        setPairing(false);
      }
    }
  });

  async function pairFromProfile(profile: ConnectionProfile) {
    setStatus(`Connecting to ${profile.host_name}...`);

    await initNode(profile);

    setStatus('Pairing...');
    let peerId: string;

    if ('Qr' in profile.pairing) {
      peerId = await pairScanQr(new Uint8Array(profile.pairing.Qr.qr_data));
    } else if ('Pin' in profile.pairing) {
      peerId = await pairEnterPin(profile.pairing.Pin.pin);
    } else if ('Link' in profile.pairing) {
      // For link pairing, the URI is used directly
      peerId = await pairEnterPin(profile.pairing.Link.uri);
    } else {
      throw new Error('Unknown pairing type');
    }

    store.setHostName(profile.host_name);

    // Save host config
    await saveHost({
      peerId,
      hostName: profile.host_name,
      cairnConfig: profile,
      pairedAt: Date.now(),
      lastSeen: Date.now(),
    });

    setStatus('Connecting to host...');
    await connectToHost(peerId);

    store.setConnected(true);
    store.setView('sessions');

    // Clean URL fragment
    history.replaceState(null, '', window.location.pathname);
  }

  async function handlePinPair() {
    if (!pin().trim()) return;
    setPairing(true);
    try {
      setStatus('Initializing...');
      await initNode();

      setStatus('Pairing with PIN...');
      const peerId = await pairEnterPin(pin().trim());

      store.setHostName('Host');
      await saveHost({
        peerId,
        hostName: 'Host',
        cairnConfig: {},
        pairedAt: Date.now(),
        lastSeen: Date.now(),
      });

      setStatus('Connecting...');
      await connectToHost(peerId);

      store.setConnected(true);
      store.setView('sessions');
    } catch (e: any) {
      setStatus(`Failed: ${e.message}`);
      setPairing(false);
    }
  }

  return (
    <div class="flex-1 flex items-center justify-center p-4">
      <div class="w-full max-w-md">
        <h1 class="text-3xl font-bold text-center mb-2">Jaunt</h1>
        <p class="text-gray-400 text-center mb-8">
          Access your machine from anywhere
        </p>

        {/* PIN Input */}
        <div class="bg-surface-1 rounded-xl p-6 mb-4">
          <label class="block text-sm font-medium text-gray-300 mb-2">
            Enter PIN from host
          </label>
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="A1B2-C3D4"
              class="flex-1 bg-surface-2 border border-surface-3 rounded-lg px-4 py-3 text-lg font-mono text-center tracking-widest focus:border-accent focus:outline-none"
              value={pin()}
              onInput={(e) => setPin(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePinPair()}
              disabled={pairing()}
            />
            <button
              class="px-6 py-3 bg-accent hover:bg-accent/80 rounded-lg font-medium transition-colors disabled:opacity-50"
              onClick={handlePinPair}
              disabled={pairing() || !pin().trim()}
            >
              Connect
            </button>
          </div>
        </div>

        {/* QR scan hint */}
        <div class="bg-surface-1 rounded-xl p-6 mb-4">
          <p class="text-sm text-gray-400 text-center">
            Or scan the QR code displayed by <code class="text-accent">jaunt-host serve</code> to
            connect automatically with the host's infrastructure settings.
          </p>
        </div>

        {/* Status */}
        {status() && (
          <div class={`text-center text-sm mt-4 ${pairing() ? 'text-accent' : 'text-danger'}`}>
            {pairing() && <span class="inline-block animate-spin mr-2">⟳</span>}
            {status()}
          </div>
        )}

        {/* Settings link */}
        <div class="text-center mt-6">
          <button
            class="text-sm text-gray-500 hover:text-gray-300 transition-colors"
            onClick={() => { store.setView('settings'); store.setConnected(true); }}
          >
            Advanced Settings
          </button>
        </div>
      </div>
    </div>
  );
}
