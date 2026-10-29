import { createFileRoute } from '@tanstack/react-router'
import { LegalPage, legalHead } from '../components/legal-page'

export const Route = createFileRoute('/docs_/mcp')({
  component: McpDocs,
  head: () =>
    legalHead(
      'The Dispatchlet MCP server',
      'Connect Claude Code, Claude Desktop or Cursor to Dispatchlet and drive research and approvals from a chat.',
      '/docs/mcp',
    ),
})

const TOOLS: [string, string][] = [
  ['list_automations', 'Your automations with status, schedule and next run.'],
  ['get_automation', 'One automation with its playbook text.'],
  [
    'create_automation',
    'From the seven setup answers and channel ids. The playbook follows in about a minute.',
  ],
  ['update_automation', 'Schedule, channels, posting mode, stories per run, or pause and enable.'],
  ['get_playbook', 'The playbook as text.'],
  [
    'update_playbook',
    'Replace the playbook text as a new version. A parse error names the line, so the assistant can fix it.',
  ],
  ['add_skip_rule', 'One sentence added to the Skip section.'],
  [
    'run_automation',
    'Start a run, or a dry run (the default, so an exploring assistant spends nothing), with an optional story to cover.',
  ],
  [
    'get_run',
    'A run with its steps, stories and posts. wait_seconds (up to 25) polls until it finishes.',
  ],
  ['list_runs', 'Recent runs of an automation.'],
  ['list_drafts', 'Posts waiting in Buffer as drafts, with text and channel.'],
  ['approve_post', 'Move a draft into the Buffer queue (Buffer’s editPost).'],
  ['get_post', 'One post with its Buffer status, link and metrics.'],
  ['list_channels', 'Your usable Buffer channels.'],
  ['share_run', 'A public link to a run.'],
]

function McpDocs() {
  return (
    <LegalPage title="The MCP server" updated="29 Oct 2026">
      <p>
        Dispatchlet is a remote{' '}
        <a href="https://modelcontextprotocol.io/">Model Context Protocol</a> server at{' '}
        <code>https://dispatchlet.com/mcp</code>. Connected to an assistant it lets you say “what
        did my F1 automation post this week, and approve the two Las Vegas drafts” and have it
        happen. Buffer has its own MCP for the queue; the two work side by side in one chat.
      </p>

      <h2>Connecting</h2>
      <p>
        Make an API token under Settings → API tokens (a <strong>write</strong> one if the assistant
        should run and approve), then use it as a Bearer header. Settings → Connect an AI assistant
        fills these in for you.
      </p>
      <pre>{`# Claude Code
claude mcp add --transport http dispatchlet https://dispatchlet.com/mcp \\
  --header "Authorization: Bearer dl_…"

# Claude Desktop (claude_desktop_config.json) and Cursor (.cursor/mcp.json)
{
  "mcpServers": {
    "dispatchlet": {
      "url": "https://dispatchlet.com/mcp",
      "headers": { "Authorization": "Bearer dl_…" }
    }
  }
}

# A host that only runs local servers
npx -y mcp-remote https://dispatchlet.com/mcp --header "Authorization: Bearer dl_…"`}</pre>
      <p>
        The server is stateless and uses Streamable HTTP. It holds nothing of yours: each request
        carries your token to the API, and revoking the token in settings disconnects the assistant.
      </p>

      <h2>Tools</h2>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Does</th>
          </tr>
        </thead>
        <tbody>
          {TOOLS.map(([name, does]) => (
            <tr key={name}>
              <td>
                <code>{name}</code>
              </td>
              <td>{does}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Two resources, <code>dispatchlet://automations/{'{id}'}/playbook</code> and{' '}
        <code>dispatchlet://runs/{'{id}'}</code>, let hosts attach a playbook or a run to a chat,
        and one prompt, <code>review_drafts</code>, walks through what is waiting.
      </p>

      <h2>A session</h2>
      <pre>{`You: What did F1 news post this week, and are any drafts waiting?
Assistant: [list_automations] [list_runs] [list_drafts]
  Three runs, four posts reached Buffer. Two drafts are waiting:
  1. GrandPrixPicks (X): "Antonelli fastest in Vegas FP2 …"
  2. GrandPrixPicks (X): "FIA confirms 2027 engine freeze …"
You: Approve both, then show me the queue.
Assistant: [approve_post] [approve_post] [Buffer MCP: list_posts]
  Both are in the GrandPrixPicks queue, next slots 18:00 and 20:00 SAST.`}</pre>

      <h2>Limits</h2>
      <p>
        The tools call the same API with the same limits: 60 requests a minute per token, one run at
        a time per automation, and your run allowance. A dry run costs a dry run; a real run costs a
        run. <code>get_run</code> with <code>wait_seconds</code> polls every three seconds and
        returns early when the run finishes.
      </p>
    </LegalPage>
  )
}
