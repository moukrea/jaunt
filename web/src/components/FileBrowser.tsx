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
        SessionCreate: { shell: null, name: null, cwd: store.currentPath() },
      });
      if ('Ok' in resp) {
        const data = resp.Ok;
        if ('SessionCreated' in (data as any)) {
          const id = (data as any).SessionCreated.id;
          store.addTab(id, undefined);
        }
      }
    } catch (e: any) {
      store.setError(e.message);
    }
  }

  function isDir(et: EntryType): boolean {
    return et === 'Directory';
  }
  function isLink(et: EntryType): boolean {
    return typeof et === 'object' && 'Symlink' in et;
  }

  function handleClick(entry: DirEntry) {
    const fullPath = store.currentPath() + '/' + entry.name;
    if (isDir(entry.entry_type)) {
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
    return entries.filter((e) => !e.hidden);
  };

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} K`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} M`;
    return `${(bytes / 1073741824).toFixed(1)} G`;
  }

  function fileIconColor(entry: DirEntry): string {
    if (isDir(entry.entry_type)) return 'text-amber';
    if (isLink(entry.entry_type)) return 'text-sky';
    const ext = entry.name.split('.').pop()?.toLowerCase();
    if (['rs', 'ts', 'js', 'py', 'go', 'c', 'cpp', 'h'].includes(ext || '')) return 'text-sage';
    if (['jpg', 'png', 'gif', 'svg', 'webp'].includes(ext || '')) return 'text-coral';
    return 'text-text-3';
  }

  const shortPath = () => store.currentPath().replace(/^\/home\/[^/]+/, '~');

  return (
    <div class="flex-1 flex flex-col px-4 pt-4 pb-2 max-w-3xl mx-auto w-full">
      {/* Breadcrumb bar */}
      <div class="flex items-center gap-2 mb-4">
        <button class="btn-ghost text-xs px-2 py-1.5 font-mono" onClick={goUp}>
          ..
        </button>
        <div class="flex-1 bg-bg-1 border border-bg-3/40 rounded-lg px-3 py-2 text-xs font-mono text-text-2 truncate">
          {shortPath()}
        </div>
        <button
          class="flex items-center gap-2 shrink-0 bg-transparent border-none cursor-pointer select-none group"
          onClick={() => store.setShowHidden(!store.showHidden())}
          role="switch"
          aria-checked={store.showHidden()}
        >
          <span class="text-[11px] text-text-3 group-hover:text-text-2 transition-colors">Dotfiles</span>
          <div
            class={`relative w-8 h-[18px] rounded-full transition-colors duration-200 ${
              store.showHidden() ? 'bg-amber' : 'bg-bg-4'
            }`}
          >
            <div
              class={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
                store.showHidden() ? 'translate-x-[16px]' : 'translate-x-[2px]'
              }`}
            />
          </div>
        </button>
        <button class="btn-primary text-xs py-1.5 shrink-0" onClick={openSessionHere}>
          Open here
        </button>
      </div>

      <Show when={loading()}>
        <div class="flex-1 flex items-center justify-center">
          <div class="spinner" />
        </div>
      </Show>

      {/* File list */}
      <div class="flex-1 overflow-y-auto -mx-1 px-1">
        <Show when={!previewContent()}>
          <div class="stagger">
            <For each={visibleEntries()}>
              {(entry) => (
                <button
                  class={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-100 hover:bg-bg-2 active:bg-bg-3 group border-none bg-transparent ${
                    entry.hidden ? 'opacity-50' : ''
                  }`}
                  onClick={() => handleClick(entry)}
                >
                  <span class={`w-4 h-4 shrink-0 ${fileIconColor(entry)}`}>
                    {isDir(entry.entry_type) ? (
                      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>
                    ) : isLink(entry.entry_type) ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    )}
                  </span>
                  <span
                    class={`flex-1 text-sm truncate ${
                      isDir(entry.entry_type)
                        ? 'text-text-0 font-500'
                        : 'text-text-1'
                    }`}
                  >
                    {entry.name}
                  </span>
                  <span class="text-[11px] font-mono text-text-3 w-12 text-right shrink-0">
                    {!isDir(entry.entry_type) ? formatSize(entry.size) : ''}
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* File preview */}
        <Show when={previewContent()}>
          <div class="view-enter">
            <div class="flex items-center justify-between mb-3">
              <span class="text-xs font-mono text-text-2 truncate">{previewPath().split('/').pop()}</span>
              <button
                class="btn-ghost text-xs"
                onClick={() => setPreviewContent(null)}
              >
                Back
              </button>
            </div>
            <div class="surface-raised p-4 overflow-auto max-h-[calc(100dvh-220px)]">
              <pre class="text-xs font-mono text-text-1 leading-relaxed whitespace-pre-wrap m-0">
                {previewContent()}
              </pre>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
