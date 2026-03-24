import { Show, Switch, Match, createEffect } from 'solid-js';
import { store } from './lib/store';
import PairingScreen from './components/PairingScreen';
import SessionList from './components/SessionList';
import Terminal from './components/Terminal';
import FileBrowser from './components/FileBrowser';
import Settings from './components/Settings';
import StatusBar from './components/StatusBar';

export default function App() {
  return (
    <div class="min-h-dvh flex flex-col bg-bg-0 text-text-1">
      {/* Connected UI */}
      <Show when={store.connected()}>
        {/* Top bar — host identity + connection */}
        <header class="flex items-center justify-between px-4 h-12 bg-bg-1 border-b border-bg-3/40 shrink-0">
          <div class="flex items-center gap-2.5">
            <span class="text-amber font-mono text-xs font-500 tracking-wider">JAUNT</span>
            <span class="text-text-3">/</span>
            <span class="text-sm font-500 text-text-0 truncate max-w-40">{store.hostName()}</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-[10px] font-mono text-text-3 tracking-wide">{store.tier()}</span>
            <div class={`w-1.5 h-1.5 rounded-full ${store.connected() ? 'bg-sage pulse' : 'bg-text-3'}`} />
          </div>
        </header>
      </Show>

      {/* Main content */}
      <main class="flex-1 flex flex-col min-h-0">
        <Switch>
          <Match when={!store.connected()}>
            <PairingScreen />
          </Match>
          <Match when={store.view() === 'sessions'}>
            <div class="view-enter flex-1 flex flex-col"><SessionList /></div>
          </Match>
          <Match when={store.view() === 'terminal'}>
            <Terminal />
          </Match>
          <Match when={store.view() === 'files'}>
            <div class="view-enter flex-1 flex flex-col"><FileBrowser /></div>
          </Match>
          <Match when={store.view() === 'settings'}>
            <div class="view-enter flex-1 flex flex-col"><Settings /></div>
          </Match>
        </Switch>
      </main>

      {/* Bottom navigation — mobile-first, thumb-friendly */}
      <Show when={store.connected() && store.view() !== 'terminal'}>
        <nav class="flex bg-bg-1 border-t border-bg-3/40 shrink-0 safe-area-pb">
          <NavItem view="sessions" label="Sessions" active={store.view() === 'sessions'} />
          <NavItem view="terminal" label="Terminal" active={store.view() === 'terminal'} />
          <NavItem view="files" label="Files" active={store.view() === 'files'} />
          <NavItem view="settings" label="Settings" active={store.view() === 'settings'} />
        </nav>
      </Show>

      {/* Error toast */}
      <Show when={store.error()}>
        <div
          class="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-coral/95 text-white px-4 py-3 rounded-xl text-sm font-500 shadow-xl backdrop-blur-sm cursor-pointer z-50"
          style="animation: viewIn 0.2s ease-out"
          onClick={() => store.setError(null)}
        >
          {store.error()}
        </div>
      </Show>
    </div>
  );
}

function NavItem(props: {
  view: 'sessions' | 'terminal' | 'files' | 'settings';
  label: string;
  active: boolean;
}) {
  return (
    <button
      class={`flex-1 flex flex-col items-center justify-center py-3 gap-0.5 transition-all duration-150 border-none bg-transparent cursor-pointer ${
        props.active
          ? 'text-amber'
          : 'text-text-3 hover:text-text-2 active:text-text-1'
      }`}
      onClick={() => store.setView(props.view)}
    >
      <span class={`text-[11px] font-500 tracking-wide ${props.active ? '' : ''}`}>
        {props.label}
      </span>
      {props.active && (
        <div class="w-4 h-0.5 rounded-full bg-amber mt-0.5" />
      )}
    </button>
  );
}
