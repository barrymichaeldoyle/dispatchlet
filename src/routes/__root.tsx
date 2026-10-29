import { BrandText } from '../components/brand-text'
import { Wordmark } from '../components/wordmark'
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
      { rel: 'manifest', href: '/manifest.webmanifest' },
    ],
  }),
  shellComponent: RootDocument,
  // Laid out like the sign-in screen, so a wrong link still lands somewhere that looks finished.
  notFoundComponent: () => (
    <main className="app-gate" id="main-content">
      <div className="app-gate-inner">
        <a href="/" className="app-gate-home" aria-label="Dispatchlet home">
          <Wordmark size="md" />
        </a>
        <p className="app-gate-note not-found-code">404</p>
        <h1>This page isn’t here.</h1>
        <p>
          <BrandText>
            Head back to Dispatchlet to see how a few answers become a day of posts in Buffer.
          </BrandText>
        </p>
        <a href="/" className="app-gate-primary">
          Back to Dispatchlet
        </a>
      </div>
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
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Dispatchlet" />
        <meta name="mobile-web-app-capable" content="yes" />
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
