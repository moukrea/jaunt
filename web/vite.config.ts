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
    rollupOptions: {
      // Externalize Node.js-only libp2p deps that exist in cairn-p2p's
      // browser bundle as dead dynamic imports (never called in browser)
      external: [
        /^@libp2p\//,
        /^@chainsafe\//,
        /^libp2p$/,
      ],
    },
  },
  resolve: {
    alias: {
      'cairn-p2p': resolve(__dirname, 'node_modules/cairn-p2p/dist/browser.js'),
    },
  },
});
