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
  serviceName,
  timeIn,
  usd,
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
  if (run === undefined) return null
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

/** One run as a log: a timestamp spine on the left, what happened on the right (SPEC §23.4). */
export function RunPage({ id, runId }: { id: Id<'automations'>; runId: Id<'runs'> }) {
  const run = useQuery(api.runs.get, { runId })
  if (run === undefined) return <p className="app-muted">Loading.</p>
  if (run === null) return <p>This run does not exist, or it is not yours.</p>
  return <RunView run={run} id={id} />
}

type RunData = NonNullable<ReturnType<typeof useQuery<typeof api.runs.get>>>

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
  const addRule = useMutation(api.automations.addExcludeRule)
  const [ruleFor, setRuleFor] = useState<string | null>(null)
  const [rule, setRule] = useState('')
  const [ruleNote, setRuleNote] = useState<Record<string, string>>({})
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
        {title}, {whenIn(run.startedAt, tz)}.
      </h1>
      <p className="app-status-line">
        {live
          ? 'Running.'
          : `${run.status === 'done' ? 'Finished' : run.status === 'failed' ? 'Failed' : 'Skipped'} at ${timeIn(run.finishedAt!, tz)}.`}{' '}
        {run.costUsd > 0 ? `Cost ${usd(run.costUsd)}.` : ''}
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
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(`${window.location.origin}/r/${run.shareToken}`)
                    .then(() => setShareNote('Link copied.'))
                }}
              >
                Copy link
              </button>
              <a href={`${window.location.origin}/r/${run.shareToken}`} className="app-link">
                Open it
              </a>
              <button
                type="button"
                className="app-link"
                onClick={() => unshare({ runId }).then(() => setShareNote('No longer shared.'))}
              >
                Stop sharing
              </button>
            </>
          ) : (
            <button
              type="button"
              className="app-link"
              onClick={() =>
                share({ runId }).then((token) => {
                  void navigator.clipboard?.writeText(`${window.location.origin}/r/${token}`)
                  setShareNote('Link copied.')
                })
              }
            >
              Share this run
            </button>
          )}
          {shareNote ? <span className="app-muted">{shareNote}</span> : null}
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
                <li key={s._id} data-kept={kept}>
                  <p className="app-story-head">
                    <span className="app-story-decision">
                      {DECISION_WORDS[s.decision] ?? s.decision}
                    </span>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.title}
                    </a>
                    <span className="app-muted">{s.source}</span>
                  </p>
                  <p className="app-muted">
                    {s.reason}
                    {kept ? ` ${s.whyItMatters}` : ''}
                  </p>
                  {kept ? <p>{s.summary}</p> : null}
                  {kept && !shared && id && !ruleNote[s._id] ? (
                    ruleFor === s._id ? (
                      <form
                        className="app-field"
                        onSubmit={(e) => {
                          e.preventDefault()
                          addRule({ id: id!, rule })
                            .then((version) => {
                              setRuleNote((n) => ({
                                ...n,
                                [s._id]: `Added to the playbook as version ${version}. The next run skips it.`,
                              }))
                              setRuleFor(null)
                              setRule('')
                            })
                            .catch((reason: unknown) =>
                              setRuleNote((n) => ({
                                ...n,
                                [s._id]: errorText(reason, 'Not saved.'),
                              })),
                            )
                        }}
                      >
                        <input
                          className="app-select app-rule"
                          value={rule}
                          autoFocus
                          maxLength={200}
                          placeholder="What should it skip from now on? One sentence."
                          aria-label="Skip rule"
                          onChange={(e) => setRule(e.target.value)}
                        />
                        <button
                          type="submit"
                          className="app-gate-secondary"
                          disabled={rule.trim().length < 3}
                        >
                          Add to playbook
                        </button>
                        <button type="button" className="app-link" onClick={() => setRuleFor(null)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="app-link"
                        onClick={() => {
                          setRuleFor(s._id)
                          setRule('')
                        }}
                      >
                        Don’t post things like this
                      </button>
                    )
                  ) : null}
                  {ruleNote[s._id] ? <p className="app-muted">{ruleNote[s._id]}</p> : null}
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
                      {p.dueAt ? ` for ${whenIn(p.dueAt, tz)}` : ''}
                      {p.sentAt ? ` at ${whenIn(p.sentAt, tz)}` : ''}
                    </span>
                  </p>
                  {story ? <p className="app-muted">{story.title}</p> : null}
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
                        .map(
                          (m) =>
                            `${m.value.toLocaleString('en-GB')} ${m.type.replaceAll('_', ' ')}`,
                        )
                        .join(', ')}
                    </p>
                  ) : null}
                  {p.linkAttachment ? (
                    <p className="app-muted">Link card: {p.linkAttachment.title}</p>
                  ) : null}
                  {p.reason ? <p className="app-muted">{p.reason}</p> : null}
                  <p className="app-muted tabular">
                    {measuredLength(p.text, p.service as Service)} characters
                    {p.thread?.length ? `, ${p.thread.length + 1} parts` : ''}
                  </p>
                  <div className="app-gate-actions">
                    {p.status === 'draft' && !shared && editing !== p._id ? (
                      <button type="button" className="app-link" onClick={() => setEditing(p._id)}>
                        Edit
                      </button>
                    ) : null}
                    {p.status === 'draft' && !shared ? (
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
                    {p.bufferStatus && !shared ? (
                      <a
                        href={bufferChannelUrl(p.channelId, p.status)}
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
        {open ? 'Show less' : 'Show the whole note'}
      </button>
    </div>
  )
}
