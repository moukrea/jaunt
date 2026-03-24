import { Show, Switch, Match } from 'solid-js';
import { store } from './lib/store';
import PairingScreen from './components/PairingScreen';
import SessionList from './components/SessionList';
import Terminal from './components/Terminal';
import FileBrowser from './components/FileBrowser';
import Settings from './components/Settings';
import StatusBar from './components/StatusBar';

export default function App() {
  return (
    <div class="min-h-screen bg-surface-0 text-gray-200 flex flex-col">
      {/* Navigation tabs - shown when connected */}
      <Show when={store.connected()}>
        <nav class="flex bg-surface-1 border-b border-surface-3 px-4">
          <TabButton label="Sessions" view="sessions" />
          <TabButton label="Terminal" view="terminal" />
          <TabButton label="Files" view="files" />
          <TabButton label="Settings" view="settings" />
        </nav>
      </Show>

      {/* Main content */}
      <main class="flex-1 flex flex-col">
        <Switch>
          <Match when={!store.connected()}>
            <PairingScreen />
          </Match>
          <Match when={store.view() === 'sessions'}>
            <SessionList />
          </Match>
          <Match when={store.view() === 'terminal'}>
            <Terminal />
          </Match>
          <Match when={store.view() === 'files'}>
            <FileBrowser />
          </Match>
          <Match when={store.view() === 'settings'}>
            <Settings />
          </Match>
        </Switch>
      </main>

      {/* Status bar - always shown when connected */}
      <Show when={store.connected()}>
        <StatusBar />
      </Show>

      {/* Error toast */}
      <Show when={store.error()}>
        <div class="fixed bottom-16 left-4 right-4 bg-danger/90 text-white px-4 py-2 rounded-lg text-sm"
             onClick={() => store.setError(null)}>
          {store.error()}
        </div>
      </Show>
    </div>
  );
}

function TabButton(props: { label: string; view: 'sessions' | 'terminal' | 'files' | 'settings' }) {
  return (
    <button
      class={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        store.view() === props.view
          ? 'border-accent text-accent'
          : 'border-transparent text-gray-400 hover:text-gray-200'
      }`}
      onClick={() => store.setView(props.view)}
    >
      {props.label}
    </button>
  );
}
