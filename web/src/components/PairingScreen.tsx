import { createSignal, onMount, Show } from 'solid-js';
import { decodeProfileFromFragment, getWsMultiaddrs, type ConnectionProfile } from '../lib/profile';
import { initNode, pairScanQr, pairEnterPin, connectToHost, tryResumeConnection } from '../lib/cairn';
import { store, saveHost, loadConnection, clearConnection } from '../lib/store';

type PairingPhase = 'idle' | 'decoding' | 'initializing' | 'pairing' | 'connecting' | 'resuming' | 'done' | 'error';

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export default function PairingScreen() {
  const [pin, setPin] = createSignal('');
  const [hostAddr, setHostAddr] = createSignal('');
  const [phase, setPhase] = createSignal<PairingPhase>('idle');
  const [statusMsg, setStatusMsg] = createSignal('');
  const [errorMsg, setErrorMsg] = createSignal('');
  const [showHelp, setShowHelp] = createSignal(false);

  onMount(async () => {
    const fragment = window.location.hash.slice(1);
    console.log('[jaunt] onMount, fragment length:', fragment.length);

    if (fragment) {
      // URL fragment present -- use the connection profile from the URL
      try {
        setPhase('decoding');
        setStatusMsg('Reading connection profile...');
        const profile = decodeProfileFromFragment(fragment);
        console.log('[jaunt] profile decoded:', profile.host_name, 'addrs:', getWsMultiaddrs(profile));
        await pairFromProfile(profile);
      } catch (e: any) {
        console.error('[jaunt] pairing error:', e);
        setPhase('error');
        setErrorMsg(e.message);
      }
      return;
    }

    // No URL fragment -- try to resume a saved connection
    try {
      const saved = await loadConnection();
      if (saved) {
        console.log('[jaunt] Found saved connection to', saved.hostName, '- attempting resume');
        setPhase('resuming');
        store.setReconnecting(true);
        store.setReconnectHostName(saved.hostName);
        setStatusMsg(`Reconnecting to ${saved.hostName}...`);

        const ok = await tryResumeConnection(saved);
        store.setReconnecting(false);

        if (ok) {
          setPhase('done');
          store.setView('sessions');
        } else {
          console.log('[jaunt] Resume failed, showing pairing screen');
          setPhase('idle');
        }
      }
    } catch (e: any) {
      console.error('[jaunt] resume check error:', e);
      store.setReconnecting(false);
      setPhase('idle');
    }
  });

  async function pairFromProfile(profile: ConnectionProfile) {
    // Always go through cairn pairing + transport -- no direct WS bypass.
    setPhase('initializing');
    setStatusMsg(`Reaching ${profile.host_name}...`);
    await initNode(profile);

    setPhase('pairing');
    setStatusMsg('Establishing secure channel...');
    let peerId: string;

    if ('Qr' in profile.pairing) {
      // QR pairing payload contains peer ID + connection hints (multiaddrs).
      // cairn stores the hints internally for use during connect().
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
    setStatusMsg('Connecting via cairn transport...');

    // Get the host's libp2p PeerId and listen addresses from the profile.
    // ws_addrs contains cairn multiaddrs (e.g., /ip4/x.x.x.x/tcp/PORT/ws).
    const libp2pPeerId = profile.libp2p_peer_id;
    if (!libp2pPeerId) {
      throw new Error('Profile missing libp2p_peer_id');
    }
    // Try direct addresses first (LAN), fall back to DHT discovery (internet)
    const addrs = getWsMultiaddrs(profile);
    await connectToHost(libp2pPeerId, addrs);
    setPhase('done');
    store.setConnected(true);
    store.setView('sessions');
    history.replaceState(null, '', window.location.pathname);
  }

  async function handlePinPair() {
    const p = pin().trim();
    const addr = hostAddr().trim();
    if (!p) return;

    try {
      // Strategy 1: If host address provided, fetch profile via HTTP
      if (addr) {
        setPhase('initializing');
        setStatusMsg('Fetching connection profile...');
        const host = addr.includes(':') ? addr : `${addr}:9867`;
        const resp = await fetch(`http://${host}/pair?pin=${encodeURIComponent(p)}`);
        if (resp.status === 403) throw new Error('Invalid PIN');
        if (!resp.ok) throw new Error(`Pairing server returned ${resp.status}`);
        const profile: ConnectionProfile = await resp.json();
        await pairFromProfile(profile);
        return;
      }

      // Strategy 2: PIN → DHT provider lookup → PeerId → connect
      // The host registers as a Kademlia provider under HMAC("jaunt-pin-v1", PIN).
      // We query get_providers() to find the host, then connect via peer routing.
      setPhase('initializing');
      setStatusMsg('Starting P2P node...');
      await initNode();

      const { getNode } = await import('../lib/cairn');
      const cairnNode = getNode();
      if (!cairnNode) throw new Error('Node not initialized');

      setPhase('pairing');
      setStatusMsg('Joining P2P network...');
      await cairnNode.startTransport();

      // Give DHT bootstrap a moment
      setStatusMsg('Searching for host on P2P network...');
      await new Promise(r => setTimeout(r, 3000));

      const hostPeerId = await (cairnNode as any).lookupPinOnDht(p);
      if (!hostPeerId) {
        throw new Error('Host not found. Make sure jaunt-host is running and has internet access. It takes ~10 seconds for the host to become discoverable after starting.');
      }

      store.setHostName('Host');
      setPhase('connecting');
      setStatusMsg('Connecting to host...');
      await connectToHost(hostPeerId, []);
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
    <div class="flex-1 flex flex-col items-center justify-center px-5 py-10 relative">
      {/* Brand */}
      <div class="mb-10 text-center" style="animation: viewIn 0.4s cubic-bezier(0.16,1,0.3,1) both">
        <div class="inline-flex items-center gap-2 mb-3">
          <div class="w-8 h-8 rounded-lg bg-amber/15 flex items-center justify-center">
            <div class="w-3 h-3 rounded-sm bg-amber" />
          </div>
          <span class="font-mono text-lg font-600 tracking-widest text-text-0">JAUNT</span>
        </div>
        <p class="text-text-2 text-sm max-w-72 mx-auto leading-relaxed">
          Access your machine's terminal from anywhere.
          <br />Zero infrastructure. End-to-end encrypted.
        </p>
      </div>

      {/* Connection card */}
      <div class="w-full max-w-sm" style="animation: viewIn 0.4s cubic-bezier(0.16,1,0.3,1) 0.08s both">

        {/* Step indicator — teach the user what to do first */}
        <div class="surface-card p-4 mb-3">
          <div class="flex items-start gap-3">
            <div class="w-5 h-5 rounded-full bg-amber/15 flex items-center justify-center shrink-0 mt-0.5">
              <span class="text-[10px] font-700 text-amber">1</span>
            </div>
            <div class="text-xs text-text-2 leading-relaxed">
              On the machine you want to access, run:
              <code class="block font-mono text-text-0 bg-bg-0 px-2.5 py-1.5 rounded-lg mt-1.5 text-[13px] select-all">jaunt-host serve</code>
              <span class="text-text-3 text-[11px] mt-1 block">
                This will display a PIN and QR code.
                <button
                  class="text-amber hover:underline bg-transparent border-none cursor-pointer p-0 ml-0.5"
                  onClick={() => setShowHelp(!showHelp())}
                >
                  {showHelp() ? 'Less' : 'How to install?'}
                </button>
              </span>
            </div>
          </div>

          <Show when={showHelp()}>
            <div class="mt-3 ml-8 text-[11px] text-text-3 leading-relaxed bg-bg-0 rounded-lg p-3 space-y-1" style="animation: viewIn 0.15s ease-out">
              <div><span class="text-text-2">Homebrew:</span> <code class="text-text-1">brew install moukrea/tap/jaunt</code></div>
              <div><span class="text-text-2">Cargo:</span> <code class="text-text-1">cargo install jaunt-host</code></div>
              <div><span class="text-text-2">Binary:</span> <a href="https://github.com/moukrea/jaunt/releases" target="_blank" rel="noopener" class="text-amber hover:underline">Download from GitHub</a></div>
            </div>
          </Show>
        </div>

        {/* PIN entry */}
        <div class="surface-card p-5">
          <div class="flex items-start gap-3 mb-4">
            <div class="w-5 h-5 rounded-full bg-amber/15 flex items-center justify-center shrink-0 mt-0.5">
              <span class="text-[10px] font-700 text-amber">2</span>
            </div>
            <div class="text-xs text-text-2">
              Enter the PIN shown by your host
            </div>
          </div>

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

        {/* QR / Link hint — adaptive to platform */}
        <div class="surface-card p-4 mt-3">
          <Show when={isMobile()}>
            <div class="flex items-start gap-3">
              <svg class="w-4 h-4 shrink-0 mt-0.5 text-text-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              <p class="text-xs text-text-2 leading-relaxed">
                You can also <span class="text-amber font-500">scan the QR code</span> displayed by your host.
                It contains the connection settings — no PIN needed.
              </p>
            </div>
          </Show>
          <Show when={!isMobile()}>
            <div class="flex items-start gap-3">
              <svg class="w-4 h-4 shrink-0 mt-0.5 text-text-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              <p class="text-xs text-text-2 leading-relaxed">
                You can also <span class="text-amber font-500">open the link</span> from your host.
                Copy the URL shown by <code class="font-mono text-[11px] text-text-1 bg-bg-2 px-1 py-0.5 rounded">jaunt-host serve</code> and
                paste it in your browser — it connects automatically.
              </p>
            </div>
          </Show>
        </div>

        {/* Error state */}
        <Show when={phase() === 'error'}>
          <div class="mt-3 p-4 bg-coral/8 border border-coral/20 rounded-xl" style="animation: viewIn 0.2s ease-out">
            <div class="text-sm text-coral font-500 mb-1">Connection failed</div>
            <div class="text-xs text-text-2 mb-2">{errorMsg()}</div>
            <div class="text-[11px] text-text-3 mb-3">
              Make sure <code class="font-mono text-text-2">jaunt-host serve</code> is running on your machine
              and both devices are on the same network (or using Tier 1+ infrastructure).
            </div>
            <button
              class="text-xs text-amber font-500 hover:underline bg-transparent border-none cursor-pointer p-0"
              onClick={() => { setPhase('idle'); setErrorMsg(''); }}
            >
              Try again
            </button>
          </div>
        </Show>

        {/* Footer links */}
        <div class="flex items-center justify-between mt-8">
          <button
            class="text-[11px] text-text-3 hover:text-text-2 transition-colors bg-transparent border-none cursor-pointer"
            onClick={() => store.setView('settings')}
          >
            Advanced settings
          </button>
          <a
            href="https://github.com/moukrea/jaunt"
            target="_blank"
            rel="noopener"
            class="text-text-3 hover:text-text-2 transition-colors"
            title="View on GitHub"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}
