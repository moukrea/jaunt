import { defineConfig } from 'vite';
import { resolve } from 'path';
import solidPlugin from 'vite-plugin-solid';
import UnoCSS from 'unocss/vite';

export default defineConfig({
  plugins: [
    UnoCSS(),
    solidPlugin(),
  ],
  base: './',
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
  resolve: {
    alias: {
      'cairn-p2p': resolve(__dirname, 'node_modules/cairn-p2p/dist/index.js'),
    },
  },
});
