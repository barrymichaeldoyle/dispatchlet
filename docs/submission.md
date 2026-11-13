# Buffer Commit write-up

The write-up submitted with Dispatchlet (under 300 words).

**Problem.** Keeping an account posting about one topic means the same research every day: what
happened, have I posted it, is it worth a post, how do I write it for each channel. I did this by
hand for GrandPrixPicks, my F1 game, then scripted it. Dispatchlet is that script, rebuilt for any
Buffer account.

**Who it's for.** People who share news about a topic: a food page, a fan account, a software
company.

**What it does.** You answer seven questions. Dispatchlet writes a playbook and runs a dry
run. On schedule it reads your sources, searches the web, skips what you have already
posted, writes a post for each channel within its limit and puts
the posts in Buffer as drafts or in your queue. Every run logs what it searched, kept and skipped,
and why. Approve drafts from the app, an email or a chat, or ask the assistant for changes and
review the diff. A skipped story can become a rule, and the writer learns from your best
posts.

**Built on the Buffer API.** OAuth with rotating refresh tokens, `channels` and
`dailyPostingLimits` before every run, `createPost` in its three modes, `editPost` to change and
approve drafts, `createTag`, `createIdea`, `createCollaborationNote` to link each post to its run,
and `posts` and `post` for status and metrics. Every call is reserved against Buffer's rate limits.

**Open to other tools.** A REST API, signed webhooks (Buffer has none), a URL that turns a GitHub release into a run, and an MCP server: in claude.ai, Claude
can run research and approve drafts.

**What I learned.** A run costs about $0.07. The hard part is judgement, not writing: what is new,
what is a repeat from another outlet, and when to post nothing.

**Next.** Images for visual channels, team approvals.
