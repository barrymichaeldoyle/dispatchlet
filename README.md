# Dispatchlet

An agent that researches and writes your Buffer posts.

Answer a few questions about what you post. Daily or weekly, Dispatchlet finds
new stories, skips anything you have already posted or scheduled, writes a post
for each of your channels, and puts them in Buffer as drafts or straight into
your queue.

Built for Buffer Commit, 28 October to 13 November 2026. Live at
https://dispatchlet.com.

## What was built before the contest window

Everything up to the `pre-window` tag was built before 28 October:

- Scaffold, tooling and CI, with the end-to-end tests for the public pages.
- The landing page, its scripted demo and the waiting list (since removed), with
  its confirmation and launch emails.
- The privacy and terms pages, security headers, PostHog analytics, and the
  emailed error alert.
- Buffer plumbing, kept behind an allowlist on a hidden `/app` route: sign in
  with Buffer, the encrypted token store, the single-use refresh-token lock,
  channel sync, the "lost access to Buffer" email and reconnect banner, and a
  shared Buffer call budget that every API call reserves from.
- Account basics on `/app/settings`: time zone, disconnect and delete account.
- The `SIGNUP_OPEN` switch that kept the app closed until launch.

The tag points at `8d03354`, committed 27 October at 23:59 PT, the last commit
before the window opened. The workflow that placed it was removed afterwards, in
`4a65d60`.

None of the AI workflow existed before the tag. Playbooks, research, dedupe,
writing posts, scheduling runs and publishing to Buffer were all built during
the window, in the commits after it.

## How it works

1. Sign in with your Buffer account (OAuth 2 with PKCE).
2. Answer a few quick questions: what to research, where to post, what to
   avoid, sources you prefer, how often it runs (daily or weekly) and how many
   stories to post. Dispatchlet turns the answers into a playbook: sources,
   what counts as news, what to skip, tone, formats and a schedule. Edit it as
   a form or as text.
3. A dry run starts on its own, so you see what it would post before anything
   reaches Buffer. Enable it when you like what you see.
4. On schedule, it opens the playbook's sources, searches the web, drops
   anything it has already covered or is not sure about, writes a post per
   channel within that channel's limit (and asks once for a shorter version
   when one misses), and creates them in Buffer as drafts, in the queue, or
   spread through the day, with a Dispatchlet tag. Every run is logged live:
   what it searched, what it found, what it skipped and why, and what it cost.
5. Drafts can be edited and approved from the home page or the run page, or
   approved from a link in the digest email. Buffer's status and metrics
   for each post come back into the log. Once an automation has a few sent
   posts, the writer learns from its best ones. Any run can be shared by link.

On a finished run, **Skip this story** records an editorial reason and hides that
story's drafts from Dispatchlet's approval list. It also blocks approval through
email, the API and MCP until the skip is undone. Posts already in Buffer stay
there; the run page links to them so you can remove them in Buffer. Feedback is
private, including on shared runs. **Teach future runs** offers an editable skip
rule for common reasons, or lets you write your own. Accepting it creates a new
playbook version; skipping alone never changes the playbook. Undo restores the
drafts to review and keeps any rule you explicitly accepted.

The app is a sidebar of your automations and channels with the work beside it,
like Buffer's own. https://dispatchlet.com/docs says how each part works.

Built during the window as well:

- **Ask for changes.** An assistant on each automation takes a request in plain
  words ("weekdays only, skip transfer rumours") and proposes playbook and
  settings changes as a diff to apply or undo.
- **Research modes.** Recent news, history, or "on this day", which posts each
  story on its own date.
- **Schedules.** Daily, or weekly on chosen days, with posts as drafts, in the
  queue, spread through the day, or planned one story a posting day.
- **Held posts.** When Buffer's daily allowance is spent, posts wait and go out
  when it resets, instead of failing.
- **An installable app** with push notifications when a run needs you.
- **A health check** that emails when the scheduler goes quiet.
- **What a run costs**, measured: [a benchmark on 14 test accounts](https://dispatchlet.com/blog/cost-per-run)
  took a run from $0.31 to about $0.07.

Every account gets 10 free runs and 3 dry runs on Dispatchlet's Anthropic key.
Adding your own key in settings lifts the count. Three failed runs in a row
pause an automation and send an email. A run that fails because the AI service
was busy or broke gives its free run back.

## Buffer API surface

OAuth 2.0 with PKCE and rotating, single-use refresh tokens: one refresh at a
time per connection, guarded by a lock in Convex, because reusing a spent
refresh token revokes the grant. `account`, `channels` (with each channel's
`postingSchedule` and `isQueuePaused`, to place dated posts in its queue times)
and `dailyPostingLimits` for setup and pre-flight. `createPost`
with `saveToDraft`, `addToQueue` and `customScheduled`, plus `metadata` for
threads on X, Threads, Bluesky and Mastodon and link cards on LinkedIn, Threads
and Bluesky. `editPost` to change a draft's text and to promote it into the
queue. `createTag` and `tagsV2` for the Dispatchlet tag. `createIdea` to save a
story that missed the cut to the Ideas board. `posts` for status (hourly once a post
is due, every 6 hours for drafts and posts a day overdue, daily before that),
asked again with a `tags` filter when a busy account fills the first page, and
`post` for metrics once a day, read by Buffer's normalized metric names
(`reactions`, `comments`, `reposts`, `impressions`, `engagementRate` and so on).
Every call is reserved against the rate-limit budget Buffer reports in its
headers.

Optional `createCollaborationNote` adds a link from each new Buffer post back
to its Dispatchlet run. Enable `notes:write` on the Buffer app client, then set
`BUFFER_NOTES=true` on the Convex deployment and reconnect Buffer to grant the
permission. Existing connections without that scope keep posting normally.
Notes use one extra API request per post, respect the background call budget,
and fail independently of publishing. Existing posts and notes are unchanged.
The Notes API is experimental; see [Buffer's Notes guide](https://developers.buffer.com/guides/notes.html).

## Automate it

Everything the app does is open to other tools:

- **REST API** at `https://dispatchlet.com/api/v1` with personal tokens from
  Settings (`read` or `write`), an OpenAPI document at `/api/v1/openapi.json`
  and a reference at [dispatchlet.com/docs/api](https://dispatchlet.com/docs/api).
  Every route goes through the same rules as the app: one run at a time, the
  run allowance, Buffer's limits.
- **Webhooks** signed the [Standard Webhooks](https://www.standardwebhooks.com/)
  way: `run.finished`, `post.created`, `post.approved`, `post.sent`,
  `automation.paused`, `buffer.reauth_needed`, sent only to `https` URLs on port 443
  or 8443. Retries at 1 min, 10 min and 1 h;
  deliveries listed in settings. Buffer has no webhooks, so this is also how to
  know a post went out. [docs/webhooks](https://dispatchlet.com/docs/webhooks)
- **Inbound hooks**: a URL per automation that starts a run, optionally with a
  story to cover; a GitHub release webhook works as is.
  [docs/hooks](https://dispatchlet.com/docs/hooks)
- **MCP server** at `https://dispatchlet.com/mcp` (Streamable HTTP, stateless,
  bearer token or OAuth 2.1) for claude.ai, Claude Code, Claude Desktop and
  Cursor, with 17 tools: create an automation, run research, read the log, edit
  the playbook, add a skip rule, approve drafts, save an idea and share a run,
  beside Buffer's own MCP.
  OAuth runs on `@cloudflare/workers-oauth-provider` in `src/server.ts`; a grant
  holds an ordinary API token that shows in settings and can be revoked there.
  [docs/mcp](https://dispatchlet.com/docs/mcp)
- `https://dispatchlet.com/llms.txt` points at all of it.

## Stack

TanStack Start on Cloudflare Workers. Convex for data, scheduling and the agent
runs. Convex Auth for sign-in with Buffer. Claude through the Anthropic API: Haiku 5.5
researches, Sonnet 5.5 writes the posts and playbooks and runs the assistant.
Server-side web search and fetch, structured outputs and prompt caching; every
call's usage and cost is recorded. Resend for email. Sentry for errors in the
Worker and the browser.

## Run it yourself

    pnpm install
    npx convex dev          # creates your Convex deployment, fills .env.local
    pnpm dev

Register a Buffer app client at Settings > API > App Clients with the
permissions `account:read`, `posts:read` and `posts:write` (plus `ideas:write`
with `BUFFER_IDEAS=true`, and `notes:write` with `BUFFER_NOTES=true`), and the redirect URI
`https://<your-deployment>.convex.site/api/auth/callback/buffer`. Buffer app
clients cannot request `openid`, so sign-in is plain OAuth 2.

Convex environment variables: `BUFFER_CLIENT_ID`, `BUFFER_CLIENT_SECRET`,
`SITE_URL` (where the app runs), `JWT_PRIVATE_KEY` and `JWKS` (Convex Auth),
`TOKEN_ENC_KEY` (32 random bytes, base64) and `ALLOWED_EMAILS` or
`ALLOWED_BUFFER_IDS` (who may use the app while sign-up is closed). Set
`SIGNUP_OPEN` to `true` to let everyone in. `VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` turn on push notifications. `ANTHROPIC_API_KEY` runs the
free tier; `RESEND_API_KEY` sends the emails. Optional: `FREE_RUNS_PER_USER`
(10), `FREE_DRY_RUNS_PER_USER` (3), `GLOBAL_DAILY_USD_CAP` (15, the most a day's
scheduled runs may cost on the shared key), and `ALERT_EMAIL` with `ALERTS_SECRET`
for the error alert (`POST /alerts/errors` refuses every call until the secret is
set, and then needs it in `X-Alerts-Secret`). To serve sign-in from
your own domain, set `CUSTOM_AUTH_SITE_URL` to it; the site passes
`/api/auth/*` through to Convex.

A few things name Dispatchlet's own deployments and need yours instead: the
Content Security Policy in `src/lib/security-headers.ts` and `public/_headers`
(Convex deployments, PostHog's EU host and Sentry), the Sentry DSN in
`src/server.ts` and `src/integrations/sentry/errors.ts`, the PostHog key in
`.env.production`, and the test deployments in `convex/e2e.ts`.

Smaller limits can be tuned with more Convex variables (`API_RATE_PER_MINUTE`,
`AUTOMATIONS_PER_USER`, `BUFFER_BACKGROUND_CALLS_PER_USER` and others); grep
`process.env` in `convex/` for the full list and their defaults.

`pnpm check` runs lint, format, types, knip and unit tests. `pnpm e2e` runs the
Playwright tests.

The signed-in tests (`e2e/signed-in.spec.ts`) use a test-only sign-in
(`convex/e2e.ts`) on the dev deployment. To turn it on, put the same random value
of 32 characters or more in `.env.local` as `E2E_AUTH_SECRET` and on dev with
`npx convex env set E2E_AUTH_SECRET <value>`. Each sign-in resets one test user
(`e2e@dispatchlet.test`) to a fixture. Without the secret, or against a deployed
site, those tests are skipped. The sign-in only runs on the deployments listed in
`convex/e2e.ts` (the dev deployment and a local backend), so production refuses
it even if the variable is set there. Never set it on production.

### Pre-commit checks

`pnpm install` installs the Husky Git hooks automatically. Every commit runs
`pnpm precommit`, which checks staged JavaScript/TypeScript files with oxlint,
checks formatting on staged supported files with oxfmt, typechecks, and runs the
full unit test suite. Lint and formatting checks do not rewrite files; fix
failures and stage the changes before retrying. Any failed check blocks the
commit.

CI runs `pnpm check` (which adds Knip and fails on lint warnings) and the
browser tests on every push. `pnpm audit` runs weekly in its own workflow,
since advisories arrive on their own schedule rather than with commits.

## Landing page

The landing page is prerendered, with a self-hosted Schibsted Grotesk font (SIL
Open Font License in `src/assets/fonts/OFL.txt`). The 55-second demo is
user-started, opens in a full-screen dialog with pause, replay and chapters, and
has a written transcript that works without JavaScript. Analytics uses the slim
PostHog SDK for explicit funnel events, loaded after the page, with autocapture
and session recording off.

## Deployment

Pushes to `main` deploy production through Cloudflare Workers Builds for
`barrymichaeldoyle/dispatchlet`. The repository connection and production
Convex build secret are configured on the `dispatchlet` Worker.

Use these settings under the `dispatchlet` Worker's Settings > Builds:

| Setting                      | Value                                                             |
| ---------------------------- | ----------------------------------------------------------------- |
| Repository                   | `barrymichaeldoyle/dispatchlet`                                   |
| Production branch            | `main`                                                            |
| Root directory               | `/`                                                               |
| Build command                | `pnpm build:deploy`                                               |
| Deploy command               | `pnpm exec wrangler deploy`                                       |
| Non-production branch builds | Disabled until a separate Convex preview deploy key is configured |

Set `CONVEX_DEPLOY_KEY` as a **build secret**, using a production deploy key
for the Dispatchlet Convex project. Build variables pin `NODE_VERSION=26` (as in
`.nvmrc`) and
`PNPM_VERSION=11.17.0`; the pnpm version also matches `package.json`.
The PostHog key and host are public and committed in `.env.production`, which
the build reads; no build variables are needed for analytics.

`pnpm build:deploy` uses Convex's deploy command to run the Vite build with the
production deployment URL injected as `VITE_CONVEX_URL`, then deploys the
Convex functions and schema. Only after that succeeds does Cloudflare run the
Worker deploy command. The `.convex.site` URL is derived from the injected
`VITE_CONVEX_URL`.

`pnpm build` remains a frontend-only build for local checks.
`pnpm deploy` performs the combined production build, Convex deployment and
Worker deployment manually. It changes production and requires credentials.
GitHub Actions runs the code checks and browser tests.

References: [Cloudflare build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
and [Convex deployment command](https://docs.convex.dev/cli/reference/deploy).

## Licence

Elastic License 2.0. Read it, learn from it, run it for yourself. Don't sell it
as a hosted service.
