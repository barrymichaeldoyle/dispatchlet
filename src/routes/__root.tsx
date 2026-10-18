import { BrandText } from '../components/brand-text'
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import PostHogProvider from '../integrations/posthog/provider'
import { THEME_SCRIPT } from '../lib/theme'

import appCss from '../styles.css?url'
import fontUrl from '../assets/fonts/schibsted-grotesk-latin.woff2?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Page not found | Dispatchlet' },
      { name: 'robots', content: 'noindex, follow' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'preload', href: fontUrl, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <main className="not-found" id="main-content">
      <p>404</p>
      <h1>This page isn’t here.</h1>
      <p>
        <BrandText>
          Head back to Dispatchlet to see how one brief becomes a day of posts in Buffer.
        </BrandText>
      </p>
      <a href="/">
        <BrandText>Back to Dispatchlet</BrandText>
      </a>
    </main>
  ),
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Written here, not in head(): the router keeps one meta per name, which dropped one. */}
        <meta name="theme-color" content="#f4f4f1" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#161616" media="(prefers-color-scheme: dark)" />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <PostHogProvider>
          {children}
          {import.meta.env.DEV ? (
            <TanStackDevtools
              config={{ position: 'bottom-right' }}
              plugins={[
                {
                  name: 'Tanstack Router',
                  render: <TanStackRouterDevtoolsPanel />,
                },
              ]}
            />
          ) : null}
        </PostHogProvider>
        <Scripts />
      </body>
    </html>
  )
}
