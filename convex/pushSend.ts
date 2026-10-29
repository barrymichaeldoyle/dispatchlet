'use node'

import { v } from 'convex/values'
import webPush from 'web-push'
import { internal } from './_generated/api'
import { internalAction } from './_generated/server'

/** Sends one push to every device of a user. A gone subscription is dropped, nothing else retried. */
export const send = internalAction({
  args: {
    userId: v.id('users'),
    title: v.string(),
    body: v.string(),
    url: v.string(),
    tag: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { userId, title, body, url, tag }) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY
    const privateKey = process.env.VAPID_PRIVATE_KEY
    if (!publicKey || !privateKey) return null
    webPush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? 'mailto:barry@dispatchlet.com',
      publicKey,
      privateKey,
    )
    const subscriptions = await ctx.runQuery(internal.push.forUser, { userId })
    const payload = JSON.stringify({ title, body, url, tag })
    for (const s of subscriptions) {
      try {
        await webPush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, {
          TTL: 6 * 3600,
        })
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410)
          await ctx.runMutation(internal.push.drop, { endpoint: s.endpoint })
        else console.log(`Push failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return null
  },
})
