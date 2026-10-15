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

## Licence

Elastic License 2.0. Read it, learn from it, run it for yourself. Don't sell it
as a hosted service.
