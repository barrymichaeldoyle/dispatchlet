import { createFileRoute } from '@tanstack/react-router'
import { Wordmark } from '../components/wordmark'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b border-ink px-8">
        <Wordmark size="sm" />
      </header>
      <main className="mx-auto w-full max-w-[1360px] flex-1 px-8 pb-16">
        <section className="flex flex-col gap-6 pt-[72px]">
          <Wordmark size="lg" />
          <h1 className="m-0 max-w-[24ch] text-[32px] leading-[1.2] font-medium tracking-[-0.01em]">
            Your research agent for a fresh Buffer queue.
          </h1>
          <p className="m-0 max-w-[60ch] text-base leading-relaxed">
            Tell Dispatchlet what you post about. It writes a playbook, checks your sources on a
            schedule, writes the posts, and puts them in Buffer as drafts or straight into your
            queue. It remembers what it has already covered, so it never posts the same story twice.
          </p>
          <p className="m-0 text-sm text-muted">Opens 28 October.</p>
        </section>
      </main>
      <footer className="mx-auto w-full max-w-[1360px] px-8 pb-8 text-sm text-muted">
        Built on the Buffer API for Buffer Commit. Not a Buffer product.
      </footer>
    </div>
  )
}
