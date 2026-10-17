import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useRef, useSyncExternalStore, type MouseEvent } from 'react'
import { ExampleRun, type ExampleRunHandle } from '../components/example-run'
import { BrandText } from '../components/brand-text'
import { SiteFooter } from '../components/site-footer'
import { RunSteps } from '../components/run-steps'
import { RUN_SECONDS } from '../lib/example-run'
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
  'Dispatchlet researches trusted sources, writes social posts for each channel, and sends drafts or scheduled posts to Buffer. Sign-up opens 7 November.'

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
  const playDemo = (event: MouseEvent<HTMLElement>) => {
    if (!demo.current) return
    event.preventDefault()
    demo.current.play(event.currentTarget)
  }

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
            <a href="#run" className="landing-demo-link" onClick={playDemo}>
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 3 15 9-15 9Z" fill="currentColor" />
              </svg>
              Watch the demo
            </a>
          </div>
          <div className="landing-signup">
            <h2>Get the launch email.</h2>
            <WaitlistForm />
            <p className="landing-notice" aria-live="polite">
              {notice === 'confirmed'
                ? 'Thanks, you are on the list.'
                : notice === 'unsubscribed'
                  ? 'You are off the list and will not get the launch email.'
                  : 'Sign-up opens 7 November. One launch email.'}
              {mounted && convexConfigured ? (
                <Suspense fallback={null}>
                  <WaitlistCount />
                </Suspense>
              ) : null}
            </p>
          </div>
        </section>

        <ExampleRun ref={demo} />
        <RunSteps />

        <section className="landing-origin" aria-labelledby="origin-title">
          <h2 id="origin-title">Why I built it</h2>
          <div>
            <p>
              I run <a href="https://grandprixpicks.com">GrandPrixPicks</a>, an F1 predictions game.
              Keeping its X account current meant the same research every morning. What happened?
              Have we posted it already? Is it worth a post? So I wrote a cron job and a
              hand-written skill file to do it for me.
            </p>
            <p>
              <BrandText>
                Dispatchlet is that setup, rebuilt so anyone with a Buffer account can describe a
                topic once and get the same daily run.
              </BrandText>
            </p>
            <p className="landing-origin-name">Barry Michael Doyle</p>
          </div>
        </section>

        <section className="landing-questions" aria-labelledby="questions-title">
          <h2 id="questions-title">Before you join</h2>
          <div>
            <details>
              <summary>Can I review posts before they go out?</summary>
              <p>
                <BrandText>
                  Yes. By default every post is saved as a draft in Buffer for you to approve.
                  Switch to automatic scheduling when you trust it. You set the sources, voice and
                  rules, and can see what the agent researched and why it kept or skipped a story.
                </BrandText>
              </p>
            </details>
            <details>
              <summary>Which channels does it support?</summary>
              <p>
                <BrandText>
                  X, LinkedIn, Threads, Bluesky and Mastodon, through your Buffer account. Channels
                  that need an image with every post, like Instagram, are not supported yet.
                </BrandText>
              </p>
            </details>
            <details>
              <summary>What does it cost?</summary>
              <p>
                Your first 10 runs are free. After that you can add your own Anthropic API key and
                keep running on it.
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
                unsubscribe link. The <a href="/privacy">privacy policy</a> lists everything that is
                collected and who handles it.
              </p>
            </details>
          </div>
        </section>

        <section className="landing-closing" aria-labelledby="closing-title">
          <h2 id="closing-title">OK, seriously. Watch the demo.</h2>
          <p>
            <BrandText>
              {`${RUN_SECONDS} seconds, from one paragraph to six posts in Buffer. We’ll wait.`}
            </BrandText>
          </p>
          <div className="landing-closing-actions">
            <button type="button" className="landing-closing-play" onClick={playDemo}>
              <span aria-hidden="true" className="landing-closing-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m9 5 11 7-11 7Z" fill="currentColor" />
                </svg>
              </span>
              Watch the full run
            </button>
            <a
              href="#waitlist-email"
              onClick={(event) => {
                const target =
                  document.getElementById('waitlist-email') ??
                  document.querySelector<HTMLElement>('.waitlist-confirmation')
                if (!target) return
                event.preventDefault()
                target.focus({ preventScroll: true })
                target.scrollIntoView({ block: 'center', behavior: 'smooth' })
              }}
            >
              Get the launch email
            </a>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
