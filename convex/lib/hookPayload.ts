import { z } from 'zod'

/**
 * What an inbound hook accepts (SPEC §44.5): a GitHub release event, a generic
 * `{ title, url?, notes?, dry? }`, or nothing at all (a plain "run now").
 */
export const HookBody = z.object({
  dry: z.boolean().optional(),
  hint: z
    .object({
      title: z.string().trim().min(1).max(200),
      url: z.string().url().max(500).optional(),
      notes: z.string().trim().max(1000).optional(),
    })
    .optional(),
})
export type HookBody = z.infer<typeof HookBody>

type Mapped = { ok: true; body: HookBody } | { ok: false; message: string }

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Maps a request body to a hook body. `githubEvent` is the X-GitHub-Event header, if any. */
export function mapHookBody(githubEvent: string | null, body: unknown): Mapped {
  const obj =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  if (obj === null)
    return { ok: false, message: 'Send a JSON object, or an empty body to run now.' }
  if (githubEvent) {
    if (githubEvent === 'ping') return { ok: true, body: {} }
    if (githubEvent !== 'release')
      return {
        ok: false,
        message: `GitHub event "${githubEvent}" is not handled. Send only release events.`,
      }
    if (obj.action !== 'published' && obj.action !== 'released')
      return {
        ok: false,
        message: `Release "${String(obj.action)}" is ignored. Only published releases start a run.`,
      }
    const release =
      obj.release !== null && typeof obj.release === 'object'
        ? (obj.release as Record<string, unknown>)
        : {}
    const repo =
      obj.repository !== null && typeof obj.repository === 'object'
        ? (obj.repository as Record<string, unknown>)
        : {}
    const name = str(release.name) ?? str(release.tag_name)
    if (!name) return { ok: false, message: 'The release has no name or tag.' }
    const repoName = str(repo.full_name)
    const notes = str(release.body)
    return {
      ok: true,
      body: {
        hint: {
          title: repoName ? `${repoName} ${name}` : name,
          url: str(release.html_url),
          notes: notes ? notes.slice(0, 1000) : undefined,
        },
      },
    }
  }
  if (Object.keys(obj).length === 0) return { ok: true, body: {} }
  const title = str(obj.title)
  const dry = typeof obj.dry === 'boolean' ? obj.dry : undefined
  if (!title) {
    if (dry !== undefined && Object.keys(obj).length === 1) return { ok: true, body: { dry } }
    return { ok: false, message: 'Give the story a title, or send an empty body to run now.' }
  }
  return {
    ok: true,
    body: { dry, hint: { title, url: str(obj.url), notes: str(obj.notes)?.slice(0, 1000) } },
  }
}
