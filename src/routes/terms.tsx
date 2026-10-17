import { createFileRoute } from '@tanstack/react-router'
import { Contact, LegalPage, legalHead } from '../components/legal-page'

export const Route = createFileRoute('/terms')({
  component: Terms,
  head: () =>
    legalHead(
      'Terms of use',
      'The terms for using dispatchlet.com and joining the Dispatchlet waiting list.',
      '/terms',
    ),
})

function Terms() {
  return (
    <LegalPage title="Terms of use" updated="17 Oct 2026">
      <p>
        Dispatchlet is run by Barry Michael Doyle, an individual based in South Africa. These terms
        apply when you use dispatchlet.com or join the waiting list. If you do not agree with them,
        do not use the site.
      </p>

      <h2>What exists today</h2>
      <p>
        Right now Dispatchlet is a website and a waiting list. The app is not open yet. These terms
        will be expanded before it opens to cover Buffer accounts, generated posts and usage limits,
        and everyone on the waiting list will be told by email.
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

      <h2>The example on the home page</h2>
      <p>
        The example run is an illustration from testing. Real runs depend on your sources and
        settings, and will differ.
      </p>

      <h2>Using the site</h2>
      <p>
        Do not try to break, overload or get around the protections on the site, or use it for
        anything unlawful.
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
        The site is provided as is, without any promise that it will be available or free of errors.
        As far as the law allows, Dispatchlet is not liable for any indirect or consequential loss
        from using it. Nothing in these terms removes rights you have under consumer protection law
        where you live.
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
