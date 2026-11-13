import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

/**
 * One id per build, shared by the browser code and the Worker built in the same run, so an open
 * tab can tell a deploy has replaced it (src/lib/build-version.ts, /version in src/server.ts).
 */
const BUILD_ID =
  process.env.WORKERS_CI_COMMIT_SHA ?? process.env.GITHUB_SHA ?? Date.now().toString(36)

const config = defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  resolve: { tsconfigPaths: true },
  optimizeDeps: { include: ['posthog-js/dist/module.slim', 'zod'] },
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart({
      pages: ['/', '/privacy', '/terms', '/blog', '/blog/cost-per-run'].map((path) => ({
        path,
        prerender: { enabled: true, crawlLinks: false },
      })),
    }),
    viteReact(),
  ],
})

export default config
