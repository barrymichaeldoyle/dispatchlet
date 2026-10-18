import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useRef, useSyncExternalStore, type MouseEvent } from 'react'
import { ExampleRun, type ExampleRunHandle } from '../components/example-run'
import { BrandText } from '../components/brand-text'
import { SiteFooter } from '../components/site-footer'
import { PostPreview } from '../components/post-preview'
import { RunSteps } from '../components/run-steps'
import { ThemeToggle } from '../components/theme-toggle'
import { WaitlistForm } from '../components/waitlist-form'
import { Wordmark } from '../components/wordmark'
import { STORIES } from '../lib/example-run'
import { convexConfigured } from '../lib/waitlist'
import { track } from '../integrations/posthog/track'

// The optional live count must not delay the landing page or block signup if its chunk fails.
const WaitlistCount = lazy(() =>
  import('../components/waitlist-count')
    .then((module) => ({ default: module.WaitlistCount }))
    .catch(() => ({ default: () => <></> })),
)

const SITE_URL = 'https://dispatchlet.com/'
const TITLE = 'Dispatchlet | An agent that researches and writes your Buffer posts'
const DESCRIPTION =
  'Keep your account posting about your topic and save hours of research every week. Daily or weekly, Dispatchlet finds new stories, skips what you’ve already posted, and writes the posts for Buffer. Sign-up opens 7 November.'

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
        content:
          'Dispatchlet: an agent that researches and writes your Buffer posts. Built for Buffer Commit.',
      },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: TITLE },
      { name: 'twitter:description', content: DESCRIPTION },
      { name: 'twitter:image', content: `${SITE_URL}og.png` },
      {
        name: 'twitter:image:alt',
        content:
          'Dispatchlet: an agent that researches and writes your Buffer posts. Built for Buffer Commit.',
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

/** The outcome, above the fold: one post it wrote and scheduled, from the demo's run. */
const [HERO_STORY] = STORIES
const [, HERO_POST] = HERO_STORY.posts[0]

const BUILD_LOG_URL = 'https://x.com/barrymdoyle'
const COMMITS_URL = 'https://github.com/barrymichaeldoyle/dispatchlet/commits/main'

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
  // `/?demo` (linked from the app's launch-list screen) opens straight into the demo.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('demo')) return
    url.searchParams.delete('demo')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    const opener = document.querySelector<HTMLElement>('.flow-launch-action')
    if (demo.current && opener) demo.current.play(opener)
  }, [])

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="landing-header">
        <div className="landing-header-inner">
          <Wordmark size="md" />
          <ThemeToggle name="theme" />
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="landing-main">
        <section className="landing-hero" aria-labelledby="product-title">
          <div className="landing-message">
            <h1 id="product-title">An agent that researches and writes your Buffer posts.</h1>
            <p className="landing-description">
              <BrandText>
                Keep your account posting about your topic and save hours of research every week.
                Daily or weekly, Dispatchlet finds new stories, skips anything you’ve already
                posted, and writes the posts for Buffer.
              </BrandText>
            </p>
            <p className="landing-control">
              Set it up once with a few quick questions, then review posts as drafts in Buffer or
              let it schedule them. Made for accounts that share news about a topic, like a local
              food page, an F1 fan account or a software company.
            </p>
            <a href="#run" className="landing-demo-link" onClick={playDemo}>
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 3 15 9-15 9Z" fill="currentColor" />
              </svg>
              Watch the demo
            </a>
            <p className="landing-commit-line">
              Built in public for Buffer Commit, Buffer’s API hackathon.{' '}
              <a href={BUILD_LOG_URL}>Follow the build</a>
            </p>
          </div>
          <div className="landing-signup">
            <figure className="landing-proof flow-writing">
              <PostPreview channel="X" length={HERO_POST.length}>
                {HERO_POST}
              </PostPreview>
              <figcaption>
                <BrandText>{`An example post, written from a ${HERO_STORY.source} story and scheduled in Buffer for ${HERO_STORY.time}.`}</BrandText>
              </figcaption>
            </figure>
            <h2>Get the launch email.</h2>
            <WaitlistForm />
            <p className="landing-notice" aria-live="polite">
              {notice === 'confirmed'
                ? 'Thanks, you are on the list.'
                : notice === 'unsubscribed'
                  ? 'You are off the list and will not get the launch email.'
                  : 'Sign-up opens 7 November. You’ll get one email when it does.'}
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
              Keeping its X account current meant the same research twice a day: checking what had
              happened, whether we’d already posted it, and whether it was worth a post at all. So I
              wrote a script to do it for me.
            </p>
            <p>
              <BrandText>
                Dispatchlet is that script, rebuilt so anyone with a Buffer account can set it up
                with a few questions and have it run on their own schedule.
              </BrandText>
            </p>
            <p className="landing-origin-name">Barry Michael Doyle</p>
          </div>
        </section>

        <section className="landing-origin" aria-labelledby="commit-title">
          <h2 id="commit-title">Built for Buffer Commit</h2>
          <div>
            <p>
              Buffer Commit is Buffer’s API hackathon, and Dispatchlet is my entry. It only uses
              Buffer’s public API: you sign in with Buffer, and your posts go to your own queue or
              drafts.
            </p>
            <p>
              I’m building it between 28 October and 13 November and posting progress on X as I go.
              This page and the project setup came first, and the repository is tagged where the
              hackathon starts, so you can see exactly what was built during it.
            </p>
            <p className="landing-commit-links">
              <a href={COMMITS_URL}>See every commit</a>
              <a href={BUILD_LOG_URL}>Follow the build on X</a>
            </p>
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
              <summary>What if there isn’t enough news?</summary>
              <p>
                It posts less. If only one story is new and worth sharing, you get one. It never
                pads a quiet day with repeats or weak stories.
              </p>
            </details>
            <details>
              <summary>Do I need a Buffer account?</summary>
              <p>
                <BrandText>
                  Yes. You sign in with Buffer, so there is no separate account to create, and posts
                  go straight to the channels you already have connected there.
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
                Your first 10 runs are free. After that, add your own Anthropic API key and
                Dispatchlet runs on your key.
              </p>
            </details>
            <details>
              <summary>How is my data handled?</summary>
              <p>
                <BrandText>
                  Posts are labelled AI-assisted in Buffer. Your Buffer tokens are encrypted and
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
              {'From a few answers to posts in Buffer, today and every day after. We’ll\u00a0wait.'}
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
