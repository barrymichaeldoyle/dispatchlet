import type { Doc } from './_generated/dataModel'

/** A post as the API and webhooks show it. The approve token never leaves the email path. */
export function postView(p: Doc<'posts'>, channelName: string) {
  return {
    _id: p._id,
    runId: p.runId,
    automationId: p.automationId,
    storyId: p.storyId,
    channelId: p.channelId,
    channelName,
    service: p.service,
    text: p.text,
    thread: p.thread ?? null,
    linkAttachment: p.linkAttachment ?? null,
    status: p.status,
    reason: p.reason ?? null,
    bufferPostId: p.bufferPostId ?? null,
    bufferStatus: p.bufferStatus ?? null,
    externalLink: p.externalLink ?? null,
    dueAt: p.dueAt ?? null,
    sentAt: p.sentAt ?? null,
    metrics: p.metrics ?? null,
    createdAt: p.createdAt,
  }
}
