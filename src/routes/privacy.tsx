import { createFileRoute } from '@tanstack/react-router'
import { Contact, LegalPage, legalHead } from '../components/legal-page'

export const Route = createFileRoute('/privacy')({
  component: Privacy,
  head: () =>
    legalHead(
      'Privacy policy',
      'What Dispatchlet collects from the website and the waiting list, why, who handles it and how long it is kept.',
      '/privacy',
    ),
})

function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="18 Oct 2026">
      <p>
        Dispatchlet is run by Barry Michael Doyle, an individual based in South Africa. This policy
        covers dispatchlet.com and the waiting list. The app itself is not open yet. Before it
        opens, this page will be updated to cover Buffer accounts, playbooks and runs, and everyone
        on the waiting list will be told by email.
      </p>

      <h2>What is collected</h2>
      <ul>
        <li>
          Your email address, when you join the waiting list, and the dates you joined, confirmed or
          unsubscribed.
        </li>
        <li>
          If you sign in with Buffer before launch: your Buffer user ID, and the name and email
          address on your Buffer account. Your email address goes on the waiting list as confirmed,
          because Buffer has already verified it. Sign-in asks Buffer for the access the app will
          need to post for you, but until the app opens that access is revoked straight away and
          nothing is kept. Once you can use the app, the access tokens are stored encrypted and
          deleted, and revoked at Buffer, when you disconnect.
        </li>
        <li>
          How you found the site: the campaign tags in the link you followed, or the name of the
          site that linked to you. This shows which posts bring people to the list.
        </li>
        <li>
          A one-way hash of your IP address, used only to stop the form being flooded. Your actual
          IP address is never stored, and the hash is deleted after 7 days.
        </li>
        <li>
          A small number of analytics events: the page was viewed, the form was submitted, an
          address was confirmed. These carry how you found the site, but never your email address.
          Analytics sets no cookies and stores nothing on your device, so each visit is counted
          separately. If your browser sends Do Not Track, no events are recorded. There is no
          session recording.
        </li>
        <li>
          Error reports, if something on the site breaks: the error message, where in the code it
          happened, the page address and your browser type. They never include your email address or
          anything you typed, and they follow the same Do Not Track rule.
        </li>
      </ul>
      <p>
        If you choose light or dark mode or a demo playback speed, that choice is saved in your
        browser and never leaves your device. If you sign in, your session is kept in your browser
        until you sign out.
      </p>

      <h2>How it is used</h2>
      <p>
        Your email address gets 2 emails: one to confirm your place, and one when Dispatchlet opens.
        If you were added by signing in with Buffer, you only get the launch email. Nothing else is
        sent unless you sign up for the app later. Your data is never sold and never used for
        advertising.
      </p>
      <p>
        The legal basis is your consent, which you give by joining the list and can take back at any
        time with the unsubscribe link in either email.
      </p>

      <h2>Who handles it</h2>
      <p>
        These services process the data on Dispatchlet’s behalf, under their own data protection
        terms:
      </p>
      <ul>
        <li>
          Convex stores the waiting list and sign-in sessions. Its servers are in the United States.
        </li>
        <li>Buffer handles sign-in, if you choose to sign in with your Buffer account.</li>
        <li>Resend sends the emails, from the United States.</li>
        <li>PostHog records the analytics events and error reports, in the European Union.</li>
        <li>Cloudflare hosts the site and serves it from its worldwide network.</li>
      </ul>
      <p>
        This means your data leaves South Africa and the European Union. Each of these providers
        commits to safeguards for international transfers in its data processing terms.
      </p>

      <h2>How long it is kept</h2>
      <p>
        The IP hash is deleted after 7 days. Your email address is kept until you ask for it to be
        deleted or the waiting list closes, whichever comes first. If you unsubscribe, a record that
        you unsubscribed is kept so you are not emailed again. Ask and that is deleted too.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see the data held about you, correct it, delete it, or object to how it is
        used. Email <Contact /> and you will get a reply within 30 days.
      </p>
      <p>
        If you are not happy with the answer, you can complain to the{' '}
        <a href="https://inforegulator.org.za">Information Regulator</a> in South Africa, or to the
        data protection authority where you live.
      </p>

      <h2>Contact</h2>
      <p>
        The information officer is Barry Michael Doyle. Questions about this policy go to{' '}
        <Contact />.
      </p>

      <h2>Changes</h2>
      <p>
        When this policy changes, the date at the top changes. If a change affects how your email
        address is used, you will be told by email before it takes effect.
      </p>
    </LegalPage>
  )
}
