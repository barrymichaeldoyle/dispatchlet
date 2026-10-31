import { createFileRoute } from '@tanstack/react-router'
import { LegalPage, legalHead } from '../components/legal-page'

export const Route = createFileRoute('/docs')({
  component: Docs,
  head: () =>
    legalHead(
      'How Dispatchlet works',
      'Playbooks, runs, posting modes, limits and the text format, in one page.',
      '/docs',
    ),
})

function Docs() {
  return (
    <LegalPage title="How Dispatchlet works" updated="28 Oct 2026">
      <p>
        Dispatchlet is a research agent for Buffer. You describe what to post about once; on a
        schedule it finds what is new, skips what you have already covered, writes a post for each
        of your channels and puts them in Buffer. This page says what each part does and where the
        limits are.
      </p>

      <h2>Setting up</h2>
      <p>
        Sign in with your Buffer account. There is no separate password: Buffer confirms who you are
        and lets Dispatchlet read your channels and create posts. Your Buffer tokens are stored
        encrypted and only used to do those two things.
      </p>
      <p>
        An automation starts from seven questions: what to research, which channels, anything to
        avoid, preferred sources, when to run, how many stories a run, and whether posts arrive as
        drafts or go into your queue. Six examples fill the answers in with one click. The answers
        that are settings (schedule, channels, story count, posting mode) are kept on the automation
        and can be changed on its Schedule tab.
      </p>

      <h2>The playbook</h2>
      <p>
        From your answers Dispatchlet writes a playbook: the sources to open, the searches to run,
        what counts as worth posting, what to skip, the voice, and a format for each channel. It
        reads the web while writing it, so the sources are real pages. You can edit any of it, as a
        form or as text, and every save is a new version. A run keeps the version it started with.
      </p>
      <p>The text view is a plain document with fixed headings:</p>
      <pre tabIndex={0}>{`# Good News Today

## About
One paragraph on the beat and who reads it.

## Sources
positive.news, Solutions journalism. Check first.
goodnewsnetwork.org

## Searches
Search the web for "conservation success this week".

## Post about
Only stories from the last 2 days.
A measurable outcome, such as a species count.

## Skip
Company press releases.

## Tone
Warm and factual, no hype.
Avoid saying: heartwarming, game-changer.
Emoji: none. Hashtags: none.

## Formats
X: One fact, one line, the link last.
LinkedIn: Three short paragraphs. Up to 1200 characters. Link: the source article`}</pre>
      <p>
        A source line is a site or URL, an optional note after a comma, and “Check first” for the
        ones to open on every run. “Only stories from the last N days” sets how far back a run
        looks. A format line starts with the channel name; “Up to N characters” tightens that
        channel’s limit, “A thread when the story needs one” allows threads, and “Link:” says where
        the link goes. If a line is not understood, the editor names it and keeps the last good
        version.
      </p>

      <h2>A run</h2>
      <p>
        A run has four steps and logs each as it happens. Research opens the playbook’s sources,
        runs its searches and returns the stories it found, with the facts it can stand behind.
        Selection drops anything already covered (by address, then by title) and anything the agent
        is not sure is new and on topic, then keeps up to the number you asked for. Writing makes
        one post per story per channel, within that channel’s limit, and rewrites any that run over.
        Publishing creates each post in Buffer with a Dispatchlet tag.
      </p>
      <p>
        The first run of an automation looks back twice as far as usual, since nothing is covered
        yet. On a quiet day a run keeps nothing and says so; it never pads.
      </p>
      <p>
        A dry run does everything except the last step. The stories and the posts it would have sent
        are on the run page, and nothing reaches Buffer.
      </p>

      <h2>Posting modes</h2>
      <p>
        <strong>Drafts</strong> wait in Buffer until you approve them, from the run page, the home
        page or from a link in the email after each run. <strong>Queue</strong> adds posts to the
        channel’s next free slots. <strong>Spread</strong> schedules them from ten minutes after the
        run, two hours apart. If a channel is at Buffer’s daily posting limit, its posts are skipped
        and the log says so.
      </p>

      <h2>Channels and limits</h2>
      <p>
        Dispatchlet writes for X, LinkedIn, Threads, Bluesky and Mastodon. The limits are the
        services’ own: 280 characters on X, or 25,000 on a Premium account; 3,000 on LinkedIn; 500
        on Threads and Mastodon, or whatever your Mastodon server allows; 300 on Bluesky. A link on
        X counts as 23 characters however long it is. LinkedIn, Threads and Bluesky posts carry the
        story as a link card; on X and Mastodon the link goes after the text.
      </p>

      <h2>Runs, keys and cost</h2>
      <p>
        Every account has 10 free runs and 3 dry runs on Dispatchlet’s key. Adding your own
        Anthropic key in settings lifts the count; you pay Anthropic for what runs use, about 7
        cents a run. Settings shows this month’s runs, cost and posts by channel.
      </p>
      <p>
        Three failed runs in a row pause an automation and send you an email. You can choose to be
        emailed after every run, only when drafts are waiting, only on problems, or never.
      </p>

      <h2>Sharing a run</h2>
      <p>
        Any run can be shared by link. The page shows the log, the stories and the posts, with no
        approve or edit controls. Stop sharing revokes the link.
      </p>

      <h2>Automating Dispatchlet</h2>
      <p>
        Everything above can be driven from outside. <a href="/docs/api">The API</a> does what the
        app does, with personal tokens from settings. <a href="/docs/webhooks">Webhooks</a> tell
        your own tools when a run finishes, a post reaches Buffer, a draft is approved or Buffer
        publishes a post. <a href="/docs/hooks">Inbound hooks</a> start a run from a cron, a Zap or
        a GitHub release, with a story to cover. The <a href="/docs/mcp">MCP server</a> lets Claude
        Code, Claude Desktop or Cursor run research and approve drafts from a chat, beside Buffer’s
        own MCP.
      </p>

      <h2>Where things live</h2>
      <p>
        The source is public under the Elastic License 2.0. The{' '}
        <a href="/privacy">privacy policy</a> lists everything stored and for how long. API tokens
        are stored as a hash and shown once; webhook signing secrets are stored encrypted; webhook
        deliveries are kept for 30 days; inbound hook URLs are stored as a hash.
      </p>
    </LegalPage>
  )
}
