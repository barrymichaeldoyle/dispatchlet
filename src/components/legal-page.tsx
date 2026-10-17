import type { ReactNode } from 'react'
import { SiteFooter } from './site-footer'
import { ThemeToggle } from './theme-toggle'
import { Wordmark } from './wordmark'

const CONTACT_EMAIL = 'barry@dispatchlet.com'

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
    ],
    links: [{ rel: 'canonical', href: url }],
  }
}

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string
  updated: string
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
          <ThemeToggle name="theme" />
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="legal-main">
        <h1>{title}</h1>
        <p className="legal-updated">Last updated {updated}.</p>
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}

export function Contact() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
}
