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

- Scaffold, tooling and CI.
- The landing page, its scripted demo and the waiting list.
- Buffer plumbing, kept behind an allowlist on a hidden `/app` route: sign in
  with Buffer, the encrypted token store, the single-use refresh-token lock,
  channel sync, the "lost access to Buffer" email and reconnect banner, and a
  shared Buffer call budget that every API call reserves from.
- Account basics on `/app/settings`: time zone, disconnect and delete account.

The tag is placed by `.github/workflows/pre-window-tag.yml` on the last commit
before 28 October 00:01 PT.

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
3. Dry-run it to see what it would post. Enable it.
4. On schedule, it searches the web, dedupes against everything it has covered,
   writes a post per channel, and creates them in Buffer. Every run is logged:
   what it searched, what it found, what it skipped and why.

## Buffer API surface

OAuth 2.0 with PKCE and rotating, single-use refresh tokens: one refresh at a
time per connection, guarded by a lock in Convex, because reusing a spent
refresh token revokes the grant. `account`, `channels`,
`configuration` and `dailyPostingLimits` for setup and pre-flight. `createPost`
with `saveToDraft`, `addToQueue` and `customScheduled`. `editPost` to promote a
draft into the queue from the email digest. `createTag` and `posts` for status.

## Stack

TanStack Start on Cloudflare Workers. Convex for data, scheduling and the agent
runs. Convex Auth for sign-in with Buffer. Anthropic (Claude Sonnet 5.5 and Opus 5.5) with server
side web search. Resend for email.

## Run it yourself

    pnpm install
    npx convex dev          # creates your Convex deployment, fills .env.local
    pnpm dev

Register a Buffer app client at Settings > API > App Clients with the
permissions `account:read`, `posts:read` and `posts:write`, and the redirect URI
`https://<your-deployment>.convex.site/api/auth/callback/buffer`. Buffer app
clients cannot request `openid`, so sign-in is plain OAuth 2.

Convex environment variables: `BUFFER_CLIENT_ID`, `BUFFER_CLIENT_SECRET`,
`SITE_URL` (where the app runs), `JWT_PRIVATE_KEY` and `JWKS` (Convex Auth),
`TOKEN_ENC_KEY` (32 random bytes, base64) and `ALLOWED_EMAILS` or
`ALLOWED_BUFFER_IDS` (who may use the app before launch). Set `SIGNUP_OPEN` to
`true` to let everyone in; it is off until launch. To serve sign-in from
your own domain, set `CUSTOM_AUTH_SITE_URL` to it; the site passes
`/api/auth/*` through to Convex.

`pnpm check` runs lint, format, types, knip and unit tests. `pnpm e2e` runs the
Playwright smoke test.

### Pre-commit checks

`pnpm install` installs the Husky Git hooks automatically. Every commit runs
`pnpm precommit`, which checks staged JavaScript/TypeScript files with oxlint,
checks formatting on staged supported files with oxfmt, runs `pnpm audit`
(including development and optional dependencies, at low severity and above),
and runs the full unit test suite. Lint and formatting checks do not rewrite
files; fix failures and stage the changes before retrying.

Any failed check blocks the commit. The audit requires access to the package
registry; a failed audit request also blocks the commit. A clean audit means
no known dependency vulnerabilities were reported at the time of the check.
Typechecking, Knip and browser tests remain in CI through the existing checks.

## Landing page quality

The landing page uses a concise product explanation, one demo launcher and optional
review/privacy disclosures. Read instead opens and scrolls directly to the written
walkthrough. The landing page is prerendered, with a self-hosted Schibsted Grotesk font
(SIL Open Font License in `src/assets/fonts/OFL.txt`). The interactive demo is
user-started and opens a responsive, full-screen native dialog with persistent
playback controls. Desktop builds a persistent workspace across the available
width: brief and playbook, research, channel posts and Buffer schedule. Smaller
screens keep the focused chapter layout. Closing it preserves progress and returns focus to the
launcher. It supports pause/replay and chapter selection, and has a native HTML
transcript that also works without JavaScript. The 54-second example finds three
fresh stories, skips previous coverage, writes six channel-specific posts and
spaces them three hours apart in Buffer. Reserved text and result slots keep
streaming content steady. Playback holds one short channel comparison on screen,
shows the other stories as completed items, and leaves reading time for the
duplicate decision and final schedule. All six posts remain in the transcript. Selecting a story pauses playback and
previews its channel posts, with matching research/schedule entries highlighted.
The skipped duplicate opens an optional explanation with an illustrative prior post.

Analytics and the optional live waiting-list count load separately from the
initial page. Analytics uses the slim PostHog SDK for explicit funnel events;
autocapture, session recording, surveys and feature flags are disabled on this
surface. Signup and the demo remain usable if those optional downloads fail.

See [the landing page review](docs/landing-page-review.md) for measurements,
accessibility coverage and verification commands.

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
for the Dispatchlet Convex project. Build variables pin `NODE_VERSION=24` and
`PNPM_VERSION=11.17.0`; the pnpm version also matches `package.json`.
For analytics, also set `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` as build
variables with the project's valid token and ingestion host.

`pnpm build:deploy` uses Convex's deploy command to run the Vite build with the
production deployment URL injected as `VITE_CONVEX_URL`, then deploys the
Convex functions and schema. Only after that succeeds does Cloudflare run the
Worker deploy command. Do not set `VITE_CONVEX_SITE_URL` to a development
deployment in production; it is derived from the injected URL by default.

`pnpm build` remains a frontend-only build for local checks.
`pnpm deploy` performs the combined production build, Convex deployment and
Worker deployment manually. It changes production and requires credentials.
The GitHub deployment workflow is a manual fallback; it does not deploy on
push. GitHub Actions continues to run the code checks and browser tests.

References: [Cloudflare build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
and [Convex deployment command](https://docs.convex.dev/cli/reference/deploy).

## Licence

Elastic License 2.0. Read it, learn from it, run it for yourself. Don't sell it
as a hosted service.
