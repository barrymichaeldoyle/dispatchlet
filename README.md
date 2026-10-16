# Dispatchlet

Your research agent for a fresh Buffer queue.

Tell Dispatchlet what you post about. It writes a playbook, checks your sources
on a schedule, writes the posts, and puts them in Buffer as drafts or straight
into your queue. It remembers what it has already covered, so it never posts the
same story twice.

Built for Buffer Commit, 28 October to 13 November 2026. Commits up to the
`pre-window` tag are scaffolding, tooling and the landing page. Everything after
it was built during the contest window. Live at https://dispatchlet.com.

## How it works

1. Connect your Buffer account (OAuth, PKCE).
2. Write a paragraph about what you post about. Dispatchlet writes a playbook:
   sources, what counts as news, what to skip, tone, formats and a schedule.
   Edit it as a form or as text.
3. Dry-run it to see what it would post. Enable it.
4. On schedule, it searches the web, dedupes against everything it has covered,
   writes a post per channel, and creates them in Buffer. Every run is logged:
   what it searched, what it found, what it skipped and why.

## Buffer API surface

OAuth 2.0 with PKCE and rotating refresh tokens. `account`, `channels`,
`configuration` and `dailyPostingLimits` for setup and pre-flight. `createPost`
with `saveToDraft`, `addToQueue` and `customScheduled`. `editPost` to promote a
draft into the queue from the email digest. `createTag` and `posts` for status.

## Stack

TanStack Start on Cloudflare Workers. Convex for data, scheduling and the agent
runs. Clerk for sign-in. Anthropic (Claude Sonnet 5.5 and Opus 5.5) with server
side web search. Resend for email.

## Run it yourself

    pnpm install
    npx convex dev          # creates your Convex deployment, fills .env.local
    pnpm dev

Register a Buffer app client at Settings > API > App Clients with the redirect
URI `https://<your-deployment>.convex.site/oauth/buffer/callback`.

`pnpm check` runs lint, format, types, knip and unit tests. `pnpm e2e` runs the
Playwright smoke test.

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
