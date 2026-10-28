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

## Write-up (about 290 words)

**Problem.** Keeping an account posting about one topic means the same research every day: what
happened, have I posted it, is it worth a post, how do I write it for each channel. I did this by
hand for GrandPrixPicks, my F1 predictions game, then wrote a script to do it for me. Dispatchlet is
that script, rebuilt so anyone with a Buffer account can use it.

**Who it's for.** People who share news about a topic: a local food page, a sports fan account, a
software company, a charity. They want a steady stream of good posts without spending an hour a day
researching.

**What it does.** You answer seven questions: what to research, where to post, what to avoid,
preferred sources, how often, how many stories, drafts or scheduled. Dispatchlet writes a playbook
you can edit as a form or as text. On schedule it opens your sources, searches the web, checks every
story against what you have already posted, skips repeats and anything you asked it to avoid, writes
a post for each channel within that channel's limit, and puts them in Buffer as drafts or into your
queue, spread through the day, tagged Dispatchlet. Every run is logged live: what it searched, what
it kept, what it skipped and why, and what it cost.

**Built on the Buffer API.** OAuth with rotating refresh tokens, `channels` and
`dailyPostingLimits` before every run, `createPost` in its three modes with thread and link-card
metadata, `editPost` to approve a draft from the email, `createTag`, and `posts` and `post` to
bring status and metrics back into the log. Every call is reserved against the rate-limit budget
Buffer reports in its headers.

**What I learned.** A research run costs about 15 cents and two minutes. The hard part is not the
writing but the judgement: what is new, what is a repeat told by another outlet, when to post
nothing. That is where most of the prompt work went.

**Next.** Images for visual channels, post metrics feeding back into the playbook, team approvals,
and paid plans priced by runs.

## Demo video (target 1:50)

0:00 Title card: Dispatchlet. "An agent that researches and writes your Buffer posts."
0:05 One sentence over the GrandPrixPicks X account: "I post F1 news every day. I didn't want to
research it every day, so I wrote a script. This is that script for anyone with Buffer."
0:15 Sign in with Buffer, Buffer's consent screen, back in Dispatchlet with channels listed.
0:28 The seven questions for Good News Today (sped up 2x). Create playbook; it appears, with the
sources it found. Open the text view, change one line, save.
0:50 Dry run: the live log, stories found, one already covered, posts written for X and LinkedIn.
1:15 Enable: daily at 08:00. Run now. Cut to Buffer: the posts are there as drafts with the
Dispatchlet tag. Approve one from the email; it moves into the queue.
1:38 Run log: the sent post with its link; open it on X.
1:48 End card: "Built on the Buffer API: OAuth, channels, createPost, editPost, tags, posting
limits, metrics."

Record at 1440x900 in light mode, with the Good News Today account on a personal X and LinkedIn.
