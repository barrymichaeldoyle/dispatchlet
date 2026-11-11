import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction } from './_generated/server'
import { CHAT_LIMITS, CHAT_SYSTEM, ChatReply } from './lib/ai/chat'
import { anthropicClient, callStructured, modelFor } from './lib/ai/client'
import { keyFor } from './users'

export const respond = internalAction({
  args: { turnId: v.id('automationChatTurns') },
  returns: v.null(),
  handler: async (ctx, { turnId }) => {
    try {
      const claimed = await ctx.runMutation(internal.automationChat.claim, { turnId })
      if (!claimed) return null
      const client = anthropicClient(
        claimed.usesSharedKey ? undefined : await keyFor(claimed.user),
      ).withOptions({
        timeout: CHAT_LIMITS.timeoutMs,
        maxRetries: 0,
      })
      const { output, record } = await callStructured(client, {
        model: modelFor('chat'),
        system: CHAT_SYSTEM,
        user: claimed.prompt,
        schema: ChatReply,
        effort: 'medium',
        maxTokens: CHAT_LIMITS.maxTokens,
        retryMalformed: false,
        captureInvalidOutput: true,
      })
      await ctx.runMutation(internal.automationChat.finish, {
        turnId,
        output: output ?? undefined,
        record,
        error: record.refusal ? 'declined' : undefined,
      })
    } catch {
      // Provider error bodies can contain request data; never return them as chat messages.
      await ctx.runMutation(internal.automationChat.finish, { turnId, error: 'service' })
    }
    return null
  },
})
