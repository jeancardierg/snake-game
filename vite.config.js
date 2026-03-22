import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/snake-game/',
  test: {
    // Use jsdom so React components and browser APIs (canvas, localStorage) are available
    environment: 'jsdom',
    globals: true,
    // Run this setup file before every test suite to configure jest-dom matchers
    setupFiles: './src/test/setup.js',
  },
})
