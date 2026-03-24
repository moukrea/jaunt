import { defineConfig, presetUno, presetIcons } from 'unocss';

export default defineConfig({
  presets: [
    presetUno(),
    presetIcons(),
  ],
  theme: {
    colors: {
      surface: {
        0: '#0a0a0f',
        1: '#12121a',
        2: '#1a1a25',
        3: '#222230',
      },
      accent: '#6366f1',
      success: '#22c55e',
      warning: '#f59e0b',
      danger: '#ef4444',
    },
  },
});
