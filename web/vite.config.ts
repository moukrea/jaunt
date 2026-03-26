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
      // @libp2p/yamux has a broken dep on @libp2p/utils (missing AbstractStream).
      // Use the maintained @chainsafe/libp2p-yamux which is API-compatible.
      '@libp2p/yamux': resolve(__dirname, 'node_modules/@chainsafe/libp2p-yamux'),
      // Ensure cairn-p2p's external deps resolve to this app's node_modules
      '@chainsafe/libp2p-yamux': resolve(__dirname, 'node_modules/@chainsafe/libp2p-yamux'),
    },
  },
});
