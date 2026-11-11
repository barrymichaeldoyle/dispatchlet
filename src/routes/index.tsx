import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useSyncExternalStore, type MouseEvent } from 'react'
import { ExampleRun, type ExampleRunHandle } from '../components/example-run'
import { BrandText } from '../components/brand-text'
import { BufferMark } from '../components/brand-icons'
import { SiteFooter } from '../components/site-footer'
import { PostPreview } from '../components/post-preview'
import { RunSteps } from '../components/run-steps'
import { ThemeToggle } from '../components/theme-toggle'
import { Wordmark } from '../components/wordmark'
import { STORIES } from '../lib/example-run'
import { track } from '../integrations/posthog/track'

const SITE_URL = 'https://dispatchlet.com/'
const TITLE = 'Dispatchlet | An agent that writes your Buffer posts'
const DESCRIPTION =
  'Dispatchlet finds new stories on your topic, skips what you’ve already posted, and writes your Buffer posts. Daily or weekly. First 10 runs free.'
const SOURCE_URL = 'https://github.com/barrymichaeldoyle/dispatchlet'

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
      { name: 'twitter:site', content: '@barrymdoyle' },
      { name: 'twitter:creator', content: '@barrymdoyle' },
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
          '@graph': [
            {
              '@type': 'WebSite',
              name: 'Dispatchlet',
              url: SITE_URL,
              description: DESCRIPTION,
              inLanguage: 'en',
            },
            {
              '@type': 'SoftwareApplication',
              name: 'Dispatchlet',
              url: SITE_URL,
              description: DESCRIPTION,
              applicationCategory: 'BusinessApplication',
              operatingSystem: 'Web',
              image: `${SITE_URL}og.png`,
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
                description: 'First 10 runs free, no card needed.',
              },
              author: {
                '@type': 'Person',
                name: 'Barry Michael Doyle',
                url: BUILD_LOG_URL,
                sameAs: [BUILD_LOG_URL, 'https://github.com/barrymichaeldoyle'],
              },
            },
          ],
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
          <div className="landing-header-actions">
            <ThemeToggle name="theme" />
            <a href="/app?signin" className="landing-signin">
              Sign in
            </a>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="landing-main">
        <section className="landing-hero" aria-labelledby="product-title">
          <div className="landing-message">
            <h1 id="product-title">Fresh posts on your topic, researched and written for you.</h1>
            <p className="landing-description">
              <BrandText>
                Dispatchlet finds new stories, skips anything you’ve already posted, and writes a
                post for each channel. They land in Buffer as drafts for you to approve, or it
                schedules them once you trust it.
              </BrandText>
            </p>
            <p className="landing-control">
              Made for accounts that share news about a topic, like a local food page, an F1 fan
              account or a software changelog.
            </p>
            <div className="landing-actions">
              <a
                href="/app?signin"
                id="start"
                className="landing-start"
                data-enhanced={mounted ? 'true' : undefined}
              >
                <BufferMark size={16} />
                Continue with Buffer
              </a>
              <a
                href="#run"
                className="landing-demo-link"
                onClick={playDemo}
                aria-haspopup={mounted ? 'dialog' : undefined}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 3 15 9-15 9Z" fill="currentColor" />
                </svg>
                Watch the demo
              </a>
            </div>
            <p className="landing-notice" aria-live="polite">
              {notice === 'unsubscribed'
                ? 'You are off the list and will not get any more emails from it.'
                : 'Your first 10 runs are free, and no card is needed. After that, use your own Anthropic key, about $0.07 a run.'}
            </p>
            <p className="landing-commit-line">
              <BrandText>
                Starts with a dry run, so nothing reaches Buffer until you’ve seen it. Built on
                Buffer’s public API.
              </BrandText>{' '}
              <a href={SOURCE_URL}>Read the source</a>
            </p>
          </div>
          <figure className="landing-proof flow-writing">
            <PostPreview channel="X" length={HERO_POST.length}>
              {HERO_POST}
            </PostPreview>
            <figcaption>
              <BrandText>{`An example post, written from a ${HERO_STORY.source} story and scheduled in Buffer for ${HERO_STORY.time}.`}</BrandText>
            </figcaption>
          </figure>
        </section>

        <ExampleRun ref={demo} />
        <RunSteps />

        <section className="landing-origin" aria-labelledby="compare-title">
          <h2 id="compare-title">Why not a feed tool or a chatbot?</h2>
          <ul className="landing-compare">
            <li>
              <strong>Feed-to-Buffer tools</strong> post every item in a feed, repeats and weak
              stories included.
            </li>
            <li>
              <strong>AI writing tools</strong> can write the post, but you still have to find the
              story and check you haven’t shared it already.
            </li>
            <li>
              <strong>
                <BrandText>Dispatchlet</BrandText>
              </strong>{' '}
              does the research, checks what you’ve already posted, writes only what’s new, and
              posts less on a slow day.
            </li>
          </ul>
        </section>

        <section className="landing-questions" aria-labelledby="questions-title">
          <h2 id="questions-title">Questions before you start</h2>
          <div>
            <details>
              <summary>Can I review posts before they go out?</summary>
              <p>
                <BrandText>
                  Yes. By default every post is saved as a draft in Buffer for you to approve, and
                  your first run is a dry run that shows what it would post without sending
                  anything. Switch to automatic scheduling when you trust it. You set the sources,
                  voice and rules, and can see what the agent researched and why it kept or skipped
                  a story.
                </BrandText>
              </p>
            </details>
            <details>
              <summary>What does it cost?</summary>
              <p>
                Your first 10 runs are free, with no card. After that, you add your own Anthropic
                API key. Anthropic makes Claude, the AI that does the research and writing, so you
                pay Anthropic directly for what your runs use. That’s about $0.07 a run, or roughly
                $2 a month if it runs daily.{' '}
                <a href="/blog/cost-per-run">See what a run’s cost is made of.</a>
              </p>
              <p>
                If you’d rather not manage a key, a paid plan that covers the AI for you is coming.
                If anything changes for accounts using their own key, you’ll hear about it first.
              </p>
            </details>
            <details>
              <summary>Will the posts sound like AI wrote them?</summary>
              <p>
                Each post follows the voice in your playbook, such as “warm and factual, no hype”,
                and links the story it came from. Change the voice whenever you like, and keep posts
                as drafts until you’re happy with them.
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
              <summary>Does it get better over time?</summary>
              <p>
                <BrandText>
                  Yes. Once a few posts have gone out, it reads how each did in Buffer and writes
                  more like the ones your audience liked. Good stories it didn’t post can go to your
                  Buffer Ideas board, so you can use them later.
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
              <summary>How is my data handled?</summary>
              <p>
                <BrandText>
                  Posts are labelled AI-assisted in Buffer. Your Buffer tokens are encrypted and
                  deleted when you disconnect.
                </BrandText>
              </p>
              <p>
                The app emails you about your runs, and you can turn off the approval emails in
                settings. The <a href="/privacy">privacy policy</a> lists everything that is
                collected and who handles it.
              </p>
            </details>
          </div>
        </section>

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

        <section className="landing-origin" aria-labelledby="tools-title">
          <h2 id="tools-title">Works with Claude and your other tools</h2>
          <div>
            <p>
              Anything you can do in Dispatchlet, you can do from somewhere else. Connect it to
              claude.ai or Claude Code and ask what it posted this week, or tell it to approve a
              draft. Buffer’s own connector works in the same chat, so it can check your queue too.
            </p>
            <figure className="landing-chat" aria-label="An example conversation with Claude">
              <p data-who="you">
                <span>You</span>What did Good News Today post this week, and is anything waiting?
              </p>
              <p data-who="claude">
                <span>Claude</span>Four posts went out. One draft is waiting: sea otters are back in
                the Kent estuary for the first time in 50 years. Approve it?
              </p>
              <p data-who="you">
                <span>You</span>Yes.
              </p>
              <p data-who="claude">
                <span>Claude</span>Approved. It is in the Good News Today queue for 18:00.
              </p>
            </figure>
            <ul className="landing-tools">
              <li>
                <a href="/docs/mcp">An MCP server</a> for claude.ai, Claude Code, Cursor and other
                assistants.
              </li>
              <li>
                <a href="/docs/api">An API</a> with personal tokens, for scripts and no-code tools.
              </li>
              <li>
                <a href="/docs/webhooks">Webhooks</a> when a run finishes, a draft is approved or
                Buffer publishes a post.
              </li>
              <li>
                <a href="/docs/hooks">A URL that starts a run</a>, so a GitHub release can become a
                post.
              </li>
            </ul>
          </div>
        </section>

        <section className="landing-origin" aria-labelledby="commit-title">
          <h2 id="commit-title">Built for Buffer Commit</h2>
          <div>
            <p>
              Dispatchlet is my entry to Buffer Commit, Buffer’s API hackathon, which runs from 28
              October to 13 November 2026. It only uses Buffer’s public API: you sign in with
              Buffer, and your posts go to your own queue or drafts.
            </p>
            <p>
              The repository is tagged where the hackathon started, so you can see exactly what was
              built during it.
            </p>
            <p className="landing-commit-links">
              <a href={COMMITS_URL}>See every commit</a>
              <a href={BUILD_LOG_URL}>Follow the build on X</a>
            </p>
          </div>
        </section>

        <section className="landing-closing" aria-labelledby="closing-title">
          <h2 id="closing-title">Try it on your own topic.</h2>
          <p>
            Answer a few questions, check the dry run, then decide. Your first 10 runs are free.
          </p>
          <div className="landing-closing-actions">
            <a href="/app?signin" className="landing-closing-start">
              <span aria-hidden="true" className="landing-closing-icon">
                <BufferMark size={18} />
              </span>
              Continue with Buffer
            </a>
            <button type="button" className="landing-closing-demo" onClick={playDemo}>
              Watch the demo first
            </button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  )
}
