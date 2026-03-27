import { createSignal, onMount, onCleanup } from 'solid-js';

export function useIsMobile() {
  const [isMobile, setIsMobile] = createSignal(
    typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches
  );
  onMount(() => {
    const mql = window.matchMedia('(max-width: 640px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    onCleanup(() => mql.removeEventListener('change', handler));
  });
  return isMobile;
}
