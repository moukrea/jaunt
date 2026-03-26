import { Show, Switch, Match, createEffect } from 'solid-js';
import { store } from './lib/store';
import PairingScreen from './components/PairingScreen';
import SessionList from './components/SessionList';
import TerminalWorkspace from './components/TerminalWorkspace';
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
            <a
              href="https://github.com/moukrea/jaunt"
              target="_blank"
              rel="noopener"
              class="text-text-3 hover:text-text-2 transition-colors ml-1"
              title="View on GitHub"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            </a>
          </div>
        </header>
      </Show>

      {/* Main content */}
      <main class="flex-1 flex flex-col min-h-0">
        <Switch>
          <Match when={store.view() === 'settings'}>
            <div class="view-enter flex-1 flex flex-col"><Settings /></div>
          </Match>
          <Match when={!store.connected() && store.view() !== 'settings'}>
            <PairingScreen />
          </Match>
          <Match when={store.view() === 'sessions'}>
            <div class="view-enter flex-1 flex flex-col"><SessionList /></div>
          </Match>
          <Match when={store.view() === 'terminal'}>
            <TerminalWorkspace />
          </Match>
          <Match when={store.view() === 'files'}>
            <div class="view-enter flex-1 flex flex-col"><FileBrowser /></div>
          </Match>
        </Switch>
      </main>

      {/* Bottom navigation — only when connected and not in fullscreen terminal */}
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
