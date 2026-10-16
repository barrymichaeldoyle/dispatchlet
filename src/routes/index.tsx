import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from 'react'
import { ExampleRun, type ExampleRunHandle } from '../components/example-run'
import { BrandText } from '../components/brand-text'
import { ThemeToggle } from '../components/theme-toggle'
import { WaitlistForm } from '../components/waitlist-form'
import { Wordmark } from '../components/wordmark'
import { convexConfigured } from '../lib/waitlist'
import { track } from '../integrations/posthog/track'

// The optional live count must not delay the landing page or block signup if its chunk fails.
const WaitlistCount = lazy(() =>
  import('../components/waitlist-count')
    .then((module) => ({ default: module.WaitlistCount }))
    .catch(() => ({ default: () => <></> })),
)

const SITE_URL = 'https://dispatchlet.com/'
const TITLE = 'Dispatchlet — Research and social posts, ready for Buffer'
const DESCRIPTION =
  'Dispatchlet researches trusted sources, writes social posts for each channel, and sends drafts or scheduled posts to Buffer. Opens 28 October.'

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: 'description', content: DESCRIPTION },
      { name: 'robots', content: 'index, follow' },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Dispatchlet' },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESCRIPTION },
      { property: 'og:url', content: SITE_URL },
      { property: 'og:image', content: `${SITE_URL}og.png` },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      {
        property: 'og:image:alt',
        content: 'Dispatchlet. Your research agent for a fresh Buffer queue.',
      },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: `${SITE_URL}og.png` },
      {
        name: 'twitter:image:alt',
        content: 'Dispatchlet. Your research agent for a fresh Buffer queue.',
      },
    ],
    links: [{ rel: 'canonical', href: SITE_URL }],
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: 'Dispatchlet',
          url: SITE_URL,
          description: DESCRIPTION,
          inLanguage: 'en',
        }),
      },
    ],
  }),
})

const SOURCE_URL = 'https://github.com/barrymichaeldoyle/dispatchlet'
const BARRY_URL = 'https://x.com/barrymdoyle'

type Notice = 'confirmed' | 'unsubscribed' | null

const noop = () => () => {}

/** True after hydration only, so the server and the first client render agree. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  )
}

function readNotice(): Notice {
  const params = new URLSearchParams(window.location.search)
  if (params.get('confirmed') === '1') return 'confirmed'
  if (params.get('unsubscribed') === '1') return 'unsubscribed'
  return null
}

function useNotice(): { notice: Notice; mounted: boolean } {
  const mounted = useIsClient()
  const notice = mounted ? readNotice() : null
  useEffect(() => {
    track('waitlist_viewed')
    if (readNotice() === 'confirmed') track('waitlist_confirmed')
  }, [])
  return { notice, mounted }
}

function Home() {
  const { notice, mounted } = useNotice()
  const demo = useRef<ExampleRunHandle>(null)

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="landing-header">
        <div className="landing-header-inner">
          <Wordmark size="sm" />
          <ThemeToggle name="theme" />
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="landing-main">
        <section className="landing-hero" aria-labelledby="product-title">
          <div className="landing-message">
            <h1 id="product-title">An agent that researches and writes your social posts.</h1>
            <p className="landing-description">
              <BrandText>
                Tell Dispatchlet your topic. It finds fresh stories, skips what you’ve shared
                before, and sends posts to Buffer.
              </BrandText>
            </p>
            <p className="landing-control">Review drafts, or let it schedule posts for you.</p>
          </div>
          <div className="landing-signup">
            <h2>Get the launch email.</h2>
            <WaitlistForm
              onWatchDemo={(event) => {
                if (!demo.current) return
                event.preventDefault()
                demo.current.play(event.currentTarget)
              }}
            />
            <p className="landing-notice" aria-live="polite">
              {notice === 'confirmed'
                ? 'Thanks, you are on the list.'
                : notice === 'unsubscribed'
                  ? 'You are off the list and will not get the launch email.'
                  : 'Opens 28 October. One launch email.'}
              {mounted && convexConfigured ? (
                <Suspense fallback={null}>
                  <WaitlistCount />
                </Suspense>
              ) : null}
            </p>
          </div>
        </section>

        <ExampleRun ref={demo} />

        <section className="landing-questions" aria-labelledby="questions-title">
          <h2 id="questions-title">Before you join</h2>
          <div>
            <details>
              <summary>Can I review posts before they go out?</summary>
              <p>
                <BrandText>
                  Yes. Save drafts in Buffer for review, or choose automatic scheduling. You set the
                  sources, voice and rules, and can see what the agent researched and why it kept or
                  skipped a story.
                </BrandText>
              </p>
            </details>
            <details>
              <summary>How is my data handled?</summary>
              <p>
                <BrandText>
                  Posts are labeled AI-assisted in Buffer. Your Buffer tokens are encrypted and
                  deleted when you disconnect.
                </BrandText>
              </p>
              <p>
                Your email is used for one confirmation and one launch email. Both include an
                unsubscribe link.
              </p>
            </details>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <span>
          <BrandText>Built with the Buffer API. Not a Buffer product.</BrandText>
        </span>
        <span>
          <a href={BARRY_URL}>Barry Michael Doyle</a>
          <span aria-hidden="true"> · </span>
          <a href={SOURCE_URL}>Source</a> · Elastic License 2.0
        </span>
      </footer>
    </div>
  )
}
