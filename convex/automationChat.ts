import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'
import { recordStandaloneFor } from './ai'
import { automationEditContext, prepareAutomationEdit } from './automationEdits'
import { automationOf, ownAutomation } from './automations'
import { CHAT_LIMITS, chatPrompt, checkedChatReply } from './lib/ai/chat'
import { allowanceFor, globalDailyCapUsd } from './lib/limits'
import { renderPlaybook } from './lib/playbook'
import { aiCallRecordValidator } from './schema'

async function ownedConversation(ctx: QueryCtx | MutationCtx, id: Id<'automationConversations'>) {
  const conversation = await ctx.db.get(id)
  if (!conversation) throw new Error('Conversation not found')
  const automation = await ownAutomation(ctx, conversation.automationId)
  return { conversation, automation }
}

async function turnsFor(ctx: QueryCtx | MutationCtx, id: Id<'automationConversations'>) {
  return await ctx.db
    .query('automationChatTurns')
    .withIndex('by_conversation', (q) => q.eq('conversationId', id))
    .take(CHAT_LIMITS.turnsPerConversation)
}

async function discardDrafts(ctx: MutationCtx, turns: Doc<'automationChatTurns'>[]) {
  for (const turn of turns) {
    if (!turn.proposalId) continue
    const edit = await ctx.db.get(turn.proposalId)
    if (edit?.status === 'proposed') await ctx.db.patch(edit._id, { status: 'discarded' })
  }
}

/** Reservations are reconciled once, including late replies after the expiry job has run. */
async function settle(ctx: MutationCtx, turn: Doc<'automationChatTurns'>, usd: number) {
  if (!turn.budgetId) return
  const budget = await ctx.db.get(turn.budgetId)
  if (!budget) return
  const alreadySettled = turn.budgetSettledUsd !== undefined
  await ctx.db.patch(budget._id, {
    reservedUsd: alreadySettled
      ? budget.reservedUsd
      : Math.max(0, budget.reservedUsd - CHAT_LIMITS.reservationUsd),
    chargedUsd: Math.max(0, budget.chargedUsd - (turn.budgetSettledUsd ?? 0) + usd),
  })
  await ctx.db.patch(turn._id, { budgetSettledUsd: usd })
}

async function releaseUser(ctx: MutationCtx, turn: Doc<'automationChatTurns'>) {
  const user = await ctx.db.get(turn.userId)
  if (user?.chatActiveTurnId === turn._id)
    await ctx.db.patch(user._id, { chatActiveTurnId: undefined })
}

async function expireTurn(ctx: MutationCtx, turn: Doc<'automationChatTurns'>) {
  if (turn.status !== 'pending') return
  // A crashed or timed-out request may have incurred a bill even without a usage receipt.
  await settle(
    ctx,
    turn,
    turn.budgetSettledUsd ?? (turn.startedAt !== undefined ? CHAT_LIMITS.reservationUsd : 0),
  )
  await ctx.db.patch(turn._id, {
    status: 'failed',
    errorCode: 'expired',
    completedAt: Date.now(),
    prompt: '',
    assistantText:
      'The assistant took too long. Please send your message again with a new request ID.',
  })
  await releaseUser(ctx, turn)
}

export const open = mutation({
  args: { automationId: v.id('automations') },
  returns: v.id('automationConversations'),
  handler: async (ctx, { automationId }) => {
    await ownAutomation(ctx, automationId)
    const existing = await ctx.db
      .query('automationConversations')
      .withIndex('by_automation', (q) => q.eq('automationId', automationId))
      .unique()
    if (existing) return existing._id
    return await ctx.db.insert('automationConversations', {
      automationId,
      turnCount: 0,
      createdAt: Date.now(),
    })
  },
})

export const get = query({
  args: { id: v.id('automationConversations') },
  handler: async (ctx, { id }) => {
    const { conversation, automation } = await ownedConversation(ctx, id)
    const user = await ctx.db.get(automation.userId)
    if (!user) throw new Error('Not signed in')
    const day = new Date().toISOString().slice(0, 10)
    const daily = allowanceFor(user).ownKey
      ? CHAT_LIMITS.ownKeyTurnsPerDay
      : CHAT_LIMITS.freeTurnsPerDay
    const turns = await turnsFor(ctx, id)
    return {
      id,
      automationId: conversation.automationId,
      limits: {
        ...CHAT_LIMITS,
        turnsLeft: CHAT_LIMITS.turnsPerConversation - conversation.turnCount,
        dailyTurnsLeft: Math.max(
          0,
          daily - (user.chatDay === day ? (user.chatTurnsToday ?? 0) : 0),
        ),
        usesRunCredits: false,
      },
      turns: turns.map(
        ({
          _id,
          requestId,
          userText,
          status,
          kind,
          assistantText,
          proposalId,
          featureRequest,
          alternative,
          errorCode,
          createdAt,
          completedAt,
        }) => ({
          id: _id,
          requestId,
          userText,
          status,
          kind: kind ?? null,
          assistantText: assistantText ?? null,
          proposalId: proposalId ?? null,
          featureRequest: featureRequest ?? null,
          alternative: alternative ?? null,
          errorCode: errorCode ?? null,
          createdAt,
          completedAt: completedAt ?? null,
        }),
      ),
    }
  },
})

/** Enqueue durably; retrying a request ID returns the same turn and spends no more allowance. */
export const send = mutation({
  args: { id: v.id('automationConversations'), requestId: v.string(), message: v.string() },
  returns: v.id('automationChatTurns'),
  handler: async (ctx, { id, requestId, message }) => {
    const { conversation, automation } = await ownedConversation(ctx, id)
    const text = message.trim()
    if (!text || text.length > CHAT_LIMITS.messageCharacters)
      throw new Error('Send a message of 1–2,000 characters.')
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(requestId))
      throw new Error('Use a request ID of 1–80 letters, numbers, underscores or hyphens.')
    const existing = await ctx.db
      .query('automationChatTurns')
      .withIndex('by_conversation_request', (q) =>
        q.eq('conversationId', id).eq('requestId', requestId),
      )
      .unique()
    if (existing) {
      if (existing.userText !== text)
        throw new Error('This request ID was already used for a different message.')
      return existing._id
    }
    const user = await ctx.db.get(automation.userId)
    if (!user) throw new Error('Not signed in')
    const now = Date.now()
    if (user.chatActiveTurnId) {
      const active = await ctx.db.get(user.chatActiveTurnId)
      if (active?.status === 'pending') {
        if (active.createdAt + CHAT_LIMITS.expiresAfterMs > now)
          throw new Error('Wait for your current assistant reply before sending another message.')
        await expireTurn(ctx, active)
      }
    }
    if (user.chatLastTurnAt !== undefined && now - user.chatLastTurnAt < CHAT_LIMITS.cooldownMs)
      throw new Error('Please wait a few seconds before sending another message.')
    if (conversation.turnCount >= CHAT_LIMITS.turnsPerConversation)
      throw new Error('This conversation is full. Clear it to start a new conversation.')
    const day = new Date(now).toISOString().slice(0, 10)
    const used = user.chatDay === day ? (user.chatTurnsToday ?? 0) : 0
    const ownKey = allowanceFor(user).ownKey
    const daily = ownKey ? CHAT_LIMITS.ownKeyTurnsPerDay : CHAT_LIMITS.freeTurnsPerDay
    if (used >= daily)
      throw new Error('Your assistant message allowance is used up for today. Try again tomorrow.')
    const context = await automationEditContext(ctx, automation)
    const turns = await turnsFor(ctx, id)
    let draft: unknown = null
    for (let index = turns.length - 1; index >= 0; index--) {
      const turn = turns[index]!
      if (!turn.proposalId) continue
      const edit = await ctx.db.get(turn.proposalId)
      if (edit && edit.status !== 'applied' && edit.baseRevision === context.revision) {
        draft = edit.after
        break
      }
    }
    const prompt = chatPrompt(
      context,
      turns.map((turn) => ({
        user: turn.userText,
        assistant: turn.assistantText ?? null,
        kind: turn.kind ?? null,
        baseRevision: turn.baseRevision,
      })),
      draft,
      text,
      now,
    )
    let budgetId: Id<'automationChatBudgets'> | undefined
    if (!ownKey) {
      const budget = await ctx.db
        .query('automationChatBudgets')
        .withIndex('by_day', (q) => q.eq('day', day))
        .unique()
      const reserved = (budget?.reservedUsd ?? 0) + CHAT_LIMITS.reservationUsd
      const hours = await ctx.db
        .query('aiSpend')
        .withIndex('by_hour', (q) => q.gte('hourStart', now - 25 * 3_600_000))
        .collect()
      const spent = hours.reduce((sum, row) => sum + row.usd, 0)
      if (
        reserved + (budget?.chargedUsd ?? 0) > CHAT_LIMITS.sharedDailyCapUsd ||
        reserved + spent > globalDailyCapUsd()
      )
        throw new Error(
          'The shared assistant budget is busy or used up. Try later or add your own Anthropic key in settings.',
        )
      if (!budget) {
        budgetId = await ctx.db.insert('automationChatBudgets', {
          day,
          reservedUsd: reserved,
          chargedUsd: 0,
        })
      } else {
        budgetId = budget._id
        await ctx.db.patch(budgetId, { reservedUsd: reserved })
      }
    }
    await discardDrafts(ctx, turns)
    const turnId = await ctx.db.insert('automationChatTurns', {
      conversationId: id,
      requestId,
      userId: user._id,
      userText: text,
      baseRevision: context.revision,
      prompt,
      status: 'pending',
      createdAt: now,
      budgetId,
    })
    const workerFnId = await ctx.scheduler.runAfter(0, internal.automationChatWorker.respond, {
      turnId,
    })
    const expiryFnId = await ctx.scheduler.runAfter(
      CHAT_LIMITS.expiresAfterMs,
      internal.automationChat.expire,
      { turnId },
    )
    await ctx.db.patch(turnId, { workerFnId, expiryFnId })
    await ctx.db.patch(id, { turnCount: conversation.turnCount + 1 })
    await ctx.db.patch(user._id, {
      chatDay: day,
      chatTurnsToday: used + 1,
      chatLastTurnAt: now,
      chatActiveTurnId: turnId,
    })
    return turnId
  },
})

/** Scheduled worker claims exactly once, then reads a key only on the server. */
export const claim = internalMutation({
  args: { turnId: v.id('automationChatTurns') },
  handler: async (ctx, { turnId }) => {
    const turn = await ctx.db.get(turnId)
    if (!turn || turn.status !== 'pending' || turn.startedAt !== undefined) return null
    if (turn.createdAt + CHAT_LIMITS.expiresAfterMs <= Date.now()) {
      await expireTurn(ctx, turn)
      return null
    }
    const conversation = await ctx.db.get(turn.conversationId)
    if (!conversation) return null
    await automationOf(ctx, turn.userId, conversation.automationId)
    const user = await ctx.db.get(turn.userId)
    if (!user) return null
    // Do not switch from a reserved personal key to the shared key while waiting in the queue.
    if (!turn.budgetId && !user.anthropicKeyEnc)
      throw new Error('The personal AI key was removed. Please send the message again.')
    await ctx.db.patch(turnId, { startedAt: Date.now() })
    return { prompt: turn.prompt, user, usesSharedKey: Boolean(turn.budgetId) }
  },
})

export const finish = internalMutation({
  args: {
    turnId: v.id('automationChatTurns'),
    output: v.optional(v.any()),
    record: v.optional(aiCallRecordValidator),
    error: v.optional(v.union(v.literal('service'), v.literal('declined'))),
  },
  returns: v.null(),
  handler: async (ctx, { turnId, output, record, error }) => {
    let turn = await ctx.db.get(turnId)
    if (!turn) return null // Account/ conversation deletion must not recreate private data.
    if (record && !turn.callRecorded) {
      await recordStandaloneFor(ctx, turn.userId, 'automation-chat', record)
      await ctx.db.patch(turnId, { callRecorded: true })
      await settle(ctx, turn, record.costUsd)
      turn = (await ctx.db.get(turnId))!
    }
    if (turn.status !== 'pending') return null
    if (turn.createdAt + CHAT_LIMITS.expiresAfterMs <= Date.now()) {
      await expireTurn(ctx, turn)
      return null
    }
    if (!record)
      await settle(ctx, turn, turn.startedAt !== undefined ? CHAT_LIMITS.reservationUsd : 0)
    let errorCode: Doc<'automationChatTurns'>['errorCode'] = error
    let assistantText =
      error === 'declined'
        ? 'The assistant could not help with that request. Please rephrase it.'
        : 'The assistant could not reply. Please try again with a new request ID. Your automation was not changed.'
    let result: Partial<Doc<'automationChatTurns'>> = {}
    if (!error) {
      try {
        const reply = checkedChatReply(output)
        const conversation = await ctx.db.get(turn.conversationId)
        if (!conversation) return null
        const automation = await automationOf(ctx, turn.userId, conversation.automationId)
        if (
          (automation.configurationRevision ?? 0) !== turn.baseRevision ||
          automation.status === 'generating'
        ) {
          errorCode = 'conflict'
          assistantText =
            'This automation changed while I was preparing a reply. Send your request again to use the latest settings.'
        } else {
          let proposalId: Id<'automationEdits'> | undefined
          if (reply.kind === 'proposal') {
            const changes = Object.fromEntries(
              Object.entries(reply.changes ?? {}).filter(([, value]) => value !== null),
            )
            proposalId = await prepareAutomationEdit(
              ctx,
              automation,
              turn.baseRevision,
              changes,
              reply.playbook ? renderPlaybook(reply.playbook) : undefined,
            )
          }
          assistantText =
            reply.kind === 'proposal'
              ? `Changes prepared for review; they have not been applied. ${reply.message}`
              : reply.message
          if (reply.kind === 'unsupported')
            assistantText += `\n\n${reply.unsupportedReasons.join('\n')}`
          result = {
            kind: reply.kind,
            proposalId,
            featureRequest: reply.featureRequest ?? undefined,
            alternative: reply.alternative ?? undefined,
          }
        }
      } catch {
        errorCode = 'invalid_response'
        assistantText =
          'I could not prepare a valid change. Please rephrase your request. Your automation was not changed.'
      }
    }
    await ctx.db.patch(turnId, {
      ...result,
      status: errorCode ? 'failed' : 'complete',
      assistantText,
      errorCode,
      completedAt: Date.now(),
      prompt: '',
    })
    if (turn.expiryFnId) await ctx.scheduler.cancel(turn.expiryFnId)
    await releaseUser(ctx, turn)
    return null
  },
})

export const expire = internalMutation({
  args: { turnId: v.id('automationChatTurns') },
  returns: v.null(),
  handler: async (ctx, { turnId }) => {
    const turn = await ctx.db.get(turnId)
    if (turn && turn.createdAt + CHAT_LIMITS.expiresAfterMs <= Date.now())
      await expireTurn(ctx, turn)
    return null
  },
})

/** Explicit clear and account deletion both remove captured context and generated drafts. */
export async function deleteAutomationConversation(
  ctx: MutationCtx,
  automationId: Id<'automations'>,
) {
  const conversation = await ctx.db
    .query('automationConversations')
    .withIndex('by_automation', (q) => q.eq('automationId', automationId))
    .unique()
  if (!conversation) return
  const turns = await turnsFor(ctx, conversation._id)
  for (const turn of turns) {
    if (turn.proposalId) {
      const edit = await ctx.db.get(turn.proposalId)
      if (edit && edit.status !== 'applied') await ctx.db.delete(edit._id)
    }
    if (turn.status === 'pending') {
      await settle(ctx, turn, turn.startedAt !== undefined ? CHAT_LIMITS.reservationUsd : 0)
      await releaseUser(ctx, turn)
    }
    if (turn.workerFnId) await ctx.scheduler.cancel(turn.workerFnId)
    if (turn.expiryFnId) await ctx.scheduler.cancel(turn.expiryFnId)
    await ctx.db.delete(turn._id)
  }
  await ctx.db.delete(conversation._id)
}

export const clear = mutation({
  args: { id: v.id('automationConversations') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { automation } = await ownedConversation(ctx, id)
    await deleteAutomationConversation(ctx, automation._id)
    return null
  },
})
