import { createFileRoute } from '@tanstack/react-router'
import { Contact, LegalPage, legalHead } from '../components/legal-page'

export const Route = createFileRoute('/terms')({
  component: Terms,
  head: () =>
    legalHead(
      'Terms of use',
      'The terms for using dispatchlet.com, the Dispatchlet waiting list and the Dispatchlet app.',
      '/terms',
    ),
})

function Terms() {
  return (
    <LegalPage title="Terms of use" updated="18 Oct 2026">
      <p>
        Dispatchlet is run by Barry Michael Doyle, an individual based in South Africa. These terms
        apply when you use dispatchlet.com, join the waiting list or use the Dispatchlet app. If you
        do not agree with them, do not use the site or the app.
      </p>
      <p>
        Sign-up for the app opens on 7 November 2026. Until then only invited accounts can use it.
      </p>

      <h2>The waiting list</h2>
      <p>
        Joining is free and commits you to nothing. It does not guarantee access, a price or a
        launch date. Your number on the list shows the order people joined in, nothing more. You can
        leave at any time with the unsubscribe link in any email.
      </p>
      <p>
        Only add your own email address. Do not submit addresses for other people or send automated
        submissions.
      </p>

      <h2>Your account</h2>
      <p>
        You sign in with a Buffer account, and Buffer’s own terms still apply to everything in it.
        Only connect a Buffer account and channels you are allowed to post to. You can disconnect
        Buffer or delete your Dispatchlet account at any time in settings.
      </p>

      <h2>Posts it writes</h2>
      <p>
        Dispatchlet uses AI to find stories and write posts. AI can get facts wrong, misread a
        source or miss context, so check posts before they go out, or choose drafts or approval if
        you want to see every one first. You are responsible for what is published from your
        accounts, including posts Dispatchlet scheduled for you.
      </p>
      <p>The posts are yours. Dispatchlet claims no rights in them.</p>
      <p>
        Do not use Dispatchlet for spam, to mislead people, to impersonate anyone, to infringe
        someone else’s rights, or for anything that breaks the rules of the networks you post to.
      </p>

      <h2>Free runs and limits</h2>
      <p>
        Each account gets 10 free runs and 3 dry runs, paid for by Dispatchlet. After that you can
        add your own Anthropic API key, and runs use your key and are billed to you by Anthropic.
      </p>
      <p>
        Buffer limits how often any app can call it, and that limit is shared by everyone using
        Dispatchlet. So runs can be daily or weekly, and a run may be delayed, or skipped if a daily
        spending limit is reached. The free allowance and these limits may change. If they do, it
        will not take away runs you have already been given.
      </p>

      <h2>The example on the home page</h2>
      <p>
        The example run is an illustration from testing. Real runs depend on your sources and
        settings, and will differ.
      </p>

      <h2>Using the site and app</h2>
      <p>
        Do not try to break, overload or get around the protections or limits on the site or app, or
        use them for anything unlawful. An account that does may be paused or closed.
      </p>
      <p>
        Dispatchlet started as an entry to Buffer Commit, Buffer’s API hackathon. It may change,
        pause or close. If it closes, you will be told by email first and your data will be deleted.
      </p>

      <h2>Buffer</h2>
      <p>
        Dispatchlet is built with the Buffer API. It is not made, endorsed or supported by Buffer.
        Buffer is a trademark of Buffer Inc.
      </p>

      <h2>Source code</h2>
      <p>
        The source code is public under the{' '}
        <a href="https://github.com/barrymichaeldoyle/dispatchlet/blob/main/LICENSE">
          Elastic License 2.0
        </a>
        . That licence covers the code. These terms cover the hosted site.
      </p>

      <h2>No warranty</h2>
      <p>
        The site and app are provided as is, without any promise that they will be available, free
        of errors, or that every run will find or post something. As far as the law allows,
        Dispatchlet is not liable for any indirect or consequential loss from using it. Nothing in
        these terms removes rights you have under consumer protection law where you live.
      </p>

      <h2>Law</h2>
      <p>These terms are governed by the law of South Africa.</p>

      <h2>Changes and contact</h2>
      <p>
        When these terms change, the date at the top changes. Questions go to <Contact />.
      </p>
    </LegalPage>
  )
}
