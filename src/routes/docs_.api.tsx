import { createFileRoute } from '@tanstack/react-router'
import { ROUTES, WEBHOOK_EVENT_DOCS } from '../../convex/api/reference'
import { LegalPage, legalHead } from '../components/legal-page'

export const Route = createFileRoute('/docs_/api')({
  component: ApiDocs,
  head: () =>
    legalHead(
      'The Dispatchlet API',
      'Personal tokens, every route, errors and rate limits, with curl examples.',
      '/docs/api',
    ),
})

const ERRORS: [string, string, string][] = [
  ['401', 'unauthorized', 'No token, or a revoked one.'],
  ['403', 'forbidden', 'A read token on a route that writes.'],
  ['404', 'not_found', 'No such route, or an id that is not yours.'],
  [
    '400',
    'invalid',
    'The body or query is wrong; `field` names which part, `line` for a playbook.',
  ],
  ['409', 'conflict', 'A run is already going for that automation.'],
  ['402', 'allowance', 'No free runs left. Add your own Anthropic key in settings.'],
  [
    '429',
    'rate_limited',
    '60 requests a minute per token, 1,000 an hour per account. `Retry-After` says how long.',
  ],
  ['502', 'buffer', 'Buffer refused the call; the message is passed through.'],
  ['503', 'unavailable', 'Something on our side. Try again.'],
]

function ApiDocs() {
  return (
    <LegalPage title="The Dispatchlet API" updated="29 Oct 2026">
      <p>
        Everything you can do in the app, over HTTPS with JSON. Base URL{' '}
        <code>https://dispatchlet.com/api/v1</code>. The machine-readable version is{' '}
        <a href="/api/v1/openapi.json">openapi.json</a>. Webhooks are on{' '}
        <a href="/docs/webhooks">their own page</a>, as is the <a href="/docs/mcp">MCP server</a>{' '}
        and the <a href="/docs/hooks">inbound hook</a>.
      </p>

      <h2>Tokens</h2>
      <p>
        Make one under Settings → API tokens. It is shown once. Send it on every request as{' '}
        <code>Authorization: Bearer dl_…</code>. A <strong>read</strong> token can only GET; a{' '}
        <strong>write</strong> token can also create, change, start runs and approve. Revoking a
        token stops it on the next request. A token acts as you: runs it starts count against your
        allowance, and it can never see another account.
      </p>
      <pre>{`curl https://dispatchlet.com/api/v1/me \\
  -H "Authorization: Bearer dl_…"`}</pre>

      <h2>Conventions</h2>
      <p>
        Ids are strings. Times are Unix milliseconds in fields ending <code>At</code>. Every
        response carries <code>X-RateLimit-Limit</code>, <code>-Remaining</code> and{' '}
        <code>-Reset</code> (Unix seconds). An error comes back with a code and a message, and a{' '}
        <code>field</code> or <code>line</code> when one applies:
      </p>
      <pre>{`{ "error": { "code": "invalid", "message": "maxPostsPerRun: Too big", "field": "maxPostsPerRun" } }`}</pre>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Code</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {ERRORS.map(([status, code, when]) => (
            <tr key={code}>
              <td>{status}</td>
              <td>
                <code>{code}</code>
              </td>
              <td>{when}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Starting a run returns 202 at once. Poll <code>GET /runs/:id</code> until{' '}
        <code>finishedAt</code> is set; a run takes one to three minutes. Nothing in the API skips
        the app’s rules: one run at a time per automation, the free allowance, Buffer’s rate limit
        and the daily spend cap all apply.
      </p>

      <h2>Routes</h2>
      {ROUTES.filter((r) => r.scope !== 'none' || r.path === '/hooks/{token}').map((r) => (
        <section key={`${r.method} ${r.path}`} className="docs-route">
          <h3>
            <code>
              {r.method} {r.path}
            </code>
            <span className="docs-scope">{r.scope === 'none' ? 'no token' : r.scope}</span>
          </h3>
          <p>
            {/[.!?]$/.test(r.summary) ? r.summary : `${r.summary}.`}
            {r.description ? ` ${r.description}` : ''}
          </p>
          {r.query ? (
            <p>
              Query:{' '}
              {Object.entries(r.query).map(([name, q], i) => (
                <span key={name}>
                  {i ? ', ' : ''}
                  <code>{name}</code> ({q.description})
                </span>
              ))}
            </p>
          ) : null}
          {r.example ? (
            <pre>{`${r.example.request ?? ''}${r.example.request ? '\n\n' : ''}${r.example.response}`}</pre>
          ) : null}
        </section>
      ))}

      <h2>Webhook events</h2>
      <p>
        <code>POST /webhooks</code> takes any of these in <code>events</code>:
      </p>
      <ul>
        {Object.entries(WEBHOOK_EVENT_DOCS).map(([name, doc]) => (
          <li key={name}>
            <code>{name}</code>: {doc}
          </li>
        ))}
      </ul>
      <p>
        How deliveries are signed and retried is on the <a href="/docs/webhooks">webhooks page</a>.
      </p>
    </LegalPage>
  )
}
