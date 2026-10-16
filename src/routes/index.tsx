import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import { ExampleRun } from '../components/example-run'
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
const TITLE = 'Dispatchlet — Your research agent for a fresh Buffer queue'
const DESCRIPTION =
  'Turn your niche into a fresh Buffer queue. Dispatchlet researches trusted sources, writes channel-ready posts, and saves drafts for your review. Opens 28 October.'

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

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 border-b border-ink px-4 py-1 sm:px-8">
        <Wordmark size="sm" />
        <nav
          aria-label="Main"
          className="flex items-center gap-2 text-[13px] whitespace-nowrap sm:gap-6 sm:text-sm"
        >
          <a href="#run" className="text-ink no-underline hover:underline">
            Example run
          </a>
          <a href={SOURCE_URL} className="text-ink no-underline hover:underline">
            Source
          </a>
          <ThemeToggle />
        </nav>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[1360px] flex-1 flex-col px-4 sm:px-8"
      >
        <section className="grid grid-cols-1 gap-x-8 gap-y-10 border-b border-ink pt-12 pb-10 md:grid-cols-12 md:pt-[72px] md:pb-14">
          <div className="flex flex-col gap-6 md:col-span-7">
            <Wordmark size="lg" />
            <h1 className="m-0 max-w-[24ch] text-[32px] leading-[1.2] font-medium tracking-[-0.01em]">
              Your research agent for a fresh Buffer queue.
            </h1>
            <p className="m-0 max-w-[60ch] text-base leading-[1.6]">
              Tell Dispatchlet what you post about. It writes a playbook, checks your sources on a
              schedule, writes the posts, and puts them in Buffer as drafts or straight into your
              queue. It remembers what it has already covered, so it never posts the same story
              twice.
            </p>
            <div className="relative pt-1">
              <WaitlistForm />
            </div>
            <p className="m-0 text-sm text-muted" aria-live="polite">
              {notice === 'confirmed'
                ? 'Thanks, you are on the list.'
                : notice === 'unsubscribed'
                  ? 'You are off the list and will not get the launch email.'
                  : 'Opens 28 October. Join the list and you will get one email when it does.'}
              {mounted && convexConfigured ? (
                <Suspense fallback={null}>
                  <WaitlistCount />
                </Suspense>
              ) : null}
            </p>
          </div>
          <ol className="m-0 flex list-none flex-col self-end border-t border-rule p-0 text-[15px] leading-[1.55] md:col-span-5">
            {[
              'Write a paragraph about what you post about.',
              'Edit the playbook it writes, then pick a schedule.',
              'Posts show up in Buffer. Approve them from the email, or let them go out.',
            ].map((step, i) => (
              <li
                key={step}
                className="grid grid-cols-[32px_minmax(0,1fr)] border-b border-rule py-3.5"
              >
                <span className="text-muted">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <ExampleRun />

        <section className="grid grid-cols-1 gap-x-8 gap-y-8 border-b border-rule py-10 md:grid-cols-2 md:py-14">
          <div className="flex flex-col gap-3">
            <h2 className="m-0 text-base font-medium">Where it comes from</h2>
            <p className="m-0 max-w-[56ch] text-[15px] leading-[1.6]">
              I run the GrandPrixPicks account on X this way, with a cron job and a text file.
              Dispatchlet is that, for anyone with a Buffer account.
            </p>
            <span className="text-sm text-muted">Barry Doyle</span>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="m-0 text-base font-medium">What it does with your data</h2>
            <p className="m-0 max-w-[56ch] text-[15px] leading-[1.6]">
              Posts are marked as AI-assisted in Buffer. You can see every search it ran and why it
              kept or skipped a story. Your Buffer tokens are encrypted and deleted when you
              disconnect.
            </p>
            <p className="m-0 max-w-[56ch] text-[15px] leading-[1.6]">
              Your email address is used for one confirmation and one launch email. Every email has
              an unsubscribe link.
            </p>
          </div>
        </section>
      </main>
      <footer className="mx-auto flex w-full max-w-[1360px] flex-wrap justify-between gap-x-6 gap-y-2 px-4 pt-6 pb-10 text-sm text-muted sm:px-8">
        <span>Built on the Buffer API for Buffer Commit. Not a Buffer product.</span>
        <span>
          <a href={BARRY_URL} className="text-muted">
            Built in public
          </a>{' '}
          for Buffer Commit.{' '}
          <a href={SOURCE_URL} className="text-muted">
            Source
          </a>{' '}
          is public under the Elastic License 2.0.
        </span>
      </footer>
    </div>
  )
}
