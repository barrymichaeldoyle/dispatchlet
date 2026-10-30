import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'convex',
          include: ['convex/**/*.test.ts'],
          environment: 'edge-runtime',
          server: { deps: { inline: ['convex-test'] } },
          // convex-test runs a whole backend in memory; under load (a dev server rebuilding, the
          // pre-commit hook) a test can pass the 5s default without anything being wrong.
          testTimeout: 20_000,
        },
      },
    ],
  },
})
