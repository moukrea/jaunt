import { Switch, Match, createSignal } from 'solid-js';
import { store } from '../lib/store';
import type { PaneLayout } from '../lib/store';
import TerminalPane from './TerminalPane';

interface PaneContainerProps {
  layout: PaneLayout;
  tabId: string;
}

export default function PaneContainer(props: PaneContainerProps) {
  return (
    <Switch>
      <Match when={props.layout.type === 'single'}>
        <TerminalPane
          pane={(props.layout as Extract<PaneLayout, { type: 'single' }>).pane}
          tabId={props.tabId}
        />
      </Match>
      <Match when={props.layout.type === 'hsplit'}>
        <HSplit layout={props.layout as Extract<PaneLayout, { type: 'hsplit' }>} tabId={props.tabId} />
      </Match>
      <Match when={props.layout.type === 'vsplit'}>
        <VSplit layout={props.layout as Extract<PaneLayout, { type: 'vsplit' }>} tabId={props.tabId} />
      </Match>
    </Switch>
  );
}

function HSplit(props: {
  layout: Extract<PaneLayout, { type: 'hsplit' }>;
  tabId: string;
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
        <PaneContainer layout={props.layout.left} tabId={props.tabId} />
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
        <PaneContainer layout={props.layout.right} tabId={props.tabId} />
      </div>
    </div>
  );
}

function VSplit(props: {
  layout: Extract<PaneLayout, { type: 'vsplit' }>;
  tabId: string;
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
        <PaneContainer layout={props.layout.top} tabId={props.tabId} />
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
        <PaneContainer layout={props.layout.bottom} tabId={props.tabId} />
      </div>
    </div>
  );
}
