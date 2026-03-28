import { Switch, Match, Show, createSignal, createMemo } from 'solid-js';
import { store } from '../lib/store';
import type { PaneLayout } from '../lib/store';
import { useIsMobile } from '../lib/hooks';
import TerminalPane from './TerminalPane';

interface PaneContainerProps {
  layout: PaneLayout;
  tabId: string;
  onSplit?: (paneId: string, direction: 'horizontal' | 'vertical') => void;
}

export default function PaneContainer(props: PaneContainerProps) {
  const isMobile = useIsMobile();
  // Memoize layout type to ensure Switch/Match re-evaluates when the
  // layout changes from single→hsplit/vsplit in nested splits.
  const layoutType = createMemo(() => props.layout.type);

  return (
    <Show
      when={!isMobile()}
      fallback={<MobilePaneView layout={props.layout} tabId={props.tabId} />}
    >
      <Switch>
        <Match when={layoutType() === 'single'}>
          <TerminalPane
            pane={(props.layout as Extract<PaneLayout, { type: 'single' }>).pane}
            tabId={props.tabId}
            onSplit={props.onSplit}
          />
        </Match>
        <Match when={layoutType() === 'hsplit'}>
          <HSplit layout={props.layout as Extract<PaneLayout, { type: 'hsplit' }>} tabId={props.tabId} onSplit={props.onSplit} />
        </Match>
        <Match when={layoutType() === 'vsplit'}>
          <VSplit layout={props.layout as Extract<PaneLayout, { type: 'vsplit' }>} tabId={props.tabId} onSplit={props.onSplit} />
        </Match>
      </Switch>
    </Show>
  );
}

/** Mobile: show only the focused pane (no splits, no pane selector — that's in TabBar) */
function MobilePaneView(props: { layout: PaneLayout; tabId: string }) {
  const allPanes = () => store.collectPanes(props.layout);
  const tab = () => store.tabs().find((t) => t.id === props.tabId);
  const focusedPaneId = () => tab()?.focusedPaneId ?? allPanes()[0]?.id;
  const focusedPane = () => allPanes().find((p) => p.id === focusedPaneId()) ?? allPanes()[0];

  return (
    <div class="flex-1 flex flex-col min-h-0 min-w-0">
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
