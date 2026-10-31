import { v } from 'convex/values'
import { z } from 'zod'
import { internalAction } from './_generated/server'
import { FIXTURES, type Fixture } from './evals/setupAnswers'
import { anthropicClient, callStructured, STRUCTURED_MAX_TOKENS } from './lib/ai/client'
import { GENERATE_SYSTEM, generateUserMessage, Playbook } from './lib/ai/generate'
import type { ModelId } from './lib/ai/pricing'
import {
  allowedDomains,
  briefFromPlaybook,
  lookbackHours,
  type Candidate,
  RESEARCH_SYSTEM,
  researchTools,
  ResearchResult,
  researchUserMessage,
} from './lib/ai/research'
import { renderPlaybook } from './lib/playbook'
import {
  checkPost,
  WRITE_SYSTEM,
  WriteResult,
  writeUserMessage,
  type TargetChannel,
} from './lib/ai/write'

/**
 * Haiku against Sonnet on one fixture, judged blind by Opus. One playbook is written (on Sonnet,
 * as real runs do), then both models research it at the same moment, so the news they can find is
 * the same. Writing is compared twice: each model on its own research (the whole run, old setup
 * against new), and both models on Haiku's stories (writing alone). The judge never sees the
 * model names and reads every pair in both orders. From the CLI:
 *   npx convex run benchmark:compare '{"fixtureId": 1}'
 */

const HAIKU: ModelId = 'claude-haiku-5-5'
const SONNET: ModelId = 'claude-sonnet-5-5'
const JUDGE: ModelId = 'claude-opus-5-5'

const Scores = z.object({
  relevance: z
    .number()
    .min(1)
    .max(5)
    .describe('On topic for the playbook, nothing it says to skip'),
  accuracy: z
    .number()
    .min(1)
    .max(5)
    .describe(
      'Research: dated inside the window and sourced. Posts: claims only what the facts give',
    ),
  craft: z
    .number()
    .min(1)
    .max(5)
    .describe(
      'Research: source quality and useful key facts. Posts: voice, clarity, fits the network',
    ),
  mustGetRight: z.number().min(1).max(5).describe("Meets the account's must-get-right bar"),
})

const Verdict = z.object({
  a: Scores,
  b: Scores,
  preferred: z.enum(['A', 'B', 'tie']),
  sameStories: z
    .number()
    .describe(
      'Research only: how many stories appear in both lists (same event, any outlet). 0 for posts',
    ),
  reason: z.string().describe('At most 60 words: what decided it'),
})
type Verdict = z.infer<typeof Verdict>

const JUDGE_SYSTEM = `You judge the output of Dispatchlet, an agent that researches news for a social account and writes its posts. You are shown the account's playbook, its must-get-right bar, and two outputs, A and B, made from the same brief at the same time. Score each from 1 to 5 on every measure, then say which you would rather send, or tie when you honestly cannot choose.

Judge what is on the page. You cannot open links, so for research judge whether dates fall inside the window and whether sources fit the playbook; for posts judge whether every claim is backed by the story's key facts and summary, which you are given. An empty list is right when nothing new happened, and better than padding. Do not reward length. A post that breaks a playbook rule (hashtags, emoji, hype words, crediting the wrong outlet) loses on craft and on accuracy if it adds a claim.`

type Side = 'haiku' | 'sonnet'

/** Puts Haiku's and Sonnet's output in the order the judge will see them as A and B. */
function order<T>(first: Side, haiku: T, sonnet: T): [T, T] {
  return first === 'haiku' ? [haiku, sonnet] : [sonnet, haiku]
}

function playbookBlock(
  fixture: Fixture,
  playbookText: string,
  now: Date,
  freshnessHours: number,
): string {
  // The judge must hold the researcher to the window the researcher was given. A first run looks
  // back further than the playbook's freshness, and a judge that only saw the playbook marked
  // every story from that extra stretch down as stale.
  return [
    `Today is ${now.toISOString().slice(0, 10)}. This is the account's first run, so the researcher was told to take stories from the last ${lookbackHours(freshnessHours, 0)} hours, not only the playbook's ${freshnessHours}.`,
    `Playbook:\n${playbookText}`,
    `Must get right: ${fixture.mustGetRight}`,
  ].join('\n\n')
}

function storiesBlock(candidates: Candidate[]): string {
  if (!candidates.length) return '(no stories)'
  return candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.title} (${c.source}, ${c.publishedAt}, confidence ${c.confidence})\n   ${c.canonicalUrl}\n   ${c.summary}\n   Key facts: ${c.keyFacts.join(' | ')}`,
    )
    .join('\n')
}

type Post = {
  channel: string
  storyUrl: string
  text: string
  thread: string[] | null
  ok: boolean
}

function postsBlock(posts: Post[]): string {
  if (!posts.length) return '(no posts)'
  return posts
    .map(
      (p, i) =>
        `${i + 1}. [${p.channel}] story ${p.storyUrl}\n${[p.text, ...(p.thread ?? [])].join('\n---\n')}`,
    )
    .join('\n\n')
}

export const compare = internalAction({
  args: {
    fixtureId: v.number(),
    timezone: v.optional(v.string()),
    /** Haiku researches but Sonnet writes its posts, to test that split against all-Sonnet. */
    sonnetWrites: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (_ctx, { fixtureId, timezone = 'Europe/London', sonnetWrites = false }) => {
    const fixture = FIXTURES.find((f) => f.id === fixtureId)
    if (!fixture) throw new Error(`No fixture ${fixtureId}; there are 1 to ${FIXTURES.length}`)
    const client = anthropicClient()
    const now = new Date()
    const startedAt = Date.now()
    const calls: { step: string; model: string; costUsd: number; durationMs: number }[] = []
    const note = (step: string, record: { model: string; costUsd: number; durationMs: number }) =>
      calls.push({
        step,
        model: record.model,
        costUsd: record.costUsd,
        durationMs: record.durationMs,
      })

    const generated = await callStructured(client, {
      model: SONNET,
      effort: 'high',
      maxTokens: STRUCTURED_MAX_TOKENS,
      system: GENERATE_SYSTEM,
      user: generateUserMessage(fixture.answers, fixture.answers.services, now, timezone),
      schema: Playbook,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
    })
    note('playbook', generated.record)
    const playbook = generated.output
    if (!playbook) throw new Error(generated.record.refusal ?? 'No playbook')
    const playbookText = renderPlaybook(playbook)
    const brief = briefFromPlaybook(playbook, {
      onlyTheseSources: fixture.answers.onlyTheseSources,
      maxPostsPerRun: fixture.answers.maxStories,
    })
    const researchFor = async (model: ModelId) => {
      const result = await callStructured(client, {
        model,
        effort: 'high',
        maxTokens: STRUCTURED_MAX_TOKENS,
        system: RESEARCH_SYSTEM,
        user: researchUserMessage(brief, { now, timezone, covered: [] }),
        schema: ResearchResult,
        tools: researchTools(allowedDomains(brief)),
      })
      note(`research:${model === HAIKU ? 'haiku' : 'sonnet'}`, result.record)
      const kept = (result.output?.candidates ?? [])
        .filter((c) => c.confidence >= 0.5)
        .slice(0, fixture.answers.maxStories)
      return {
        kept,
        found: result.output?.candidates.length ?? 0,
        notes: result.output?.notes ?? result.record.refusal ?? 'No output',
        usage: result.record.usage,
        toolErrors: result.toolErrors.length,
        costUsd: result.record.costUsd,
        durationMs: result.record.durationMs,
      }
    }
    const [haikuResearch, sonnetResearch] = await Promise.all([
      researchFor(HAIKU),
      researchFor(SONNET),
    ])

    const targets: TargetChannel[] = fixture.answers.services.map((service) => ({
      channelId: service,
      service,
      name: `${service} test`,
      maxLength: null,
    }))
    const writeFor = async (label: string, model: ModelId, stories: Candidate[]) => {
      if (!stories.length) return { posts: [] as Post[], costUsd: 0, overLimit: 0 }
      const written = await callStructured(client, {
        model,
        effort: 'medium',
        maxTokens: STRUCTURED_MAX_TOKENS,
        system: WRITE_SYSTEM,
        user: writeUserMessage(playbook, stories, targets),
        schema: WriteResult,
      })
      note(`write:${label}`, written.record)
      const urls = new Set(stories.map((s) => s.canonicalUrl))
      const posts: Post[] = (written.output?.posts ?? []).map((p) => {
        const channel = targets.find((t) => t.channelId === p.channelId) ?? targets[0]!
        const checked = checkPost(p, channel, playbook, urls)
        return {
          channel: channel.service,
          storyUrl: p.storyUrl,
          text: p.text,
          thread: p.thread,
          ok: checked.ok,
        }
      })
      return {
        posts,
        costUsd: written.record.costUsd,
        overLimit: posts.filter((p) => !p.ok).length,
      }
    }
    const [haikuOwn, sonnetOwn, sonnetOnHaiku] = await Promise.all([
      writeFor(
        sonnetWrites ? 'sonnet-for-haiku' : 'haiku',
        sonnetWrites ? SONNET : HAIKU,
        haikuResearch.kept,
      ),
      writeFor('sonnet', SONNET, sonnetResearch.kept),
      writeFor('sonnet-on-haiku-stories', SONNET, haikuResearch.kept),
    ])

    /** One verdict, with Haiku shown as A or B, mapped back to model names. */
    const judgeOnce = async (label: string, body: (first: Side) => string, first: Side) => {
      const result = await callStructured(client, {
        model: JUDGE,
        effort: 'high',
        maxTokens: STRUCTURED_MAX_TOKENS,
        system: JUDGE_SYSTEM,
        user: `${playbookBlock(fixture, playbookText, now, brief.freshnessHours)}\n\n${body(first)}`,
        schema: Verdict,
      })
      note(`judge:${label}:${first}-first`, result.record)
      const verdict = result.output
      if (!verdict) throw new Error(`Judge gave no verdict for ${label}`)
      const other: Side = first === 'haiku' ? 'sonnet' : 'haiku'
      return {
        winner: verdict.preferred === 'tie' ? 'tie' : verdict.preferred === 'A' ? first : other,
        haiku: first === 'haiku' ? verdict.a : verdict.b,
        sonnet: first === 'haiku' ? verdict.b : verdict.a,
        sameStories: verdict.sameStories,
        reason: verdict.reason,
      } as const
    }
    /**
     * Judges twice, once in each order. A model wins only when both orders pick it, so a judge
     * that leans towards whichever it reads first cannot decide the result; scores are averaged.
     */
    const judge = async (label: string, body: (first: Side) => string) => {
      const [x, y] = await Promise.all([
        judgeOnce(label, body, 'haiku'),
        judgeOnce(label, body, 'sonnet'),
      ])
      const mean = (side: Side) =>
        Object.fromEntries(
          (Object.keys(x[side]) as (keyof Verdict['a'])[]).map((k) => [
            k,
            (x[side][k] + y[side][k]) / 2,
          ]),
        ) as Verdict['a']
      return {
        winner: x.winner === y.winner ? x.winner : ('tie' as const),
        split: x.winner !== y.winner,
        haiku: mean('haiku'),
        sonnet: mean('sonnet'),
        sameStories: Math.round((x.sameStories + y.sameStories) / 2),
        reasons: { haikuFirst: x.reason, sonnetFirst: y.reason },
        picks: { haikuFirst: x.winner, sonnetFirst: y.winner },
      }
    }
    const bothEmpty = !haikuResearch.kept.length && !sonnetResearch.kept.length
    const [research, writing, endToEnd] = await Promise.all([
      judge('research', (first) => {
        const [a, b] = order(first, haikuResearch, sonnetResearch)
        return `These are two research results: the stories each would post.\n\nA:\n${storiesBlock(a.kept)}\nA's notes: ${a.notes}\n\nB:\n${storiesBlock(b.kept)}\nB's notes: ${b.notes}`
      }),
      haikuResearch.kept.length && !sonnetWrites
        ? judge('writing', (first) => {
            const [a, b] = order(first, haikuOwn.posts, sonnetOnHaiku.posts)
            return `Both wrote posts for the same stories:\n${storiesBlock(haikuResearch.kept)}\n\nA's posts:\n${postsBlock(a)}\n\nB's posts:\n${postsBlock(b)}`
          })
        : null,
      bothEmpty
        ? null
        : judge('end-to-end', (first) => {
            const [a, b] = order(
              first,
              { r: haikuResearch, w: haikuOwn },
              { r: sonnetResearch, w: sonnetOwn },
            )
            return `Each researched and then wrote its own posts. Judge what the account would end up with.\n\nA's stories:\n${storiesBlock(a.r.kept)}\n\nA's posts:\n${postsBlock(a.w.posts)}\n\nB's stories:\n${storiesBlock(b.r.kept)}\n\nB's posts:\n${postsBlock(b.w.posts)}`
          }),
    ])

    const costOfRun = (side: Side) => {
      const r = side === 'haiku' ? haikuResearch : sonnetResearch
      const w = side === 'haiku' ? haikuOwn : sonnetOwn
      return Math.round((r.costUsd + w.costUsd) * 10_000) / 10_000
    }
    return {
      fixture: fixture.id,
      sonnetWrites,
      topic: fixture.answers.research,
      services: fixture.answers.services,
      at: now.toISOString(),
      playbookCostUsd: generated.record.costUsd,
      runCostUsd: { haiku: costOfRun('haiku'), sonnet: costOfRun('sonnet') },
      research: {
        haiku: { ...haikuResearch, kept: haikuResearch.kept.map((c) => c.canonicalUrl) },
        sonnet: { ...sonnetResearch, kept: sonnetResearch.kept.map((c) => c.canonicalUrl) },
      },
      overLimit: {
        haiku: haikuOwn.overLimit,
        sonnet: sonnetOwn.overLimit,
        sonnetOnHaikuStories: sonnetOnHaiku.overLimit,
      },
      examples: {
        stories: haikuResearch.kept.map((c) => ({
          title: c.title,
          source: c.source,
          url: c.canonicalUrl,
        })),
        haikuPosts: haikuOwn.posts,
        sonnetOnHaikuStories: sonnetOnHaiku.posts,
      },
      verdicts: { research, writing, endToEnd },
      calls,
      totalCostUsd: Math.round(calls.reduce((sum, c) => sum + c.costUsd, 0) * 10_000) / 10_000,
      durationMs: Date.now() - startedAt,
    }
  },
})
