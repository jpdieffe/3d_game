import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
  // Ensure PeerJS globals are available
  define: {
    global: 'globalThis',
  },
})
