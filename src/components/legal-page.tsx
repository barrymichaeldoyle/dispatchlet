import type { ReactNode } from 'react'
import { SiteFooter } from './site-footer'
import { ThemeToggle } from './theme-toggle'
import { Wordmark } from './wordmark'

const CONTACT_EMAIL = 'barry@dispatchlet.com'
/** The site's share card, the same one the landing page uses. */
const OG_IMAGE = 'https://dispatchlet.com/og.png?v=3'

/** Head tags for a legal page, so both pages are described and indexed the same way. */
export function legalHead(title: string, description: string, path: string) {
  const url = `https://dispatchlet.com${path}`
  return {
    meta: [
      { title: `${title} | Dispatchlet` },
      { name: 'description', content: description },
      { name: 'robots', content: 'index, follow' },
      { property: 'og:title', content: `${title} | Dispatchlet` },
      { property: 'og:description', content: description },
      { property: 'og:url', content: url },
      { property: 'og:type', content: 'article' },
      { property: 'og:site_name', content: 'Dispatchlet' },
      { property: 'og:image', content: OG_IMAGE },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:site', content: '@barrymdoyle' },
      { name: 'twitter:title', content: `${title} | Dispatchlet` },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: OG_IMAGE },
    ],
    links: [{ rel: 'canonical', href: url }],
  }
}

export function LegalPage({
  title,
  updated,
  published,
  children,
}: {
  title: string
  /** Policies and docs say when they last changed; a blog post says when it went up. */
  updated?: string
  published?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="landing-header">
        <div className="landing-header-inner">
          <a href="/" className="legal-home">
            <Wordmark size="md" />
          </a>
          <div className="landing-header-actions">
            <ThemeToggle name="theme" />
            <a href="/app?signin" className="landing-signin">
              Sign in
            </a>
          </div>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="legal-main">
        <h1>{title}</h1>
        <p className="legal-updated">
          {published
            ? `Published ${published} by Barry Michael Doyle.`
            : `Last updated ${updated}.`}
        </p>
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}

export function Contact() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
}
