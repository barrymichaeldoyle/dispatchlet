import { PageSkeleton } from './page-skeleton'
import { MissingItem } from './route-error'
import { Link } from '@tanstack/react-router'
import { ConvexProvider, ConvexReactClient, useAction, useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { BufferMark, ChannelMark } from './brand-icons'
import { PostText } from './post-text'
import { Wordmark } from './wordmark'
import { measuredLength } from '../../convex/lib/ai/write'
import type { Service } from '../../convex/lib/ai/setup'
import {
  bufferChannelUrl,
  errorText,
  ideaLinkState,
  metricLabel,
  serviceName,
  timeIn,
  whenIn,
} from '../lib/format'
import { BusyLabel } from './busy-label'
import { DraftEditor } from './app-pages'

const DECISION_WORDS: Record<string, string> = {
  kept: 'Kept',
  dry: 'Kept',
  skipped_dup: 'Already covered',
  skipped_quality: 'Skipped',
  skipped_limit: 'Over the limit',
}

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
}: {
  story: RunData['stories'][number]
  hasBufferPosts: boolean
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
        Skip this story
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
        Hides this story’s drafts from your approval list.{' '}
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
  const approve = useAction(api.runs.approve)
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
  const [approving, setApproving] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const live = !run.finishedAt
  const stepsDone = ['research', 'select', 'write', 'publish'].filter((s) =>
    run.steps.some((x) => x.step === s),
  ).length
  const progress = run.finishedAt ? 1 : Math.max(0.08, stepsDone / 4)
  const tz = run.timezone
  const title = run.kind === 'dry' ? 'Dry run' : run.kind === 'now' ? 'Run' : 'Scheduled run'
  return (
    <>
      {shared || !id ? (
        <p className="app-crumbs">{run.automationName}, shared from Dispatchlet.</p>
      ) : (
        <p className="app-crumbs">
          <Link to="/app">Home</Link> /{' '}
          <Link to="/app/a/$id" params={{ id }}>
            {run.automationName}
          </Link>
        </p>
      )}
      <h1>
        {title}, {whenIn(run.startedAt, tz)}
      </h1>
      <p className="app-status-line">
        {live
          ? 'Running.'
          : `${run.status === 'done' ? 'Finished' : run.status === 'failed' ? 'Failed' : 'Skipped'} at ${timeIn(run.finishedAt!, tz)}.`}{' '}
        {run.usage.webSearches
          ? ` ${run.usage.webSearches} searches, ${run.usage.webFetches} pages opened.`
          : ''}
      </p>
      {!shared && id ? (
        <div className="app-share">
          {run.shareToken ? (
            <>
              <span className="app-muted">Shared. Anyone with the link can read this run.</span>
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
      <div className="app-run" data-live={live}>
        <div className="app-run-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        <ol className="app-log" aria-label="Run log" aria-live={live ? 'polite' : undefined}>
          {run.steps.map((s, i) => (
            <li key={i}>
              <time className="tabular" dateTime={new Date(s.at).toISOString()}>
                {timeIn(s.at, tz)}
              </time>
              <LogNote text={s.note} />
            </li>
          ))}
          {live ? (
            <li className="is-running">
              <time className="tabular">now</time>
              <p className="app-muted">
                {run.status === 'writing'
                  ? 'Writing posts.'
                  : run.status === 'publishing'
                    ? 'Sending to Buffer.'
                    : 'Researching.'}
              </p>
            </li>
          ) : null}
        </ol>
      </div>
      {run.stories.length ? (
        <section className="app-section">
          <h2>Stories</h2>
          <ul className="app-stories">
            {run.stories.map((s) => {
              const kept = s.decision === 'kept' || s.decision === 'dry'
              return (
                <li key={s._id} data-kept={kept && !s.review}>
                  <p className="app-story-head">
                    <span className="app-story-decision">
                      {s.review ? 'Skipped by you' : (DECISION_WORDS[s.decision] ?? s.decision)}
                    </span>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                    <span className="app-muted">
                      {s.source}
                      {s.eventDate ? `, event ${s.eventDate}` : ''}
                      {s.forDate ? `, for ${s.forDate}` : ''}
                    </span>
                  </p>
                  <p className="app-muted">
                    {s.reason}
                    {kept ? ` ${s.whyItMatters}` : ''}
                  </p>
                  {kept ? <p>{s.summary}</p> : null}
                  {kept && !shared && id && !live ? (
                    <StoryReview
                      story={s}
                      hasBufferPosts={run.posts.some(
                        (p) => p.storyId === s._id && Boolean(p.bufferPostId),
                      )}
                    />
                  ) : null}
                  {!shared && id && IDEA_DECISIONS.has(s.decision) ? (
                    <SaveIdea storyId={s._id} saved={s.savedAsIdea} />
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
      {run.posts.length ? (
        <section className="app-section is-plain">
          <h2>Posts</h2>
          <ul className="app-drafts">
            {run.posts.map((p) => {
              const story = run.stories.find((s) => s._id === p.storyId)
              const parts = [p.text, ...(p.thread ?? [])]
              return (
                <li key={p._id} className="app-draft">
                  <p className="app-draft-head">
                    <span className="app-draft-avatar" aria-hidden="true">
                      <ChannelMark channel={serviceName(p.service)} size={14} />
                    </span>
                    <strong>{p.channelName}</strong>
                    <span className="app-muted">
                      {POST_WORDS[p.status] ?? p.status}
                      {p.dueAt
                        ? ` for ${whenIn(p.dueAt, tz)}`
                        : p.plannedFor
                          ? `, planned for ${whenIn(p.plannedFor, tz)}`
                          : ''}
                      {p.sentAt ? ` at ${whenIn(p.sentAt, tz)}` : ''}
                    </span>
                  </p>
                  {story ? <p className="app-muted app-draft-story">{story.title}</p> : null}
                  {editing === p._id ? (
                    <DraftEditor
                      postId={p._id}
                      text={p.text}
                      service={p.service}
                      limit={p.limit}
                      onDone={() => setEditing(null)}
                    />
                  ) : (
                    parts.map((part, i) => <PostText key={i} text={part} />)
                  )}
                  {p.metrics?.length ? (
                    <p className="app-muted tabular">
                      {p.metrics
                        .filter((m) => m.value > 0)
                        .map(metricLabel)
                        .join(', ')}
                    </p>
                  ) : null}
                  {p.linkAttachment ? (
                    <p className="app-muted">Link card: {p.linkAttachment.title}</p>
                  ) : null}
                  {story?.review ? (
                    <p className="app-muted">
                      Skipped in Dispatchlet. This post’s status in Buffer is unchanged.
                    </p>
                  ) : null}
                  {p.reason ? <p className="app-muted">{p.reason}</p> : null}
                  <p className="app-muted tabular">
                    {measuredLength(p.text, p.service as Service)} characters
                    {p.thread?.length ? `, ${p.thread.length + 1} parts` : ''}
                  </p>
                  <div className="app-gate-actions">
                    {p.status === 'draft' && !story?.review && !shared && editing !== p._id ? (
                      <button type="button" className="app-link" onClick={() => setEditing(p._id)}>
                        Edit
                      </button>
                    ) : null}
                    {p.status === 'draft' && !story?.review && !shared ? (
                      <button
                        type="button"
                        className="app-gate-primary"
                        disabled={approving === p._id}
                        onClick={() => {
                          setApproving(p._id)
                          approve({ postId: p._id })
                            .then((message) => setNotes((n) => ({ ...n, [p._id]: message })))
                            .catch((reason: unknown) =>
                              setNotes((n) => ({
                                ...n,
                                [p._id]: errorText(reason, 'Not approved.'),
                              })),
                            )
                            .finally(() => setApproving(null))
                        }}
                      >
                        <BusyLabel busy={approving === p._id} idle="Approve" working="Approving" />
                      </button>
                    ) : null}
                    {p.externalLink ? (
                      <a
                        href={p.externalLink}
                        target="_blank"
                        rel="noreferrer"
                        className="app-link"
                      >
                        See it live
                      </a>
                    ) : null}
                    {p.bufferPostId && !shared ? (
                      <a
                        href={bufferChannelUrl(p.channelId, p.status, p.bufferPostId)}
                        target="_blank"
                        rel="noreferrer"
                        className="app-gate-secondary app-buffer-link"
                      >
                        <BufferMark size={14} />
                        Open in Buffer
                      </a>
                    ) : null}
                    {notes[p._id] ? (
                      <span className="app-muted" role="status">
                        {notes[p._id]}
                      </span>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
      {run.error && run.status === 'failed' ? (
        <p className="app-connection-error">{run.error}</p>
      ) : null}
    </>
  )
}

/** Notes past this length start folded to three lines: research notes can run to a page. */
const LONG_NOTE = 320

/** One line of the run log. A long note folds, with a control to read the rest. */
function LogNote({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  if (text.length <= LONG_NOTE) return <p>{text}</p>
  return (
    <div>
      <p className="app-log-note" data-open={open}>
        {text}
      </p>
      <button
        type="button"
        className="app-link app-log-more"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <BusyLabel busy={open} idle="Show the whole note" working="Show less" />
      </button>
    </div>
  )
}
