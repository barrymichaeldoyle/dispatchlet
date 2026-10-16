# Landing page review

Reviewed locally on 16 October 2026. This work has not been deployed.

## Experience and accessibility

The landing page leads with one explanation of the product: an agent researches
and writes posts, skips repeats, and sends drafts or scheduled posts to Buffer.
The desktop hero pairs this explanation with signup; mobile stacks the same
content. One compact demo launcher replaces repeated introductions and controls.
Review controls and data handling sit in two optional, native disclosure rows.
Read instead closes the dialog, unlocks page scrolling, opens the transcript and
scrolls its heading to the top of the viewport. The six sample posts are available
in a separate disclosure within that walkthrough.

The existing typography, paper/pine palette and light/dark themes are retained.
The signup form has a persistent label, 44px input and submit controls, a clear
secondary demo link, a pending state and recoverable errors. Successful signup
moves keyboard focus to confirmation and keeps the demo link available. Network
errors preserve the address without marking the address itself invalid.

The demo starts only on request. Its 54-second sequence types the brief, animates
submission, builds the playbook, and turns five research candidates into three
fresh stories. It explicitly skips a previously posted story and company PR.
Research details arrive as complete text rather than competing typewriter streams.
The completed candidate list holds for five and a half seconds before the next chapter.

The writing chapter keeps one short X/LinkedIn comparison on screen. Its channels
stream in sequence, then the other two stories appear as compact completed items.
There is no automatic story switching. All six example posts remain available in
the transcript. Viewers can select a fresh story in research, completed-story
links or the Buffer schedule to pause and preview both of its posts. Matching
research and schedule entries are highlighted. Selecting during research
advances to the completed writing preview. Automatic playback never cycles
between stories; resuming restores the original example. On phones, inspection
opens the writing chapter and focuses the selected preview, preserving run
progress. All preview variants reserve one shared area to avoid layout shifts;
inactive variants are hidden from assistive technology and keyboard focus.

The skipped urban garden finding opens a native, light-dismiss popover showing a
clearly labeled illustrative prior post and the match explanation. Opening it
pauses playback. Escape closes only the explanation and restores the trigger,
leaving the walkthrough paused. The final Buffer schedule places stories at 09:00, 12:00 and
15:00 using Spread mode, with over seven seconds to read the completed schedule.

Pause/resume, restart at any point, replay, chapter selection and hidden-tab
pausing are supported. Escape closes and pauses the player, restoring focus to
the launcher and preserving progress. Chapter selection shows the complete
chosen phase in a paused state. At widths of at least 1100px and heights of at
least 650px, playback builds a persistent four-column workspace: brief/playbook,
research, channel posts and Buffer schedule. Completed content remains mounted
and readable as the next area fills in. Future areas show brief waiting states.
Columns and the brief remain anchored throughout the complete run. Desktop
removes redundant labels and adapts spacing to shorter laptop viewports; panel
scrolling is available for enlarged text. Smaller screens retain one focused
chapter at a time. Resizing preserves progress and the playback state.

Playback opens a native full-screen dialog sized
to the dynamic viewport. The landing page remains inactive and scroll-locked
behind it. The close button, chapters and playback controls stay visible while
longer stage content scrolls inside the player. Read instead closes the player
and opens/focuses the transcript. Playback shows no elapsed-seconds counter;
the landing page avoids an extra duration label. Only the current desktop
phase is highlighted, with quiet checks on completed phases. The brief confirms
playbook creation, and the Buffer receipt appears after all three slots arrive.
On completion, Join the waiting list closes the player and focuses the email
field without submitting the form. The completed run remains available to replay.

Streaming text reserves its complete wrapped height, results occupy reserved
slots, and chapters share a fixed top anchor. Motion is limited to chapter
handoffs, sequential results, completion checks and control feedback. Candidate
rows appear together, without a stagger competing with the duplicate decision.
Restart resets the timer, scroll position and opening animation while keeping
the player open and keyboard focus on the control. Content no longer recenters
as text arrives. Position and size regressions are checked throughout playback
at desktop and two phone sizes.

Reduced motion removes cursor movement and animated transitions and shows each
text block without typewriter motion. Screen readers receive complete text
blocks and short stage announcements rather than character-by-character output.
A native details disclosure contains the complete walkthrough, including the
example brief, all six posts and the spaced schedule, without requiring JavaScript or timed playback.

The page also has skip navigation, section headings, main/footer landmarks,
visible keyboard focus, matching visible/accessibility labels and sufficient
contrast in both themes. Automated axe checks cover all product landmarks,
every chapter and the open transcript in both themes. These checks supplement
keyboard, layout and browser-engine checks; they are not a claim of exhaustive
assistive-technology certification.

## Loading and animation

The measurements below record the original landing-page polish pass, before
the full-screen player follow-up. Lighthouse 13.5.0, default mobile simulation,
against the production build served
locally by `pnpm preview`, using the same environment before and after.

| Measurement                              | Before    | After     |
| ---------------------------------------- | --------- | --------- |
| Performance                              | 61        | 90        |
| Accessibility                            | 100       | 100       |
| Best practices                           | 96        | 100       |
| SEO                                      | 100       | 100       |
| First contentful paint                   | 5.9 s     | 2.7 s     |
| Largest contentful paint                 | 7.2 s     | 3.0 s     |
| Total blocking time                      | 20 ms     | 0 ms      |
| Cumulative layout shift                  | 0         | 0         |
| Initial shared JavaScript, uncompressed  | 734.90 KB | 344.14 KB |
| Initial shared JavaScript, gzip estimate | 236.54 KB | 110.60 KB |

Performance scores ranged from 88–90 across verification runs; the table shows the final run.

The shared entry bundle is 53% smaller. This comparison excludes the small
route bundle on each side. Optional live count and analytics modules now load
separately. Analytics uses the slim SDK and does not request unused flag,
recording or survey features. The font is preloaded from the same origin, removing
an external render-blocking stylesheet and its font-discovery chain.

Before the full-screen follow-up, a complete real-time mobile playback in
headless Chromium produced 2,172 frame
samples, a 16.7 ms median and 95th percentile frame interval, no observed long
tasks and no page errors. Playback performs no real research or Buffer requests.
Desktop/mobile demo heights remain stable across chapters. The page was checked
at 320, 390, 768 and 1360px, in both themes, plus enlarged text at 320px.

These are local lab measurements, not production field Core Web Vitals. The
remaining mobile loading cost includes the framework hydration bundle and local
asset delivery. The local preview serves assets without production CDN transfer
compression; deployment and real-user measurements remain separate validation.

## Search and sharing

The prerendered HTML includes a descriptive title and meta description, a single
home canonical URL, index/follow, complete Open Graph/Twitter image metadata,
English language and WebSite JSON-LD. Structured data makes no pricing or review
claims. `robots.txt` advertises the canonical-only XML sitemap. Unknown paths
return an actual HTTP 404, a useful recovery page and noindex, without inheriting
the home canonical.

These elements and the complete readable walkthrough were checked with
JavaScript disabled. Relevant references:
[Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls),
[Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap),
[W3C pause/stop guidance](https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html).

## Verification

- `pnpm check`: lint, formatting, TypeScript, dependency usage and 24 unit tests.
- `pnpm build`: production client/server build and home-page prerender.
- 44 browser tests against the production preview: playback and replay, pause,
  chapter navigation, full-viewport portrait/landscape layouts, persistent controls,
  orientation changes, focus containment/restoration, background scroll locking,
  Read instead, stable streaming positions, duplicate filtering, spaced scheduling,
  reading holds, sequential channel writing, persistent desktop columns, retained
  content, laptop fit, responsive layout switching, accurate completion feedback,
  keyboard return to signup without submission, story selection and linked
  highlights, stable preview geometry, duplicate evidence and Escape/focus
  restoration, axe scans including optional detail/inspection states, signup
  pending/error/success, optional-download failures, themes, no-JavaScript
  content, metadata, crawler files and HTTP 404 behavior.
- Current Chromium, WebKit and Firefox smoke checks also cover complete playback,
  Read instead scrolling/focus and overflow at 1440×900 and 390×844.
- Chromium covers both layouts, including short landscape. Additional WebKit
  and Firefox checks verify retained content, stable columns and full-picture
  fit at 1280×720, 1440×900 and 1920×1080, plus switching back to mobile.
- Earlier WebKit 27.2 and Firefox 157 smoke checks: mobile dark layout,
  playback, focus, chapters, transcript and mocked signup, with no page errors.
- Mechanical design scan and `git diff --check`: clean.

The existing test that submits a real signup was excluded. Network fixtures
verify the interaction without creating waiting-list entries or sending email.
To reproduce the production-browser run:

```sh
pnpm build
pnpm preview --port 4173 --host 127.0.0.1
# In a second terminal:
E2E_BASE_URL=http://127.0.0.1:4173 pnpm exec playwright test \
  --grep-invert 'joining the waiting list shows a position'
```

To reproduce the mobile lab audit against that preview:

```sh
pnpm dlx lighthouse@13.5.0 http://127.0.0.1:4173 \
  --chrome-flags='--headless --no-sandbox' \
  --only-categories=performance,accessibility,best-practices,seo
```
