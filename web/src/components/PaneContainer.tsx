import { Switch, Match, Show, For, createSignal } from 'solid-js';
import { store } from '../lib/store';
import type { PaneLayout, Pane } from '../lib/store';
import { useIsMobile } from '../lib/hooks';
import TerminalPane from './TerminalPane';

interface PaneContainerProps {
  layout: PaneLayout;
  tabId: string;
  onSplit?: (paneId: string, direction: 'horizontal' | 'vertical') => void;
}

export default function PaneContainer(props: PaneContainerProps) {
  const isMobile = useIsMobile();

  return (
    <Show
      when={!isMobile()}
      fallback={<MobilePaneView layout={props.layout} tabId={props.tabId} />}
    >
      <Switch>
        <Match when={props.layout.type === 'single'}>
          <TerminalPane
            pane={(props.layout as Extract<PaneLayout, { type: 'single' }>).pane}
            tabId={props.tabId}
            onSplit={props.onSplit}
          />
        </Match>
        <Match when={props.layout.type === 'hsplit'}>
          <HSplit layout={props.layout as Extract<PaneLayout, { type: 'hsplit' }>} tabId={props.tabId} onSplit={props.onSplit} />
        </Match>
        <Match when={props.layout.type === 'vsplit'}>
          <VSplit layout={props.layout as Extract<PaneLayout, { type: 'vsplit' }>} tabId={props.tabId} onSplit={props.onSplit} />
        </Match>
      </Switch>
    </Show>
  );
}

/** Mobile: show only the focused pane, with a pane selector if multiple panes exist */
function MobilePaneView(props: { layout: PaneLayout; tabId: string }) {
  const allPanes = () => store.collectPanes(props.layout);
  const tab = () => store.tabs().find((t) => t.id === props.tabId);
  const focusedPaneId = () => tab()?.focusedPaneId ?? allPanes()[0]?.id;
  const focusedPane = () => allPanes().find((p) => p.id === focusedPaneId()) ?? allPanes()[0];
  const hasManyPanes = () => allPanes().length > 1;

  function paneName(pane: Pane) {
    return pane.sessionName || pane.sessionId.slice(0, 10);
  }

  return (
    <div class="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Pane selector — only shown when multiple panes exist */}
      <Show when={hasManyPanes()}>
        <div class="flex items-center px-2 py-1 bg-bg-1 border-b border-bg-3/30 shrink-0 gap-2">
          <select
            data-testid="mobile-pane-select"
            class="flex-1 bg-bg-0 border border-bg-3/50 rounded-md px-2 py-1 text-[11px] font-mono text-text-0 outline-none min-w-0 appearance-none"
            style={{
              'background-image': "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M0 0l4 4 4-4' fill='none' stroke='%235a5955' stroke-width='1.2'/%3E%3C/svg%3E\")",
              'background-repeat': 'no-repeat',
              'background-position': 'right 8px center',
              'padding-right': '20px',
            }}
            value={focusedPaneId()}
            onChange={(e) => store.focusPane(e.currentTarget.value)}
          >
            <For each={allPanes()}>
              {(pane, idx) => (
                <option value={pane.id}>Pane {idx() + 1} - {paneName(pane)}</option>
              )}
            </For>
          </select>
          <span class="text-[9px] font-mono text-text-3/60 shrink-0">
            {allPanes().findIndex(p => p.id === focusedPaneId()) + 1} of {allPanes().length}
          </span>
        </div>
      </Show>

      {/* Render only the focused pane -- no split buttons on mobile */}
      <Show when={focusedPane()}>
        <TerminalPane
          pane={focusedPane()!}
          tabId={props.tabId}
          isMobile={true}
        />
      </Show>
    </div>
  );
}

function HSplit(props: {
  layout: Extract<PaneLayout, { type: 'hsplit' }>;
  tabId: string;
  onSplit?: (paneId: string, direction: 'horizontal' | 'vertical') => void;
}) {
  const [dragging, setDragging] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  function leftPaneId(): string {
    return store.collectPanes(props.layout.left)[0]?.id ?? '';
  }

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startRatio = props.layout.ratio;

    function onMove(ev: MouseEvent) {
      if (!containerRef) return;
      const rect = containerRef.getBoundingClientRect();
      const newRatio = Math.max(0.15, Math.min(0.85, startRatio + (ev.clientX - startX) / rect.width));
      store.updateSplitRatio(props.tabId, leftPaneId(), newRatio);
    }
    function onUp() {
      setDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <div ref={containerRef} class="flex-1 flex flex-row min-h-0 min-w-0">
      <div style={{ width: `${props.layout.ratio * 100}%` }} class="flex min-h-0 min-w-0">
        <PaneContainer layout={props.layout.left} tabId={props.tabId} onSplit={props.onSplit} />
      </div>
      {/* Divider with grip */}
      <div
        class={`w-1 shrink-0 cursor-col-resize relative transition-colors duration-100 group/divider ${
          dragging() ? 'bg-amber/50' : 'bg-bg-3/40 hover:bg-amber/30'
        }`}
        onMouseDown={handleMouseDown}
      >
        {/* Grip dots */}
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover/divider:opacity-100 transition-opacity duration-200">
          <div class="w-0.5 h-0.5 rounded-full bg-text-3/40" />
          <div class="w-0.5 h-0.5 rounded-full bg-text-3/40" />
          <div class="w-0.5 h-0.5 rounded-full bg-text-3/40" />
        </div>
      </div>
      <div style={{ width: `${(1 - props.layout.ratio) * 100}%` }} class="flex min-h-0 min-w-0">
        <PaneContainer layout={props.layout.right} tabId={props.tabId} onSplit={props.onSplit} />
      </div>
    </div>
  );
}

function VSplit(props: {
  layout: Extract<PaneLayout, { type: 'vsplit' }>;
  tabId: string;
  onSplit?: (paneId: string, direction: 'horizontal' | 'vertical') => void;
}) {
  const [dragging, setDragging] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  function topPaneId(): string {
    return store.collectPanes(props.layout.top)[0]?.id ?? '';
  }

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    setDragging(true);
    const startY = e.clientY;
    const startRatio = props.layout.ratio;

    function onMove(ev: MouseEvent) {
      if (!containerRef) return;
      const rect = containerRef.getBoundingClientRect();
      const newRatio = Math.max(0.15, Math.min(0.85, startRatio + (ev.clientY - startY) / rect.height));
      store.updateSplitRatio(props.tabId, topPaneId(), newRatio);
    }
    function onUp() {
      setDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <div ref={containerRef} class="flex-1 flex flex-col min-h-0 min-w-0">
      <div style={{ height: `${props.layout.ratio * 100}%` }} class="flex min-h-0 min-w-0">
        <PaneContainer layout={props.layout.top} tabId={props.tabId} onSplit={props.onSplit} />
      </div>
      {/* Divider with grip */}
      <div
        class={`h-1 shrink-0 cursor-row-resize relative transition-colors duration-100 group/divider ${
          dragging() ? 'bg-amber/50' : 'bg-bg-3/40 hover:bg-amber/30'
        }`}
        onMouseDown={handleMouseDown}
      >
        {/* Grip dots */}
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover/divider:opacity-100 transition-opacity duration-200">
          <div class="w-0.5 h-0.5 rounded-full bg-text-3/40" />
          <div class="w-0.5 h-0.5 rounded-full bg-text-3/40" />
          <div class="w-0.5 h-0.5 rounded-full bg-text-3/40" />
        </div>
      </div>
      <div style={{ height: `${(1 - props.layout.ratio) * 100}%` }} class="flex min-h-0 min-w-0">
        <PaneContainer layout={props.layout.bottom} tabId={props.tabId} onSplit={props.onSplit} />
      </div>
    </div>
  );
}
