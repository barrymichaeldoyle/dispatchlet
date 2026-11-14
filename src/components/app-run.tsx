import { PageSkeleton } from './page-skeleton'
import { MissingItem } from './route-error'
import { Link, useNavigate } from '@tanstack/react-router'
import { ConvexProvider, ConvexReactClient, useAction, useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { BufferMark, ChannelMark } from './brand-icons'
import { PostText } from './post-text'
import { Wordmark } from './wordmark'
import { measuredLength } from '../../convex/lib/ai/write'
import { limitReason, toolInput, toolNote } from '../../convex/lib/runLog'
import type { Service } from '../../convex/lib/ai/setup'
import {
  bufferChannelUrl,
  errorText,
  ideaLinkState,
  metricLabel,
  serviceName,
  timeIn,
  relativeWhenInline,
  usd,
  webHref,
} from '../lib/format'
import { BusyLabel } from './busy-label'
import { DraftEditor } from './app-pages'
import { usePageTitle } from '../lib/use-page-title'

/** Matches runs.IDEA_DECISIONS: good stories that missed the cut, and a dry run's picks. */
const IDEA_DECISIONS = new Set(['skipped_limit', 'skipped_quality', 'dry'])

/** Saves a story to the Ideas board in Buffer, so it can be posted later by hand. */
function SaveIdea({ storyId, saved }: { storyId: Id<'stories'>; saved: boolean }) {
  const save = useAction(api.runs.saveIdea)
  const ideas = useQuery(api.buffer.myConnection)?.ideas ?? 'off'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = ideaLinkState(saved, ideas)
  if (state === 'saved') return <p className="app-muted">Saved to your Ideas in Buffer.</p>
  if (state === 'hidden') return null
  if (state === 'reconnect')
    return (
      <p className="app-muted">
        To save stories to Buffer Ideas, <Link to="/app/settings">reconnect Buffer</Link> once.
      </p>
    )
  return (
    <p className="app-story-actions">
      <button
        type="button"
        className="app-link"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          setError(null)
          save({ storyId })
            .catch((reason: unknown) => setError(errorText(reason, 'Not saved. Try again.')))
            .finally(() => setBusy(false))
        }}
      >
        <BusyLabel busy={busy} idle="Save to Buffer Ideas" working="Saving to Buffer" />
      </button>
      {error ? (
        <span className="app-muted" role="status">
          {error}
        </span>
      ) : null}
    </p>
  )
}

const POST_WORDS: Record<string, string> = {
  dry: 'would be sent',
  rejected: 'not used',
  skipped: 'skipped',
  held: 'waiting for Buffer',
  draft: 'draft',
  queued: 'queued',
  scheduled: 'scheduled',
  deleted: 'deleted in Buffer',
  sent: 'sent',
  publishing: 'sending to Buffer',
  failed: 'failed',
}

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined
const publicClient = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null

/** A shared run, outside the app, so it brings its own Convex client with no sign-in. */
export function SharedRun({ token }: { token: string }) {
  if (!publicClient) return null
  return (
    <ConvexProvider client={publicClient}>
      <SharedRunInner token={token} />
    </ConvexProvider>
  )
}

/** The same log, read-only, with the wordmark on top. */
function SharedRunInner({ token }: { token: string }) {
  const run = useQuery(api.runs.shared, { token })
  // The placeholder the server sent (routes/__root.tsx), kept up until the run arrives.
  if (run === undefined)
    return (
      <div className="app-gate boot-placeholder" aria-busy="true">
        <div className="app-gate-inner">
          <span className="app-gate-home">
            <Wordmark size="md" />
          </span>
          <h1>Opening the run</h1>
        </div>
      </div>
    )
  return (
    <main className="app-gate is-app">
      <div className="app-gate-inner">
        <header className="app-top">
          <a href="/" className="app-gate-home" aria-label="Dispatchlet home">
            <Wordmark size="md" />
          </a>
          <nav aria-label="Site" className="app-nav">
            <a href="/">What Dispatchlet is</a>
          </nav>
        </header>
        {run ? (
          <RunView run={run} shared />
        ) : (
          <>
            <h1>This link is not valid</h1>
            <p>The run may have been unshared, or the link was copied wrongly.</p>
          </>
        )}
      </div>
    </main>
  )
}

/**
 * Puts a share link on the clipboard. No clipboard (insecure page, denied permission) is not an
 * error: the link is still shown next to the button.
 */
function copyLink(token: string): Promise<string> {
  const write =
    navigator.clipboard?.writeText(`${window.location.origin}/r/${token}`) ??
    Promise.reject(new Error('No clipboard'))
  return write
    .then(() => 'Link copied.')
    .catch(() => 'Could not copy. Open it and copy the address.')
}

/** One run as a log: a timestamp spine on the left, what happened on the right (SPEC §23.4). */
export function RunPage({ id, runId }: { id: Id<'automations'>; runId: Id<'runs'> }) {
  const run = useQuery(api.runs.get, { runId })
  if (run === undefined) return <PageSkeleton figures={false} />
  if (run === null) return <MissingItem what="run" />
  return <RunView run={run} id={id} />
}

type RunData = NonNullable<ReturnType<typeof useQuery<typeof api.runs.get>>>

const REVIEW_REASONS = [
  {
    reason: 'Too promotional',
    rule: 'Skip promotional stories whose main purpose is selling a product or service.',
  },
  {
    reason: 'Old news',
    rule: 'Skip stories that repeat an older announcement without a new development.',
  },
  {
    reason: 'Off topic',
    rule: 'Skip stories that do not directly relate to the topic described in this playbook.',
  },
  {
    reason: 'Unreliable source',
    rule: 'Skip stories whose key claims cannot be verified from a reliable, named source.',
  },
]

/** Two deliberate choices: dismiss this story, then optionally teach future runs. */
function StoryReview({
  story,
  hasBufferPosts,
  dry,
  published,
}: {
  story: RunData['stories'][number]
  hasBufferPosts: boolean
  /** A dry run sent nothing, so there are no drafts to hide: skipping only records the reason. */
  dry: boolean
  /** Its post already went out or is booked: skipping teaches future runs, it doesn't un-post. */
  published: boolean
}) {
  const skip = useMutation(api.runs.skipStory)
  const undo = useMutation(api.runs.undoSkipStory)
  const apply = useMutation(api.runs.applyStoryRule)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState(REVIEW_REASONS[0].reason)
  const [details, setDetails] = useState('')
  const [rule, setRule] = useState(
    () => REVIEW_REASONS.find((r) => r.reason === story.review?.reason)?.rule ?? '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save(work: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failure) {
      setError(errorText(failure, 'Not saved. Try again.'))
    } finally {
      setBusy(false)
    }
  }
  if (story.review)
    return (
      <div className="app-story-review">
        <p>
          <strong>Skipped in Dispatchlet.</strong> {story.review.reason}
        </p>
        <p className="app-muted">
          Its drafts are hidden from your approval list.
          {hasBufferPosts
            ? ' Posts already in Buffer are unchanged. Open them below to remove them there.'
            : ''}
        </p>
        {story.review.appliedVersion ? (
          <p className="app-muted">
            Added to playbook version {story.review.appliedVersion}: {story.review.appliedRule}{' '}
            Undoing the skip keeps this rule; you can edit it in the playbook.
          </p>
        ) : (
          <details>
            <summary>Teach future runs (optional)</summary>
            <form
              className="app-story-review"
              onSubmit={(e) => {
                e.preventDefault()
                void save(() => apply({ storyId: story._id, rule }))
              }}
            >
              <label className="app-story-review-label">
                {REVIEW_REASONS.some((r) => r.reason === story.review?.reason)
                  ? 'Suggested skip rule. Edit it before adding.'
                  : 'What should future runs skip? Write one short sentence.'}
                <textarea
                  className="app-select"
                  value={rule}
                  maxLength={200}
                  rows={3}
                  required
                  onChange={(e) => setRule(e.target.value)}
                  disabled={busy}
                />
              </label>
              <p className="app-muted">
                Only changes future runs. Leave this closed to skip just this story.
              </p>
              <div className="app-story-actions">
                <button
                  className="app-gate-secondary"
                  type="submit"
                  disabled={busy || rule.trim().length < 3}
                >
                  <BusyLabel busy={busy} idle="Add rule to playbook" working="Saving" />
                </button>
              </div>
            </form>
          </details>
        )}
        <button
          type="button"
          className="app-link"
          disabled={busy}
          onClick={() => {
            void save(() => undo({ storyId: story._id }))
          }}
        >
          Undo skip
        </button>
        {error ? (
          <p className="app-muted" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  if (!open)
    return (
      <button type="button" className="app-link" onClick={() => setOpen(true)}>
        {published ? 'Not a good pick? Tell future runs' : 'Skip this story'}
        {published ? (
          <span className="visually-hidden">. This does not remove the post from Buffer.</span>
        ) : null}
      </button>
    )
  const cleanReason = reason === 'Something else' ? details.trim() : reason
  return (
    <form
      className="app-story-review"
      onSubmit={(e) => {
        e.preventDefault()
        setRule(REVIEW_REASONS.find((r) => r.reason === reason)?.rule ?? '')
        void save(() => skip({ storyId: story._id, reason: cleanReason }))
      }}
    >
      <label className="app-story-review-label">
        Why skip this story?
        <select
          className="app-select"
          value={reason}
          autoFocus
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        >
          {REVIEW_REASONS.map((r) => (
            <option key={r.reason}>{r.reason}</option>
          ))}
          <option>Something else</option>
        </select>
      </label>
      {reason === 'Something else' ? (
        <label className="app-story-review-label">
          Your reason
          <textarea
            className="app-select"
            rows={3}
            value={details}
            required
            maxLength={500}
            disabled={busy}
            onChange={(e) => setDetails(e.target.value)}
          />
        </label>
      ) : null}
      <p className="app-muted">
        {dry
          ? 'Records why, so you can teach future runs. '
          : 'Hides this story’s drafts from your approval list. '}
        {hasBufferPosts ? 'Posts already in Buffer stay there.' : ''} You can choose a playbook
        change after saving.
      </p>
      <div className="app-story-actions">
        <button
          type="submit"
          className="app-gate-secondary"
          disabled={busy || cleanReason.length < 3}
        >
          <BusyLabel busy={busy} idle="Skip story" working="Saving" />
        </button>
        <button
          type="button"
          className="app-link"
          disabled={busy}
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p className="app-muted" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}
/** Stories a run chose: kept on a real run, picked on a dry run. */
const KEPT = new Set(['kept', 'dry'])

/** The four things a run does, in order. A dry run stops before Buffer. */
const PHASES = [
  { key: 'research', label: 'Research', steps: ['research', 'search', 'read', 'plan', 'notes'] },
  { key: 'select', label: 'Choose', steps: ['select'] },
  { key: 'write', label: 'Write', steps: ['write'] },
  { key: 'publish', label: 'Send to Buffer', steps: ['publish'] },
] as const

const LIVE_WORDS = ['Researching', 'Choosing stories', 'Writing posts', 'Sending to Buffer']

/** How far a run has got: the index of the phase it is in, from its status and its log. */
function phaseOf(run: RunData): number {
  if (run.status === 'publishing') return 3
  if (run.status === 'writing') return 2
  let at = 0
  for (const s of run.steps) {
    const index = PHASES.findIndex((p) => (p.steps as readonly string[]).includes(s.step))
    if (index > at) at = index
  }
  return at
}

/** "48 s", "1 min 8 s". */
function took(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What the run came to, in one line, and what the person can do about it. */
function Outcome({ run, id, shared }: { run: RunData; id?: Id<'automations'>; shared: boolean }) {
  const setStatus = useMutation(api.automations.setStatus)
  const trigger = useMutation(api.runs.trigger)
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const live = !run.finishedAt
  const tz = run.timezone
  const reviewed = new Set(run.stories.filter((s) => s.review).map((s) => s._id))
  const posts = run.posts.filter((p) => !reviewed.has(p.storyId))
  const count = (...statuses: string[]) => posts.filter((p) => statuses.includes(p.status)).length
  const kept = run.stories.filter((s) => KEPT.has(s.decision)).length
  const found = run.stories.length
  const repeats = run.stories.filter((s) => s.decision === 'skipped_dup').length
  const drafts = count('draft')
  const sent = count('sent')
  const booked = count('queued', 'scheduled', 'publishing')
  const held = count('held')
  const wouldSend = count('dry')
  const deleted = count('deleted')
  const lastNote = run.steps.at(-1)?.note ?? ''

  let headline: string
  let detail: string | null = null
  if (live) headline = `${LIVE_WORDS[phaseOf(run)]}…`
  else if (run.status === 'failed') {
    headline = 'This run stopped early.'
    detail = lastNote
  } else if (run.status === 'skipped') {
    headline = 'This run was skipped.'
    detail = lastNote
  } else if (run.kind === 'dry')
    headline = wouldSend
      ? `It would send ${plural(wouldSend, 'post')} for ${plural(kept, 'story', 'stories')}.`
      : kept
        ? `It kept ${plural(kept, 'story', 'stories')}, but none of the posts passed the checks.`
        : 'Nothing worth posting this time.'
  else if (drafts)
    headline = `${plural(drafts, 'draft')} ${drafts === 1 ? 'is' : 'are'} waiting for your approval.`
  else if (booked || sent)
    headline = [
      booked ? `${plural(booked, 'post')} scheduled in Buffer` : null,
      sent ? `${plural(sent, 'post')} ${booked ? 'already sent' : 'sent'}` : null,
    ]
      .filter(Boolean)
      .join(', ')
      .concat('.')
  else if (held) headline = `${plural(held, 'post')} waiting for Buffer.`
  else if (deleted)
    headline = `${plural(deleted, 'post')} reached Buffer, then ${deleted === 1 ? 'was' : 'were'} deleted there.`
  else if (kept) headline = 'No posts reached Buffer.'
  else headline = found ? 'Nothing new worth posting this time.' : 'No stories found this time.'
  if (!live && run.status === 'done' && held && (drafts || booked || sent))
    detail = `${plural(held, 'more post')} waiting for Buffer to accept them.`
  else if (!live && run.status === 'done' && deleted && (drafts || booked || sent || held))
    detail = `${plural(deleted, 'more post')} ${deleted === 1 ? 'was' : 'were'} deleted in Buffer.`

  const facts = [
    found
      ? `Found ${plural(found, 'story', 'stories')}, kept ${kept}${repeats ? `, ${repeats} already covered` : ''}.`
      : null,
    run.usage.webSearches
      ? `${plural(run.usage.webSearches, 'search', 'searches')}, ${plural(run.usage.webFetches, 'page')} read.`
      : null,
    run.finishedAt ? `Took ${took(run.finishedAt - run.startedAt)}.` : null,
    run.finishedAt && run.costUsd > 0 ? `Cost ${usd(run.costUsd)}.` : null,
  ].filter(Boolean)

  const canTurnOn =
    !shared && id && run.kind === 'dry' && !live && run.automation?.status === 'ready'
  const next = run.automation?.nextRunAt ?? null
  // A failed run's next step is right here: try again (a dry run stays dry), or change the playbook.
  const canRetry = !shared && id && !live && run.status === 'failed'
  const retryDry = run.kind === 'dry'
  const retry = () => {
    setBusy(true)
    setError(null)
    trigger({ automationId: id!, dry: retryDry })
      .then((runId) => navigate({ to: '/app/a/$id/runs/$runId', params: { id: id!, runId } }))
      .catch((reason: unknown) => setError(errorText(reason, 'It did not start. Try again.')))
      .finally(() => setBusy(false))
  }
  return (
    <div className="run-outcome" data-live={live} data-status={run.status} role="status">
      {live ? (
        <ol className="run-phases" aria-label="Progress">
          {PHASES.filter((p) => run.kind !== 'dry' || p.key !== 'publish').map((p, i) => {
            const at = phaseOf(run)
            return (
              <li key={p.key} data-state={i < at ? 'done' : i === at ? 'now' : 'later'}>
                {p.label}
              </li>
            )
          })}
        </ol>
      ) : null}
      <p className="run-headline">
        {live ? <span className="flow-spinner" aria-hidden="true" /> : null}
        {headline}
      </p>
      {detail ? <p className="run-detail">{detail}</p> : null}
      {facts.length ? <p className="run-facts">{facts.join(' ')}</p> : null}
      {run.kind === 'dry' && !live ? (
        <p className="run-detail">A dry run sends nothing to Buffer.</p>
      ) : null}
      {canTurnOn ? (
        <div className="run-next">
          <button
            type="button"
            className="app-gate-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              setError(null)
              setStatus({ id, status: 'active' })
                .catch((reason: unknown) =>
                  setError(errorText(reason, 'Not turned on. Try again.')),
                )
                .finally(() => setBusy(false))
            }}
          >
            <BusyLabel busy={busy} idle="Turn it on" working="Turning on" />
          </button>
          <span className="app-muted">Happy with these? From now on it runs on its schedule.</span>
          {error ? (
            <span className="app-connection-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      ) : null}
      {!canTurnOn && !live && !shared && next ? (
        <p className="run-detail">Next run {relativeWhenInline(next, tz)}.</p>
      ) : null}
      {canRetry ? (
        <div className="run-next">
          <button type="button" className="app-gate-primary" disabled={busy} onClick={retry}>
            <BusyLabel
              busy={busy}
              idle={retryDry ? 'Dry run again' : 'Run again'}
              working="Starting"
            />
          </button>
          <Link to="/app/a/$id" params={{ id: id! }} className="app-link">
            Change the playbook
          </Link>
          {error ? (
            <span className="app-connection-error" role="alert">
              {error}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** "Sent Tue, 08:22", "Scheduled for tomorrow, 09:00", "Draft": a post's status and its one time. */
function postWhen(post: RunData['posts'][number], tz: string): string {
  const words = POST_WORDS[post.status] ?? post.status
  const status = words.charAt(0).toUpperCase() + words.slice(1)
  // Its old time ("for today, 08:01") no longer means anything once it is gone from Buffer.
  if (post.status === 'deleted') return status
  if (post.status === 'sent') {
    const at = post.dueAt ?? post.sentAt
    return at ? `${status} ${relativeWhenInline(at, tz)}` : status
  }
  if (post.dueAt) return `${status} for ${relativeWhenInline(post.dueAt, tz)}`
  if (post.plannedFor) return `${status}, planned for ${relativeWhenInline(post.plannedFor, tz)}`
  return status
}

/** One post as the network will show it: the only card on the page. */
function PostCard({
  post,
  story,
  run,
  shared,
}: {
  post: RunData['posts'][number]
  story: RunData['stories'][number] | undefined
  run: RunData
  shared: boolean
}) {
  const approve = useAction(api.runs.approve)
  const [editing, setEditing] = useState(false)
  const [approving, setApproving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const tz = run.timezone
  const parts = [post.text, ...(post.thread ?? [])]
  const actionable = post.status === 'draft' && !story?.review && !shared && !editing
  return (
    <li className="app-draft" data-status={post.status}>
      <p className="app-draft-head">
        <span className="app-draft-avatar" aria-hidden="true">
          <ChannelMark channel={serviceName(post.service)} size={14} />
        </span>
        <strong>{post.channelName}</strong>
        <span className="run-post-status">{postWhen(post, tz)}</span>
      </p>
      {editing ? (
        <DraftEditor
          postId={post._id}
          text={post.text}
          service={post.service}
          limit={post.limit}
          onDone={() => setEditing(false)}
        />
      ) : (
        parts.map((part, i) => <PostText key={i} text={part} />)
      )}
      {post.linkAttachment ? (
        <p className="app-muted">Link card: {post.linkAttachment.title}</p>
      ) : null}
      {post.metrics?.length ? (
        <p className="app-muted tabular">
          {post.metrics
            .filter((m) => m.value > 0)
            .map(metricLabel)
            .join(', ')}
        </p>
      ) : null}
      {post.reason && !(post.status === 'deleted' && /^Deleted in Buffer\.?$/.test(post.reason)) ? (
        <p className="run-post-reason">{post.reason}</p>
      ) : null}
      {story?.review && post.bufferPostId ? (
        <p className="app-muted">Skipped in Dispatchlet. Its status in Buffer is unchanged.</p>
      ) : null}
      <div className="app-gate-actions">
        <span className="app-muted tabular run-post-length">
          {measuredLength(post.text, post.service as Service)} characters
          {post.thread?.length ? `, ${post.thread.length + 1} parts` : ''}
        </span>
        {actionable ? (
          <button type="button" className="app-link" onClick={() => setEditing(true)}>
            Edit
          </button>
        ) : null}
        {actionable ? (
          <button
            type="button"
            className="app-gate-primary"
            disabled={approving}
            onClick={() => {
              setApproving(true)
              approve({ postId: post._id })
                .then(setNote)
                .catch((reason: unknown) => setNote(errorText(reason, 'Not approved.')))
                .finally(() => setApproving(false))
            }}
          >
            <BusyLabel busy={approving} idle="Approve" working="Approving" />
          </button>
        ) : null}
        {post.externalLink ? (
          <a
            href={webHref(post.externalLink)}
            target="_blank"
            rel="noreferrer"
            className="app-link"
          >
            See it live
          </a>
        ) : null}
        {post.bufferPostId && !shared && post.status !== 'deleted' ? (
          <a
            href={bufferChannelUrl(post.channelId, post.status, post.bufferPostId)}
            target="_blank"
            rel="noreferrer"
            className="app-gate-secondary app-buffer-link"
          >
            <BufferMark size={14} />
            Open in Buffer
          </a>
        ) : null}
        {note ? (
          <span className="app-muted" role="status">
            {note}
          </span>
        ) : null}
      </div>
    </li>
  )
}

/** Why a story was left out, as a short tag. */
const LEFT_OUT_WORDS: Record<string, string> = {
  skipped_dup: 'Already covered',
  skipped_quality: 'Not sure enough',
  skipped_limit: 'No room',
}

function RunView({
  run,
  id,
  shared = false,
}: {
  run: RunData
  id?: Id<'automations'>
  shared?: boolean
}) {
  const runId = run._id
  const runName = `${run.kind === 'dry' ? 'Dry run' : run.kind === 'now' ? 'Run' : 'Scheduled run'}, ${relativeWhenInline(run.startedAt, run.timezone)}`
  usePageTitle(shared ? null : `${runName} · ${run.automationName}`)
  const share = useMutation(api.runs.share)
  const unshare = useMutation(api.runs.unshare)
  const [shareNote, setShareNote] = useState<string | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const shareAct = (work: () => Promise<string | null>) => {
    setShareBusy(true)
    setShareError(null)
    work()
      .then((note) => setShareNote(note))
      .catch((reason: unknown) => setShareError(errorText(reason, 'That did not work. Try again.')))
      .finally(() => setShareBusy(false))
  }
  const live = !run.finishedAt
  const kept = run.stories.filter((s) => KEPT.has(s.decision))
  const leftOut = run.stories.filter((s) => !KEPT.has(s.decision))
  const postsFor = (storyId: Id<'stories'>) => run.posts.filter((p) => p.storyId === storyId)
  const orphans = run.posts.filter((p) => !kept.some((s) => s._id === p.storyId))
  return (
    <article className="run-page">
      {shared || !id ? (
        <p className="app-crumbs">{run.automationName}, shared from Dispatchlet.</p>
      ) : (
        <p className="app-crumbs is-always">
          <Link to="/app">Home</Link> /{' '}
          <Link to="/app/a/$id" params={{ id }}>
            {run.automationName}
          </Link>
        </p>
      )}
      <header className="run-head">
        <h1>{runName}</h1>
        {!shared && id ? (
          <div className="app-share">
            {run.shareToken ? (
              <>
                <span className="app-muted">Shared</span>
                <button
                  type="button"
                  className="app-link"
                  disabled={shareBusy}
                  onClick={() => shareAct(() => copyLink(run.shareToken!))}
                >
                  Copy link
                </button>
                <a href={`${window.location.origin}/r/${run.shareToken}`} className="app-link">
                  Open it
                </a>
                <button
                  type="button"
                  className="app-link"
                  disabled={shareBusy}
                  onClick={() => shareAct(() => unshare({ runId }).then(() => 'No longer shared.'))}
                >
                  Stop sharing
                </button>
              </>
            ) : (
              <button
                type="button"
                className="app-link"
                disabled={shareBusy}
                onClick={() => shareAct(() => share({ runId }).then(copyLink))}
              >
                Share this run
              </button>
            )}
            {shareNote ? <span className="app-muted">{shareNote}</span> : null}
            {shareError ? (
              <span className="app-connection-error" role="alert">
                {shareError}
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      <Outcome run={run} id={id} shared={shared} />

      {live ? <RunLog run={run} live /> : null}

      {kept.length ? (
        <section className="run-section" aria-labelledby="run-stories">
          <h2 id="run-stories">
            {run.kind === 'dry' ? 'What it would post' : 'Stories'}
            <span className="run-count tabular">{kept.length}</span>
          </h2>
          <ol className="run-stories">
            {kept.map((s) => {
              const posts = postsFor(s._id)
              return (
                <li key={s._id} className="run-story" data-skipped={Boolean(s.review)}>
                  <p className="run-story-meta">
                    {s.review ? <span className="run-tag">Skipped by you</span> : null}
                    <span>{s.source}</span>
                    {s.eventDate ? <span>Happened {s.eventDate}</span> : null}
                    {s.forDate ? <span>For {s.forDate}</span> : null}
                  </p>
                  <h3>
                    <a href={webHref(s.url)} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                  </h3>
                  <p className="run-story-summary">{s.summary}</p>
                  {s.whyItMatters ? <p className="run-story-why">{s.whyItMatters}</p> : null}
                  {posts.length ? (
                    <ul className="app-drafts run-posts">
                      {posts.map((p) => (
                        <PostCard key={p._id} post={p} story={s} run={run} shared={shared} />
                      ))}
                    </ul>
                  ) : live ? (
                    <p className="app-muted">Writing its posts…</p>
                  ) : null}
                  {!shared && id && !live ? (
                    <div className="run-story-actions">
                      <StoryReview
                        story={s}
                        hasBufferPosts={posts.some((p) => Boolean(p.bufferPostId))}
                        dry={run.kind === 'dry'}
                        published={posts.some((p) =>
                          ['sent', 'scheduled', 'queued', 'publishing'].includes(p.status),
                        )}
                      />
                      {IDEA_DECISIONS.has(s.decision) ? (
                        <SaveIdea storyId={s._id} saved={s.savedAsIdea} />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </section>
      ) : null}

      {orphans.length ? (
        <section className="run-section">
          <h2>Other posts</h2>
          <ul className="app-drafts run-posts">
            {orphans.map((p) => (
              <PostCard
                key={p._id}
                post={p}
                story={run.stories.find((s) => s._id === p.storyId)}
                run={run}
                shared={shared}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {leftOut.length ? (
        <section className="run-section" aria-labelledby="run-left-out">
          <h2 id="run-left-out">
            Left out<span className="run-count tabular">{leftOut.length}</span>
          </h2>
          <ul className="run-left-out">
            {leftOut.map((s) => (
              <li key={s._id}>
                <span className="run-tag">{LEFT_OUT_WORDS[s.decision] ?? s.decision}</span>
                <div>
                  <a href={webHref(s.url)} target="_blank" rel="noreferrer">
                    {s.title}
                  </a>{' '}
                  <span className="app-muted">{s.source}</span>
                  <p className="app-muted">
                    {s.repeatOf?.title
                      ? `Same story as “${s.repeatOf.title}”. `
                      : `${leftOutReason(s.reason)} `}
                    {s.repeatOf?.runId && id && !shared ? (
                      <Link
                        to="/app/a/$id/runs/$runId"
                        params={{ id, runId: s.repeatOf.runId }}
                        className="app-link"
                      >
                        See the earlier run
                      </Link>
                    ) : null}
                  </p>
                  {!shared && id && IDEA_DECISIONS.has(s.decision) ? (
                    <SaveIdea storyId={s._id} saved={s.savedAsIdea} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {live ? null : <RunLog run={run} live={false} />}
    </article>
  )
}

/** Runs before 14 Nov stored "Over the 3 a run you asked for."; they read the way new runs do. */
function leftOutReason(reason: string): string {
  const m = /^Over the (\d+) a run you asked for\.$/.exec(reason)
  return m ? limitReason(Number(m[1])) : reason
}

/** Log lines about single searches and page reads: shown smaller, as the run's working. */
const TOOL_STEPS = new Set(['search', 'read'])

const LEGACY_TOOL_ERROR = /^A (page open|search) failed \((\w+)\): (.*)$/s

/** Runs logged before 13 Nov wrote raw error codes and JSON; they read the way new runs do. */
function legacyNote(note: string): string {
  const m = LEGACY_TOOL_ERROR.exec(note)
  if (!m) return note
  const tool = m[1] === 'search' ? 'web_search' : 'web_fetch'
  let input: unknown = null
  try {
    input = JSON.parse(m[3]!)
  } catch {
    input = null
  }
  return (
    toolNote({ tool, input: toolInput(tool, input), error: m[2]! }) ??
    `A ${m[1]} did not work, so it moved on.`
  )
}

/** The step log. Open while the run works, so it reads as a live feed; folded once it is done. */
function RunLog({ run, live }: { run: RunData; live: boolean }) {
  const tz = run.timezone
  const items = (
    <ol className="app-log" aria-label="Run log" aria-live={live ? 'polite' : undefined}>
      {run.steps.map((s, i) => (
        <li key={i} data-kind={TOOL_STEPS.has(s.step) ? 'tool' : s.step}>
          <time className="tabular" dateTime={new Date(s.at).toISOString()}>
            {timeIn(s.at, tz)}
          </time>
          {s.step === 'notes' ? (
            <LogNote text={s.note} label="Research notes" />
          ) : (
            <LogNote text={legacyNote(s.note)} />
          )}
        </li>
      ))}
      {live ? (
        <li className="is-running">
          <time className="tabular">now</time>
          <p className="app-muted">{LIVE_WORDS[phaseOf(run)]}…</p>
        </li>
      ) : null}
    </ol>
  )
  if (live)
    return (
      <section className="run-section run-feed" aria-label="What it is doing">
        {items}
      </section>
    )
  return (
    <details className="run-section run-log">
      <summary>
        <h2>Run log</h2>
        <span className="app-muted">
          Every search, page and decision, with times.{' '}
          {plural(run.steps.length, 'entry', 'entries')}.
        </span>
      </summary>
      {items}
    </details>
  )
}

/** Notes past this length start folded to three lines: research notes can run to a page. */
const LONG_NOTE = 320

/** One line of the run log. A long note folds, with a control to read the rest. */
function LogNote({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false)
  if (text.length <= LONG_NOTE && !label) return <p>{text}</p>
  return (
    <div>
      {label ? <p className="app-log-label">{label}</p> : null}
      <p className="app-log-note" data-open={open || text.length <= LONG_NOTE}>
        {text}
      </p>
      {text.length > LONG_NOTE ? (
        <button
          type="button"
          className="app-link app-log-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <BusyLabel busy={open} idle="Show the whole note" working="Show less" />
        </button>
      ) : null}
    </div>
  )
}
