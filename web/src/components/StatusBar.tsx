import { store } from '../lib/store';
import { disconnect } from '../lib/cairn';

export default function StatusBar() {
  function handleDisconnect() {
    disconnect();
    store.setView('pairing');
  }

  return (
    <div class="flex items-center justify-between px-4 py-2 bg-surface-1 border-t border-surface-3 text-xs">
      <div class="flex items-center gap-3">
        <span class={`flex items-center gap-1 ${store.connected() ? 'text-success' : 'text-gray-500'}`}>
          <span class={`w-1.5 h-1.5 rounded-full ${store.connected() ? 'bg-success' : 'bg-gray-500'}`} />
          {store.connected() ? 'Connected' : 'Disconnected'}
        </span>
        <span class="text-gray-500">
          {store.hostName()}
        </span>
        <span class="text-gray-600">
          {store.tier()}
        </span>
      </div>
      <button
        class="text-gray-500 hover:text-gray-300 transition-colors"
        onClick={handleDisconnect}
      >
        Disconnect
      </button>
    </div>
  );
}
