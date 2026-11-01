import { defineConfig } from 'vitest/config'

// Node 26 gates localStorage behind --localstorage-file and warns once per worker when
// edge-runtime sets it up, which buried the convex project's output in 23 identical lines.
// Set here rather than in the test script so workers inherit it on any platform; vitest's
// poolOptions.execArgv does not reach them.
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning']
  .filter(Boolean)
  .join(' ')

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
