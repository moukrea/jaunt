import { defineConfig, presetUno, presetIcons } from 'unocss';

export default defineConfig({
  presets: [presetUno(), presetIcons()],
  theme: {
    colors: {
      // Warm charcoal palette — not blue-black, actual warm dark
      bg: {
        0: '#0c0c0e',
        1: '#141417',
        2: '#1c1c21',
        3: '#252529',
        4: '#2e2e34',
      },
      // Warm amber accent — distinctive, not cliched purple/blue
      amber: {
        DEFAULT: '#e8a245',
        dim: '#d4943a',
        glow: '#e8a24520',
        surface: '#e8a24510',
      },
      // Muted palette for status
      sage: '#7dba6e',
      coral: '#e06c5a',
      sky: '#6ba3d6',
      muted: '#6b6b74',
      // Text hierarchy
      text: {
        0: '#eae8e3',
        1: '#c8c5bd',
        2: '#8a8880',
        3: '#5a5955',
      },
    },
    fontFamily: {
      sans: "'DM Sans', system-ui, sans-serif",
      mono: "'JetBrains Mono', 'Fira Code', monospace",
    },
  },
  shortcuts: {
    'surface-card': 'bg-bg-1 border border-bg-3/50 rounded-xl',
    'surface-raised': 'bg-bg-2 border border-bg-3/60 rounded-lg',
    'btn-primary': 'bg-amber text-bg-0 font-600 rounded-lg px-4 py-2.5 text-sm hover:brightness-110 active:brightness-95 transition-all duration-150 cursor-pointer border-none',
    'btn-ghost': 'bg-transparent text-text-2 rounded-lg px-3 py-2 text-sm hover:bg-bg-2 hover:text-text-1 active:bg-bg-3 transition-all duration-150 cursor-pointer border-none',
    'btn-danger': 'bg-transparent text-coral rounded-lg px-3 py-2 text-sm hover:bg-coral/10 active:bg-coral/15 transition-all duration-150 cursor-pointer border-none',
    'input-field': 'w-full bg-bg-0 border border-bg-3 rounded-lg px-3.5 py-2.5 text-sm text-text-1 placeholder-text-3 outline-none focus:border-amber/50 focus:ring-1 focus:ring-amber/20 transition-all duration-150',
    'label-text': 'block text-xs font-500 text-text-2 mb-1.5 tracking-wide uppercase',
  },
});
