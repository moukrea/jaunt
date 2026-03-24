import { createSignal, onMount, For, Show } from 'solid-js';
import { sendRpc } from '../lib/cairn';
import { store } from '../lib/store';
import type { DirEntry, EntryType } from '../lib/protocol';

export default function FileBrowser() {
  const [loading, setLoading] = createSignal(false);
  const [previewContent, setPreviewContent] = createSignal<string | null>(null);
  const [previewPath, setPreviewPath] = createSignal('');

  onMount(() => browsePath(store.currentPath()));

  async function browsePath(path: string) {
    setLoading(true);
    setPreviewContent(null);
    try {
      const resp = await sendRpc({ FileBrowse: { path, show_hidden: store.showHidden() } });
      if ('Ok' in resp) {
        const data = resp.Ok;
        if ('DirListing' in (data as any)) {
          const listing = (data as any).DirListing;
          store.setCurrentPath(listing.path);
          store.setDirEntries(listing.entries);
        }
      } else if ('Error' in resp) {
        store.setError(resp.Error.message);
      }
    } catch (e: any) {
      store.setError(e.message);
    }
    setLoading(false);
  }

  async function previewFile(path: string) {
    try {
      const resp = await sendRpc({ FilePreview: { path, max_bytes: 65536 } });
      if ('Ok' in resp) {
        const data = resp.Ok;
        if ('FilePreview' in (data as any)) {
          const preview = (data as any).FilePreview;
          setPreviewContent(preview.content);
          setPreviewPath(preview.path);
        }
      }
    } catch (e: any) {
      store.setError(e.message);
    }
  }

  async function openSessionHere() {
    try {
      const resp = await sendRpc({
        SessionCreate: { shell: undefined, name: undefined, cwd: store.currentPath() },
      });
      if ('Ok' in resp) {
        const data = resp.Ok;
        if ('SessionCreated' in (data as any)) {
          const id = (data as any).SessionCreated.id;
          store.setCurrentSession(id);
          store.setView('terminal');
        }
      }
    } catch (e: any) {
      store.setError(e.message);
    }
  }

  function entryTypeName(et: EntryType): string {
    if (et === 'File') return 'file';
    if (et === 'Directory') return 'dir';
    if (typeof et === 'object' && 'Symlink' in et) return 'link';
    return '?';
  }

  function handleClick(entry: DirEntry) {
    const fullPath = store.currentPath() + '/' + entry.name;
    if (entry.entry_type === 'Directory') {
      browsePath(fullPath);
    } else {
      previewFile(fullPath);
    }
  }

  function goUp() {
    const parts = store.currentPath().split('/');
    parts.pop();
    browsePath(parts.join('/') || '/');
  }

  const visibleEntries = () => {
    const entries = store.dirEntries();
    if (store.showHidden()) return entries;
    return entries.filter(e => !e.hidden);
  };

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }

  return (
    <div class="flex-1 flex flex-col p-4 max-w-4xl mx-auto w-full">
      {/* Toolbar */}
      <div class="flex items-center gap-2 mb-4">
        <button
          class="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 rounded text-sm"
          onClick={goUp}
        >
          ..
        </button>
        <div class="flex-1 bg-surface-1 rounded px-3 py-1.5 text-sm font-mono text-gray-300 truncate">
          {store.currentPath()}
        </div>
        <label class="flex items-center gap-1 text-sm text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={store.showHidden()}
            onChange={() => store.setShowHidden(!store.showHidden())}
            class="accent-accent"
          />
          Hidden
        </label>
        <button
          class="px-3 py-1.5 bg-accent hover:bg-accent/80 rounded text-sm font-medium"
          onClick={openSessionHere}
        >
          Open session here
        </button>
      </div>

      <Show when={loading()}>
        <div class="text-center text-gray-500 py-8">Loading...</div>
      </Show>

      {/* File list */}
      <div class="flex-1 overflow-auto">
        <Show when={!previewContent()}>
          <div class="space-y-0.5">
            <For each={visibleEntries()}>
              {(entry) => (
                <div
                  class="flex items-center gap-3 px-3 py-2 rounded hover:bg-surface-1 cursor-pointer transition-colors"
                  onClick={() => handleClick(entry)}
                >
                  <span class={`text-xs w-8 ${
                    entry.entry_type === 'Directory' ? 'text-accent' :
                    entryTypeName(entry.entry_type) === 'link' ? 'text-warning' : 'text-gray-500'
                  }`}>
                    {entry.entry_type === 'Directory' ? 'DIR' :
                     entryTypeName(entry.entry_type) === 'link' ? 'LNK' : ''}
                  </span>
                  <span class={`flex-1 text-sm ${entry.hidden ? 'text-gray-500' : ''}`}>
                    {entry.name}
                  </span>
                  <span class="text-xs text-gray-500 w-20 text-right">
                    {entry.entry_type !== 'Directory' ? formatSize(entry.size) : ''}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* File preview */}
        <Show when={previewContent()}>
          <div class="bg-surface-1 rounded-lg p-4">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-mono text-gray-400">{previewPath()}</span>
              <button
                class="text-xs text-gray-500 hover:text-gray-300"
                onClick={() => setPreviewContent(null)}
              >
                Close
              </button>
            </div>
            <pre class="text-sm font-mono text-gray-300 overflow-auto max-h-96 whitespace-pre-wrap">
              {previewContent()}
            </pre>
          </div>
        </Show>
      </div>
    </div>
  );
}
