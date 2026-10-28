import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { FIXTURES } from './evals/setupAnswers'
import { usageValidator } from './schema'
import { anthropicClient, callStructured, MODELS } from './lib/ai/client'
import { addUsage, EMPTY_USAGE } from './lib/ai/pricing'
import { GENERATE_SYSTEM, generateUserMessage, Playbook } from './lib/ai/generate'
import {
  allowedDomains,
  briefFromPlaybook,
  briefFromSetup,
  RESEARCH_LIMITS,
  RESEARCH_SYSTEM,
  ResearchResult,
  researchUserMessage,
  type ResearchBrief,
} from './lib/ai/research'
import { renderPlaybook } from './lib/playbook'

type UsageShape = {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  webSearches: number
  webFetches: number
}

type EvalSummary = {
  runId: Id<'runs'>
  candidates: number
  costUsd: number
  usage: UsageShape
  durationMs: number
  notes: string
}

/**
 * Runs the research step on one eval fixture (SPEC §36) and records what it cost. From the CLI:
 *   npx convex run ai:researchEval '{"fixtureId": 1}'
 * Two runs of the same fixture inside five minutes show the prompt cache working.
 */
export const researchEval = internalAction({
  args: { fixtureId: v.number(), timezone: v.optional(v.string()), full: v.optional(v.boolean()) },
  returns: v.object({
    runId: v.id('runs'),
    candidates: v.number(),
    costUsd: v.number(),
    usage: usageValidator,
    durationMs: v.number(),
    notes: v.string(),
  }),
  handler: async (ctx, args): Promise<EvalSummary> => {
    const fixture = FIXTURES.find((f) => f.id === args.fixtureId)
    if (!fixture) throw new Error(`No fixture ${args.fixtureId}; there are 1 to ${FIXTURES.length}`)
    const runId: Id<'runs'> = await ctx.runMutation(internal.ai.startRun, {
      kind: 'eval',
      fixtureId: fixture.id,
    })
    const timezone = args.timezone ?? 'Europe/London'
    const client = anthropicClient()
    let brief: ResearchBrief = briefFromSetup(fixture.answers)
    try {
      // The real path: a playbook first, then research from it.
      if (args.full) {
        const generated = await callStructured(client, {
          model: MODELS.playbook,
          effort: 'high',
          maxTokens: 8_000,
          system: GENERATE_SYSTEM,
          user: generateUserMessage(
            fixture.answers,
            fixture.answers.services,
            new Date(),
            timezone,
          ),
          schema: Playbook,
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
        })
        await ctx.runMutation(internal.ai.recordCall, {
          runId,
          purpose: 'playbook',
          ...generated.record,
        })
        if (!generated.output) throw new Error(generated.record.refusal ?? 'No playbook')
        await ctx.runMutation(internal.ai.finishRun, {
          runId,
          status: 'researching',
          note: 'playbook written',
          result: { playbook: renderPlaybook(generated.output) },
        })
        brief = briefFromPlaybook(generated.output, {
          onlyTheseSources: fixture.answers.onlyTheseSources,
          maxPostsPerRun: fixture.answers.maxStories,
        })
      }
      const domains = allowedDomains(brief)
      const { output, record } = await callStructured(client, {
        model: MODELS.research,
        effort: 'medium',
        maxTokens: 8_000,
        system: RESEARCH_SYSTEM,
        user: researchUserMessage(brief, { now: new Date(), timezone, covered: [] }),
        schema: ResearchResult,
        tools: [
          {
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: RESEARCH_LIMITS.maxSearches,
            ...(domains ? { allowed_domains: domains } : {}),
          },
          {
            type: 'web_fetch_20260209',
            name: 'web_fetch',
            max_uses: RESEARCH_LIMITS.maxFetches,
            max_content_tokens: RESEARCH_LIMITS.maxFetchTokens,
            ...(domains ? { allowed_domains: domains } : {}),
          },
        ],
      })
      await ctx.runMutation(internal.ai.recordCall, { runId, purpose: 'research', ...record })
      const candidates = output?.candidates.length ?? 0
      const notes = output?.notes ?? (record.refusal ? `Refused: ${record.refusal}` : 'No output')
      await ctx.runMutation(internal.ai.finishRun, {
        runId,
        status: output ? 'done' : 'failed',
        note: `${candidates} candidates, ${record.usage.webSearches} searches, ${record.usage.webFetches} fetches`,
        result: output ? { research: output } : undefined,
        error: output ? undefined : notes,
      })
      return {
        runId,
        candidates,
        costUsd: record.costUsd,
        usage: record.usage,
        durationMs: record.durationMs,
        notes,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await ctx.runMutation(internal.ai.finishRun, {
        runId,
        status: 'failed',
        note: 'research threw',
        error: message,
      })
      throw error
    }
  },
})

export const startRun = internalMutation({
  args: { kind: v.string(), fixtureId: v.optional(v.number()), userId: v.optional(v.id('users')) },
  returns: v.id('runs'),
  handler: async (ctx, args) =>
    ctx.db.insert('runs', {
      ...args,
      status: 'researching',
      startedAt: Date.now(),
      steps: [{ step: 'research', at: Date.now(), note: 'started' }],
      usage: EMPTY_USAGE,
      costUsd: 0,
    }),
})

/** Stores one model call and adds it to the run's totals. */
export const recordCall = internalMutation({
  args: {
    runId: v.id('runs'),
    purpose: v.string(),
    model: v.string(),
    stopReason: v.union(v.string(), v.null()),
    usage: usageValidator,
    costUsd: v.number(),
    durationMs: v.number(),
    refusal: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error('Run not found')
    await ctx.db.insert('aiCalls', { ...args, userId: run.userId, createdAt: Date.now() })
    await ctx.db.patch(args.runId, {
      usage: addUsage(run.usage, args.usage),
      costUsd: Math.round((run.costUsd + args.costUsd) * 10_000) / 10_000,
    })
    return null
  },
})

/** A model call outside a run, such as writing a playbook. */
export const recordStandalone = internalMutation({
  args: {
    userId: v.id('users'),
    purpose: v.string(),
    model: v.string(),
    stopReason: v.union(v.string(), v.null()),
    usage: usageValidator,
    costUsd: v.number(),
    durationMs: v.number(),
    refusal: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert('aiCalls', { ...args, createdAt: Date.now() })
    return null
  },
})

export const finishRun = internalMutation({
  args: {
    runId: v.id('runs'),
    status: v.string(),
    note: v.string(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { runId, status, note, result, error }) => {
    const run = await ctx.db.get(runId)
    if (!run) throw new Error('Run not found')
    await ctx.db.patch(runId, {
      status,
      finishedAt: status === 'researching' ? undefined : Date.now(),
      steps: [...run.steps, { step: 'research', at: Date.now(), note }],
      result: result && run.result ? { ...run.result, ...result } : (result ?? run.result),
      error,
    })
    return null
  },
})

/** The eval runs so far with their cost, for the cost-per-run table in the spec. */
export const evalRuns = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      runId: v.id('runs'),
      fixtureId: v.union(v.number(), v.null()),
      status: v.string(),
      costUsd: v.number(),
      usage: usageValidator,
      seconds: v.union(v.number(), v.null()),
      candidates: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const runs = await ctx.db
      .query('runs')
      .withIndex('by_kind_startedAt', (q) => q.eq('kind', 'eval'))
      .order('desc')
      .take(50)
    return runs.map((run) => ({
      runId: run._id as Id<'runs'>,
      fixtureId: run.fixtureId ?? null,
      status: run.status,
      costUsd: run.costUsd,
      usage: run.usage,
      seconds: run.finishedAt ? Math.round((run.finishedAt - run.startedAt) / 1000) : null,
      candidates: Array.isArray(run.result?.research?.candidates)
        ? run.result.research.candidates.length
        : Array.isArray(run.result?.candidates)
          ? run.result.candidates.length
          : 0,
    }))
  },
})
