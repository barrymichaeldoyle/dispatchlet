# Buffer Commit submission notes

Deadline: 13 November 2026, 23:59 PT (14 November, 09:59 SAST). Submit on 12 November.

## The form needs

- Full legal name and the email on the Buffer account.
- Social handles.
- App client ID: `JD3irou4zLB8Yr7KMT_Yy7LkJdpZcFw02SettBSWSdu`.
- The app URL: https://dispatchlet.com (must stay live through judging, about 16 to 20 November).
- The repo: https://github.com/barrymichaeldoyle/dispatchlet. Work before the `pre-window` tag is
  listed in the README; everything after it was built in the window.
- Up to five links. Not using the build-in-public award.
- The demo video and the write-up below.

## Write-up (about 300 words)

**Problem.** Keeping an account posting about one topic means the same research every day: what
happened, have I posted it, is it worth a post, how do I write it for each channel. I did this by
hand for GrandPrixPicks, my F1 predictions game, then wrote a script to do it for me. Dispatchlet is
that script, rebuilt so anyone with a Buffer account can use it.

**Who it's for.** People who share news about a topic: a local food page, a sports fan account, a
software company, a charity. They want a steady stream of good posts without an hour of research a
day.

**What it does.** You answer seven questions. Dispatchlet writes a playbook you can edit, then runs
a dry run on its own so you see what it finds. On schedule it opens your sources, searches the web,
skips anything you have already posted or asked it to avoid, writes a post for each channel within
that channel's limit, credits the outlet it links to, and puts the posts in Buffer as drafts or in
your queue. You can edit a draft and approve it from the app, the email or a chat. Every run is
logged: what it searched, what it kept, what it skipped and why, and what it cost.

**Built on the Buffer API.** OAuth with rotating refresh tokens, `channels` and
`dailyPostingLimits` before every run, `createPost` in its three modes, `editPost` to change and
approve drafts, `createTag`, and `posts` and `post` for status, deletions and metrics. Every call is
reserved against the rate-limit budget Buffer reports in its headers.

**Open to other tools.** A REST API with personal tokens, signed webhooks (Buffer has none, so this
is also how you learn a post went out), a URL that turns a GitHub release into a run, and an MCP
server: add it to claude.ai and Claude can run research and approve drafts beside Buffer's own
connector.

**What I learned.** A run costs about 6 cents and two minutes. The hard part is judgement, not
writing: what is new, what is a repeat told by another outlet, and when to post nothing.

**Next.** Images for visual channels, metrics feeding back into the playbook, team approvals.

## Demo video (target 1:55)

0:00 Title card: Dispatchlet. "An agent that researches and writes your Buffer posts."
0:05 Over the GrandPrixPicks X account: "I post F1 news every day. I didn't want to research it
every day, so I wrote a script. This is that script for anyone with Buffer."
0:15 Sign in with Buffer, Buffer's consent screen, back in Dispatchlet with channels listed.
0:25 The seven questions for Good News Today (sped up 2x). Create playbook; it appears with the
sources it found, and a dry run starts on its own.
0:45 The live log: stories found, one already covered, posts written for X and LinkedIn.
1:05 Enable: daily at 08:00. Run now. Cut to Buffer: the drafts are there with the Dispatchlet tag.
1:20 Back in Dispatchlet: edit a draft, approve it; Buffer shows it in the queue.
1:30 claude.ai with the Dispatchlet connector: "What did Good News Today post this week, and is
anything waiting?" Claude lists the draft; "Approve it." It moves into the queue.
1:48 End card: "Built on the Buffer API: OAuth, channels, createPost, editPost, tags, posting
limits, metrics. Works in claude.ai through MCP."

Record at 1440x900 in light mode, with the Good News Today account on a personal X and LinkedIn.
