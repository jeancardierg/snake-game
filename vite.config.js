import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/snake-game/',
  build: {
    // three.js is ~700 KB and irreducible for a WebGL app, so the default
    // 500 KB warning is noise here. Split it into its own chunk so it caches
    // independently of app code (app edits don't force a three.js re-download).
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Function form (Vite 8 / rolldown requires a function, not a map).
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
  test: {
    // Use jsdom so React components and browser APIs (canvas, localStorage) are available
    environment: 'jsdom',
    globals: true,
    // Run this setup file before every test suite to configure jest-dom matchers
    setupFiles: './src/test/setup.js',
  },
})
