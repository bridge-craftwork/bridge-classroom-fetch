import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/setup/fetchSolverWasm.js'],
    testTimeout: 5000,
  },
})
