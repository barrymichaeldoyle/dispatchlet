import { createFileRoute } from '@tanstack/react-router'
import { Contact, LegalPage, legalHead } from '../components/legal-page'

export const Route = createFileRoute('/privacy')({
  component: Privacy,
  head: () =>
    legalHead(
      'Privacy policy',
      'What Dispatchlet collects from the website, the waiting list and the app, why, who handles it and how long it is kept.',
      '/privacy',
    ),
})

function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="18 Oct 2026">
      <p>
        Dispatchlet is run by Barry Michael Doyle, an individual based in South Africa. This policy
        covers dispatchlet.com, the waiting list and the Dispatchlet app. Sign-up for the app opens
        on 7 November 2026. Until then only invited accounts can use it.
      </p>

      <h2>The website and waiting list</h2>
      <ul>
        <li>
          Your email address, when you join the waiting list, and the dates you joined, confirmed or
          unsubscribed.
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
          A small number of analytics events, such as a page being viewed or the form being
          submitted. These carry how you found the site, but never your email address. Analytics
          sets no cookies and stores nothing on your device, so each visit is counted separately. If
          your browser sends Do Not Track, no events are recorded. There is no session recording.
        </li>
        <li>
          Error reports, if something on the site or in the app breaks: the error message, where in
          the code it happened, the page address and your browser type. They never include your
          email address or anything you typed, and they follow the same Do Not Track rule.
        </li>
      </ul>
      <p>
        If you choose light or dark mode or a demo playback speed, that choice is saved in your
        browser and never leaves your device. If you sign in, your session is kept in your browser
        until you sign out.
      </p>

      <h2>The app</h2>
      <p>You sign in with your Buffer account. When you use the app, it stores:</p>
      <ul>
        <li>
          From Buffer: your Buffer user ID, the name and email address on your account, your
          organisations, and the name, picture and network of each connected channel.
        </li>
        <li>
          The access Buffer grants Dispatchlet, as tokens. They are encrypted before they are
          stored, are only decrypted to make a request to Buffer for you, and are deleted, and
          revoked at Buffer, when you disconnect.
        </li>
        <li>
          Your answers to the setup questions, and the playbook written from them: your topic,
          sources, things to avoid, schedule, channels and how posts reach Buffer.
        </li>
        <li>
          A record of each run: what it searched for, the stories it found, which it skipped and
          why, the posts it wrote, and how much AI usage the run took. Stories it has already
          covered are kept so it does not post them twice.
        </li>
        <li>
          For posts Dispatchlet creates in Buffer: the Buffer post ID, its status and, once it is
          sent, the link to it and its engagement numbers. It does not read or store your other
          posts.
        </li>
        <li>
          Your Anthropic API key, if you add one. It is encrypted, used only for your runs, and
          deleted when you remove it.
        </li>
        <li>Your time zone and email settings.</li>
      </ul>
      <p>
        If you sign in before you have been invited, your email address goes on the waiting list as
        confirmed, because Buffer has already verified it. The access Buffer granted is revoked
        straight away and nothing else is kept.
      </p>

      <h2>How it is used</h2>
      <p>
        The waiting list gets 2 emails: one to confirm your place, and one when Dispatchlet opens.
        If you were added by signing in with Buffer, you only get the launch email.
      </p>
      <p>
        The app uses your data only to run your playbooks and show you the results. Its emails are
        about your runs: posts waiting for your approval, a lost Buffer connection, free runs used
        up, or a playbook paused after failed runs. You can turn off the approval emails in
        settings.
      </p>
      <p>
        To research and write, the app sends your playbook, the stories it found and the stories it
        has already covered to Anthropic’s Claude models. Claude searches the web and reads pages
        from Anthropic’s servers, so the sites it visits do not see your details. Posts are marked
        as AI-assisted in Buffer where the network supports it.
      </p>
      <p>Your data is never sold, never used for advertising, and never used to train AI models.</p>
      <p>
        The legal basis for the waiting list is your consent, which you can take back at any time
        with the unsubscribe link in either email. The legal basis for the app is that it is needed
        to provide the service you signed up for.
      </p>

      <h2>Who handles it</h2>
      <p>
        These services process the data on Dispatchlet’s behalf, under their own data protection
        terms:
      </p>
      <ul>
        <li>
          Convex stores the waiting list, accounts, playbooks and runs. Its servers are in the
          United States.
        </li>
        <li>Buffer handles sign-in, and receives the posts the app creates for you.</li>
        <li>
          Anthropic runs the AI models that research and write, in the United States. Its commercial
          terms do not allow it to train models on this data.
        </li>
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
        The IP hash is deleted after 7 days. Your waiting list email address is kept until you ask
        for it to be deleted or the waiting list closes, whichever comes first. If you unsubscribe,
        a record that you unsubscribed is kept so you are not emailed again. Ask and that is deleted
        too.
      </p>
      <p>
        App data is kept while you have an account. Disconnecting Buffer deletes the tokens and
        channels and pauses your playbooks, but keeps their history so you can reconnect. Deleting
        your account in settings deletes everything: your account, playbooks, runs and posts. It
        also revokes Dispatchlet’s access at Buffer. Posts already in Buffer stay there, under your
        control.
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
        When this policy changes, the date at the top changes. If a change affects how your data is
        used, you will be told by email before it takes effect.
      </p>
    </LegalPage>
  )
}
