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
    const panes = store.collectPanes(props.layout.left);
    return panes[0]?.id ?? '';
  }

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startRatio = props.layout.ratio;

    function onMove(ev: MouseEvent) {
      if (!containerRef) return;
      const rect = containerRef.getBoundingClientRect();
      const deltaX = ev.clientX - startX;
      const newRatio = Math.max(0.15, Math.min(0.85, startRatio + deltaX / rect.width));
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
      <div
        class={`w-1 shrink-0 cursor-col-resize transition-colors duration-100 ${
          dragging() ? 'bg-amber/60' : 'bg-bg-3/50 hover:bg-amber/40'
        }`}
        onMouseDown={handleMouseDown}
      />
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
    const panes = store.collectPanes(props.layout.top);
    return panes[0]?.id ?? '';
  }

  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    setDragging(true);
    const startY = e.clientY;
    const startRatio = props.layout.ratio;

    function onMove(ev: MouseEvent) {
      if (!containerRef) return;
      const rect = containerRef.getBoundingClientRect();
      const deltaY = ev.clientY - startY;
      const newRatio = Math.max(0.15, Math.min(0.85, startRatio + deltaY / rect.height));
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
      <div
        class={`h-1 shrink-0 cursor-row-resize transition-colors duration-100 ${
          dragging() ? 'bg-amber/60' : 'bg-bg-3/50 hover:bg-amber/40'
        }`}
        onMouseDown={handleMouseDown}
      />
      <div style={{ height: `${(1 - props.layout.ratio) * 100}%` }} class="flex min-h-0 min-w-0">
        <PaneContainer layout={props.layout.bottom} tabId={props.tabId} />
      </div>
    </div>
  );
}
