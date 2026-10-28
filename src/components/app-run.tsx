import { Link } from '@tanstack/react-router'
import { useAction, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { ChannelMark } from './brand-icons'
import { measuredLength } from '../../convex/lib/ai/write'
import type { Service } from '../../convex/lib/ai/setup'
import { errorText, serviceName, timeIn, usd, whenIn } from '../lib/format'

const DECISION_WORDS: Record<string, string> = {
  kept: 'Kept',
  dry: 'Kept',
  skipped_dup: 'Already covered',
  skipped_quality: 'Skipped',
  skipped_limit: 'Over the limit',
}

const POST_WORDS: Record<string, string> = {
  dry: 'would be sent',
  rejected: 'not used',
  skipped: 'skipped',
  held: 'waiting for Buffer',
  draft: 'draft',
  queued: 'queued',
  scheduled: 'scheduled',
  sent: 'sent',
  failed: 'failed',
}

/** One run as a log: a timestamp spine on the left, what happened on the right (SPEC §23.4). */
export function RunPage({ id, runId }: { id: Id<'automations'>; runId: Id<'runs'> }) {
  const run = useQuery(api.runs.get, { runId })
  const approve = useAction(api.runs.approve)
  const [approving, setApproving] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  if (run === undefined) return <p className="app-muted">Loading.</p>
  if (run === null) return <p>This run does not exist, or it is not yours.</p>
  const live = !run.finishedAt
  const stepsDone = ['research', 'select', 'write', 'publish'].filter((s) =>
    run.steps.some((x) => x.step === s),
  ).length
  const progress = run.finishedAt ? 1 : Math.max(0.08, stepsDone / 4)
  const tz = run.timezone
  const title = run.kind === 'dry' ? 'Dry run' : run.kind === 'now' ? 'Run' : 'Scheduled run'
  return (
    <>
      <p className="app-crumbs">
        <Link to="/app">Home</Link> /{' '}
        <Link to="/app/a/$id" params={{ id }}>
          {run.automationName}
        </Link>
      </p>
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
              <p>{s.note}</p>
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
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
      {run.posts.length ? (
        <section className="app-section">
          <h2>Posts</h2>
          <ul className="app-posts">
            {run.posts.map((p) => {
              const story = run.stories.find((s) => s._id === p.storyId)
              const parts = [p.text, ...(p.thread ?? [])]
              return (
                <li key={p._id}>
                  <p className="app-post-head">
                    <ChannelMark channel={serviceName(p.service)} size={14} />
                    <strong>{p.channelName}</strong>
                    <span className="app-muted">
                      {POST_WORDS[p.status] ?? p.status}
                      {p.dueAt ? ` for ${whenIn(p.dueAt, tz)}` : ''}
                      {p.sentAt ? ` at ${whenIn(p.sentAt, tz)}` : ''}
                    </span>
                    {p.externalLink ? (
                      <a href={p.externalLink} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    ) : null}
                    {story ? <span className="app-muted">{story.title}</span> : null}
                  </p>
                  {parts.map((part, i) => (
                    <p key={i} className="app-post-text">
                      {part}
                    </p>
                  ))}
                  {p.linkAttachment ? (
                    <p className="app-muted">Link card: {p.linkAttachment.title}</p>
                  ) : null}
                  {p.reason ? <p className="app-muted">{p.reason}</p> : null}
                  <p className="app-muted tabular">
                    {measuredLength(p.text, p.service as Service)} characters
                    {p.thread?.length ? `, ${p.thread.length + 1} parts` : ''}
                  </p>
                  {p.status === 'draft' ? (
                    <div className="app-gate-actions">
                      <button
                        type="button"
                        className="app-gate-secondary"
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
                        {approving === p._id ? 'Approving' : 'Approve'}
                      </button>
                      <span className="app-muted" role="status">
                        {notes[p._id] ?? ''}
                      </span>
                    </div>
                  ) : notes[p._id] ? (
                    <p className="app-muted">{notes[p._id]}</p>
                  ) : null}
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
