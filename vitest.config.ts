import path from 'path';
import { defineConfig } from 'vitest/config';

// Dedicated Vitest config — deliberately does NOT load the app's vite.config.ts
// (which pulls in React/Tailwind/PWA plugins we don't need for pure-function tests).
// Mirrors the "@" alias so lib imports resolve identically to the app.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    globals: false,
  },
});
