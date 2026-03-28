import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import UnoCSS from 'unocss/vite';

export default defineConfig({
  plugins: [
    UnoCSS(),
    solidPlugin(),
  ],
  base: './',
  resolve: {
    alias: {
      // The published cairn-p2p@0.4.1 imports @libp2p/yamux (deprecated).
      // Redirect to the maintained @chainsafe/libp2p-yamux which is already
      // a direct dependency of this project and exports the correct symbols.
      '@libp2p/yamux': '@chainsafe/libp2p-yamux',
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
  },
});
