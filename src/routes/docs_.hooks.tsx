import { createFileRoute } from '@tanstack/react-router'
import { LegalPage, legalHead } from '../components/legal-page'

export const Route = createFileRoute('/docs_/hooks')({
  component: HookDocs,
  head: () =>
    legalHead(
      'Inbound hooks',
      'Start a Dispatchlet run from a cron, a Zap or a GitHub release, and tell it what to cover.',
      '/docs/hooks',
    ),
})

function HookDocs() {
  return (
    <LegalPage title="Inbound hooks" updated="29 Oct 2026">
      <p>
        An inbound hook is a URL that starts a run of one automation when anything POSTs to it. It
        needs no header, so it works from places that cannot set one: GitHub, a cron, a Zap, a
        shortcut. Make one under Settings → Inbound hooks, or with <code>POST /api/v1/hooks</code>.
        The URL is shown once and holds the secret, so treat it like a password.
      </p>
      <pre>{`https://dispatchlet.com/api/v1/hooks/dlh_…`}</pre>

      <h2>What to send</h2>
      <p>
        <strong>Nothing</strong>, or an empty JSON object: a plain run, as if you pressed Run now.{' '}
        <strong>A story</strong>: a JSON object with a <code>title</code>, and optionally a{' '}
        <code>url</code> and <code>notes</code>. The research step opens the URL if given, treats it
        as a story to cover whatever its date, and writes it in your playbook’s voice. If the
        automation already covered it, it is skipped as a duplicate and the log says so, so a hook
        that fires twice does not post twice. Add <code>"dry": true</code>, or <code>?dry=1</code>{' '}
        to the URL, to see what it would post without sending anything to Buffer. Use the URL form
        for GitHub, whose body you cannot change.
      </p>
      <pre>{`curl -X POST https://dispatchlet.com/api/v1/hooks/dlh_… \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Dispatchlet 1.2 is out", "url": "https://github.com/barrymichaeldoyle/dispatchlet/releases/tag/v1.2.0", "notes": "Webhooks and an MCP server"}'

{ "run": { "id": "…", "url": "https://dispatchlet.com/app/a/…/runs/…" } }`}</pre>
      <p>
        The response is 202 with the run; the run page link shows it live. 409 means a run is
        already going, 402 that the free allowance is spent. A hook takes ten requests a minute.
      </p>

      <h2>GitHub releases</h2>
      <p>
        In a repository, Settings → Webhooks → Add webhook: the hook URL as Payload URL, content
        type <code>application/json</code>, no secret needed, and under “Let me select individual
        events” tick only <strong>Releases</strong>. Each <em>published</em> release then starts a
        run whose first story is the release: its name, link and notes. Pre-releases and drafts are
        ignored. The GitHub “ping” when you save the webhook is answered without starting a run.
      </p>

      <h2>A cron</h2>
      <p>
        Dispatchlet already runs daily or weekly on its own schedule. A hook is for the times in
        between: a GitHub Actions job after a deploy, a Zap when a row lands in a sheet, a Shortcut
        on your phone.
      </p>
      <pre>{`# .github/workflows/announce.yml
on:
  release:
    types: [published]
jobs:
  announce:
    runs-on: ubuntu-latest
    steps:
      - run: >
          curl -fsS -X POST "\${{ secrets.DISPATCHLET_HOOK_URL }}"
          -H "Content-Type: application/json"
          -d '{"title": "\${{ github.event.release.name }}", "url": "\${{ github.event.release.html_url }}"}'`}</pre>
    </LegalPage>
  )
}
