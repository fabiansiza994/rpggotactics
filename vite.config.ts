/// <reference types="vitest/config" />
import { performanceBudget } from './build/performanceBudget.ts';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), performanceBudget()],
  // PixiJS alone is ~500 kB minified; the game code is small.
  build: { chunkSizeWarningLimit: 900 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Store suites about other features start like an existing player (open roster, no guest
    // cap). The onboarding suites turn it off with vi.stubEnv to exercise the real rules.
    env: { VITE_OPEN_PROGRESSION: '1' },
  },
});
