import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Multi-page build: besides "/" (index.html), the IDE must be served at
  // "/ide" WITHOUT the host needing a rewrite rule. A real ide/index.html
  // page makes static hosts (GitHub Pages, nginx, Netlify, ...) serve /ide
  // as a directory index; App.tsx then renders the IDE because the pathname
  // ends with /ide (see isIdePath in landingConfig.ts).
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        ide: 'ide/index.html',
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
  },
})
