import { createSignal, onMount, Show } from 'solid-js';
import { decodeProfileFromFragment, type ConnectionProfile } from '../lib/profile';
import { initNode, pairScanQr, pairEnterPin, connectToHost } from '../lib/cairn';
import { store, saveHost } from '../lib/store';

type PairingPhase = 'idle' | 'decoding' | 'initializing' | 'pairing' | 'connecting' | 'done' | 'error';

export default function PairingScreen() {
  const [pin, setPin] = createSignal('');
  const [phase, setPhase] = createSignal<PairingPhase>('idle');
  const [statusMsg, setStatusMsg] = createSignal('');
  const [errorMsg, setErrorMsg] = createSignal('');

  onMount(async () => {
    const fragment = window.location.hash.slice(1);
    if (fragment) {
      try {
        setPhase('decoding');
        setStatusMsg('Reading connection profile...');
        const profile = decodeProfileFromFragment(fragment);
        await pairFromProfile(profile);
      } catch (e: any) {
        setPhase('error');
        setErrorMsg(e.message);
      }
    }
  });

  async function pairFromProfile(profile: ConnectionProfile) {
    setPhase('initializing');
    setStatusMsg(`Reaching ${profile.host_name}...`);
    await initNode(profile);

    setPhase('pairing');
    setStatusMsg('Establishing secure channel...');
    let peerId: string;

    if ('Qr' in profile.pairing) {
      peerId = await pairScanQr(new Uint8Array(profile.pairing.Qr.qr_data));
    } else if ('Pin' in profile.pairing) {
      peerId = await pairEnterPin(profile.pairing.Pin.pin);
    } else if ('Link' in profile.pairing) {
      peerId = await pairEnterPin(profile.pairing.Link.uri);
    } else {
      throw new Error('Unknown pairing type');
    }

    store.setHostName(profile.host_name);
    await saveHost({
      peerId,
      hostName: profile.host_name,
      cairnConfig: profile,
      pairedAt: Date.now(),
      lastSeen: Date.now(),
    });

    setPhase('connecting');
    setStatusMsg('Connected. Loading sessions...');
    await connectToHost(peerId);
    setPhase('done');
    store.setConnected(true);
    store.setView('sessions');
    history.replaceState(null, '', window.location.pathname);
  }

  async function handlePinPair() {
    const p = pin().trim();
    if (!p) return;
    try {
      setPhase('initializing');
      setStatusMsg('Starting P2P node...');
      await initNode();

      setPhase('pairing');
      setStatusMsg('Verifying PIN...');
      const peerId = await pairEnterPin(p);

      store.setHostName('Host');
      await saveHost({
        peerId,
        hostName: 'Host',
        cairnConfig: {},
        pairedAt: Date.now(),
        lastSeen: Date.now(),
      });

      setPhase('connecting');
      setStatusMsg('Establishing connection...');
      await connectToHost(peerId);
      setPhase('done');
      store.setConnected(true);
      store.setView('sessions');
    } catch (e: any) {
      setPhase('error');
      setErrorMsg(e.message);
    }
  }

  const isWorking = () => !['idle', 'error'].includes(phase());

  return (
    <div class="flex-1 flex flex-col items-center justify-center px-5 py-12">
      {/* Brand */}
      <div class="mb-12 text-center" style="animation: viewIn 0.4s cubic-bezier(0.16,1,0.3,1) both">
        <div class="inline-flex items-center gap-2 mb-4">
          <div class="w-8 h-8 rounded-lg bg-amber/15 flex items-center justify-center">
            <div class="w-3 h-3 rounded-sm bg-amber" />
          </div>
          <span class="font-mono text-lg font-600 tracking-widest text-text-0">JAUNT</span>
        </div>
        <p class="text-text-2 text-sm max-w-64 mx-auto leading-relaxed">
          Access your machine from anywhere. Zero infrastructure, end-to-end encrypted.
        </p>
      </div>

      {/* Connection card */}
      <div
        class="w-full max-w-sm"
        style="animation: viewIn 0.4s cubic-bezier(0.16,1,0.3,1) 0.08s both"
      >
        <div class="surface-card p-6">
          <div class="text-xs font-500 text-text-3 tracking-wider uppercase mb-4">
            Enter host PIN
          </div>

          {/* PIN Input — large, monospaced, centered */}
          <input
            type="text"
            inputMode="text"
            autocomplete="off"
            spellcheck={false}
            placeholder="A1B2-C3D4"
            class="w-full bg-bg-0 border-2 border-bg-3 rounded-xl px-4 py-4 text-xl font-mono font-500 text-center text-text-0 tracking-[0.25em] placeholder:text-text-3/50 placeholder:tracking-[0.25em] outline-none transition-all duration-200 focus:border-amber/60 focus:shadow-[0_0_0_3px_rgba(232,162,69,0.08)]"
            value={pin()}
            onInput={(e) => setPin(e.currentTarget.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handlePinPair()}
            disabled={isWorking()}
          />

          <button
            class="w-full btn-primary mt-4 py-3.5 text-base disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={handlePinPair}
            disabled={isWorking() || !pin().trim()}
          >
            {isWorking() ? (
              <span class="flex items-center justify-center gap-2.5">
                <div class="spinner" />
                {statusMsg()}
              </span>
            ) : (
              'Connect'
            )}
          </button>
        </div>

        {/* Divider */}
        <div class="flex items-center gap-3 my-5">
          <div class="flex-1 h-px bg-bg-3/40" />
          <span class="text-[11px] text-text-3 tracking-wider uppercase">or</span>
          <div class="flex-1 h-px bg-bg-3/40" />
        </div>

        {/* QR hint */}
        <div class="surface-card p-5">
          <p class="text-sm text-text-2 leading-relaxed">
            Scan the <span class="text-amber font-500">QR code</span> displayed
            by <code class="font-mono text-xs text-text-1 bg-bg-2 px-1.5 py-0.5 rounded">jaunt-host serve</code> to
            connect automatically with the host's network settings.
          </p>
        </div>

        {/* Error state */}
        <Show when={phase() === 'error'}>
          <div class="mt-4 p-4 bg-coral/8 border border-coral/20 rounded-xl">
            <div class="text-sm text-coral font-500 mb-1">Connection failed</div>
            <div class="text-xs text-text-2">{errorMsg()}</div>
            <button
              class="mt-3 text-xs text-amber font-500 hover:underline bg-transparent border-none cursor-pointer p-0"
              onClick={() => { setPhase('idle'); setErrorMsg(''); }}
            >
              Try again
            </button>
          </div>
        </Show>

        {/* Settings link */}
        <div class="text-center mt-8">
          <button
            class="text-xs text-text-3 hover:text-text-2 transition-colors bg-transparent border-none cursor-pointer"
            onClick={() => store.setView('settings')}
          >
            Advanced settings
          </button>
        </div>
      </div>
    </div>
  );
}
