import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalQuery } from './_generated/server'
import { anthropicClient, callStructured, modelFor } from './lib/ai/client'
import { GENERATE_SYSTEM, generateUserMessage, Playbook } from './lib/ai/generate'
import type { SetupAnswers } from './lib/ai/setup'
import { keyFor } from './users'

export const forGeneration = internalQuery({
  args: { automationId: v.id('automations') },
  handler: async (ctx, { automationId }) => {
    const automation = await ctx.db.get(automationId)
    if (!automation) return null
    const user = await ctx.db.get(automation.userId)
    return { automation, user }
  },
})

/** Writes the playbook from the setup answers, with web search to confirm the sources. */
export const generate = internalAction({
  args: { automationId: v.id('automations') },
  returns: v.null(),
  handler: async (ctx, { automationId }) => {
    const loaded = await ctx.runQuery(internal.playbooks.forGeneration, { automationId })
    if (!loaded?.user) return null
    const { automation, user } = loaded
    try {
      const client = anthropicClient(await keyFor(user))
      const { output, record } = await callStructured(client, {
        model: modelFor('playbook'),
        effort: 'high',
        maxTokens: 8_000,
        system: GENERATE_SYSTEM,
        user: generateUserMessage(
          automation.setup as SetupAnswers,
          automation.setup.services,
          new Date(),
          automation.timezone,
        ),
        schema: Playbook,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
      })
      await ctx.runMutation(internal.ai.recordStandalone, {
        userId: user._id,
        purpose: 'playbook',
        ...record,
      })
      await ctx.runMutation(internal.automations.storeGenerated, {
        automationId,
        playbook: output,
        error: output
          ? undefined
          : (record.refusal ?? 'The playbook could not be written. Try again.'),
      })
    } catch (error) {
      await ctx.runMutation(internal.automations.storeGenerated, {
        automationId,
        playbook: null,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  },
})
