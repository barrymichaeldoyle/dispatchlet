import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'
import { addUsage, costOf, EMPTY_USAGE, isKnownModel, type ModelId, type Usage } from './pricing'

/**
 * The one place a model is chosen. In the 31 Oct benchmark (benchmark.ts, 14 fixtures, judged
 * blind) Haiku 5.5 researched about as well as Sonnet 5.5 at a sixth of the cost, but Sonnet wrote
 * clearly better posts from the same stories. Writing is a small call, so Haiku research with
 * Sonnet writing matched all-Sonnet runs at about a fifth of the price. The playbook, a one-off
 * that needs judgement about sources, stays on Sonnet.
 */
const DEFAULT_MODELS = {
  research: 'claude-haiku-5-5',
  write: 'claude-sonnet-5-5',
  playbook: 'claude-sonnet-5-5',
  reparse: 'claude-haiku-5-5',
  chat: 'claude-sonnet-5-5',
} as const satisfies Record<string, ModelId>

export type Step = keyof typeof DEFAULT_MODELS

/** The model for a step, overridable per deployment with MODEL_<STEP>, including MODEL_CHAT. */
export function modelFor(step: Step): ModelId {
  const override = process.env[`MODEL_${step.toUpperCase()}`]
  return override && isKnownModel(override) ? override : DEFAULT_MODELS[step]
}

export type Effort = 'low' | 'medium' | 'high'

export function anthropicClient(apiKey = process.env.ANTHROPIC_API_KEY): Anthropic {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  // Busy and rate-limit replies (429, 529) are retried with backoff, which rides out a spike of
  // runs starting at once; a run that still fails gives its free run back (runs.serviceFailure).
  // A whole run has ten minutes (Convex's action limit), so one hung call may not take most of it.
  return new Anthropic({ apiKey, maxRetries: 2, timeout: CALL_TIMEOUT_MS })
}

const CALL_TIMEOUT_MS = 3 * 60_000

/** Not worth starting a call with less time than this left before the deadline. */
const MIN_CALL_MS = 20_000

/** What every call records, whatever it was for. */
export type CallRecord = {
  model: string
  stopReason: string | null
  usage: Usage
  costUsd: number
  durationMs: number
  /** Set when the model declined and nothing could be parsed. */
  refusal: string | null
}

export type StructuredCall<T extends z.ZodType> = {
  model: ModelId
  system: string
  user: string
  schema: T
  effort: Effort
  /** Thinking counts against this, so high-effort calls need room: 8,000 cut a research reply mid-JSON. */
  maxTokens: number
  /** Interactive chat bounds spend by avoiding a second billable call after malformed output. */
  retryMalformed?: boolean
  /**
   * When the caller must have its answer by (epoch ms). Retries and timeouts all fit inside it, so
   * a run's calls cannot outlast the action they are made from.
   */
  deadline?: number
  tools?: Anthropic.Beta.BetaToolUnion[]
}

/** A web search or fetch the server ran that came back as an error, with what was asked. */
export type ToolError = { tool: string; code: string; input: string }

type Block = {
  type?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
}

/**
 * The server tools' failures in a reply. A failed search or fetch is not an API error: the model
 * sees an error block and carries on, so without this the only trace is its own summary.
 */
export function toolErrorsIn(content: readonly unknown[]): ToolError[] {
  const asked = new Map<string, { tool: string; input: string }>()
  const errors: ToolError[] = []
  for (const block of content as Block[]) {
    if (block.type === 'server_tool_use' && block.id)
      asked.set(block.id, {
        tool: block.name ?? 'tool',
        input: JSON.stringify(block.input ?? {}).slice(0, 300),
      })
    const result = block.content as { error_code?: unknown } | undefined
    if (
      (block.type === 'web_search_tool_result' || block.type === 'web_fetch_tool_result') &&
      result &&
      !Array.isArray(result) &&
      typeof result.error_code === 'string'
    ) {
      const call = asked.get(block.tool_use_id ?? '')
      errors.push({
        tool: call?.tool ?? block.type.replace('_tool_result', ''),
        code: result.error_code,
        input: call?.input ?? '',
      })
    }
  }
  return errors
}

/** Flattens the API's usage, whose fields may be null, into numbers. */
export function usageFrom(usage: Anthropic.Beta.BetaUsage): Usage {
  return {
    ...EMPTY_USAGE,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    webSearches: usage.server_tool_use?.web_search_requests ?? 0,
    webFetches: usage.server_tool_use?.web_fetch_requests ?? 0,
  }
}

async function parse<T extends z.ZodType>(
  client: Anthropic,
  call: StructuredCall<T>,
  format: ReturnType<typeof zodOutputFormat<T>>,
) {
  const request = {
    model: call.model,
    max_tokens: call.maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default' as const,
    output_config: { effort: call.effort, format },
    system: [
      { type: 'text' as const, text: call.system, cache_control: { type: 'ephemeral' as const } },
    ],
    messages: [{ role: 'user' as const, content: call.user }],
    ...(call.tools ? { tools: call.tools } : {}),
  }
  let options: Anthropic.RequestOptions | undefined
  if (call.deadline !== undefined) {
    const left = call.deadline - Date.now()
    // The message is one serviceFailure reads as a service that did not answer.
    if (left < MIN_CALL_MS) throw new Error('The AI call timed out: the run ran out of time.')
    // The timeout is per attempt; the signal stops retries and backoff at the deadline too.
    options = { timeout: Math.min(left, CALL_TIMEOUT_MS), signal: AbortSignal.timeout(left) }
  }
  // Created and parsed here rather than with messages.parse, which throws on bad JSON and so loses
  // the usage of a reply that still cost money.
  const message = await client.beta.messages.create(request, options)
  let parsed_output: z.infer<T> | null = null
  if (message.stop_reason !== 'refusal') {
    try {
      parsed_output = format.parse(
        message.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
      )
    } catch {
      // Left null: the caller sees an unreadable reply, with its usage.
    }
  }
  return { ...message, parsed_output }
}

/** Room for thinking plus the JSON on the research, playbook and write calls. Under 21,333, past which the SDK insists on streaming. */
export const STRUCTURED_MAX_TOKENS = 16_000

/**
 * One model call that must come back as JSON matching `schema`. The system prompt is cached, so
 * the per-run text goes in `user`. A safety refusal retries on the server's default fallback model
 * before it is reported as a refusal. A reply that cannot be parsed (a broken string in the JSON,
 * seen once on Haiku) gets one more try, unless it was cut off at max_tokens, where the same ask
 * would only be cut off again. `unreadable` says the reply came back but could not be used; the
 * record covers every attempt, so spend is counted even then. An API error throws.
 */
export async function callStructured<T extends z.ZodType>(
  client: Anthropic,
  call: StructuredCall<T>,
): Promise<{
  output: z.infer<T> | null
  record: CallRecord
  toolErrors: ToolError[]
  unreadable: boolean
}> {
  const startedAt = Date.now()
  const format = zodOutputFormat(call.schema)
  const first = await parse(client, call, format)
  let message = first
  let usage = usageFrom(first.usage)
  let costUsd = costOf(first.model, usage)
  const badReply = (m: typeof first) => m.parsed_output === null && m.stop_reason !== 'refusal'
  if (badReply(first) && first.stop_reason !== 'max_tokens' && call.retryMalformed !== false) {
    try {
      message = await parse(client, call, format)
      const again = usageFrom(message.usage)
      usage = addUsage(usage, again)
      costUsd += costOf(message.model, again)
    } catch (error) {
      // The first reply is still the answer, and its cost is still counted.
      // oxlint-disable-next-line no-console -- the Convex log is where this is read
      console.error('Retry of an unreadable reply failed', error)
    }
  }
  const refused = message.stop_reason === 'refusal'
  return {
    toolErrors: toolErrorsIn(message.content),
    output: refused ? null : message.parsed_output,
    unreadable: badReply(message),
    record: {
      model: message.model,
      stopReason: message.stop_reason,
      usage,
      costUsd: Math.round(costUsd * 10_000) / 10_000,
      durationMs: Date.now() - startedAt,
      refusal: refused ? (message.stop_details?.explanation ?? 'declined') : null,
    },
  }
}
