import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { z } from 'zod'
import { costOf, EMPTY_USAGE, isKnownModel, type ModelId, type Usage } from './pricing'

/**
 * The one place a model is chosen. On the 28 Oct eval Haiku 5.5 matched Sonnet 5.5 on research
 * picks and on the posts, at a fifth of the cost, so runs use it; the playbook, a one-off that
 * needs judgement about sources, stays on Sonnet.
 */
const DEFAULT_MODELS = {
  research: 'claude-haiku-5-5',
  write: 'claude-haiku-5-5',
  playbook: 'claude-sonnet-5-5',
  reparse: 'claude-haiku-5-5',
} as const satisfies Record<string, ModelId>

export type Step = keyof typeof DEFAULT_MODELS

/** The model for a step, overridable per deployment with MODEL_RESEARCH, MODEL_WRITE, MODEL_PLAYBOOK. */
export function modelFor(step: Step): ModelId {
  const override = process.env[`MODEL_${step.toUpperCase()}`]
  return override && isKnownModel(override) ? override : DEFAULT_MODELS[step]
}

export type Effort = 'low' | 'medium' | 'high'

export function anthropicClient(apiKey = process.env.ANTHROPIC_API_KEY): Anthropic {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 8 * 60_000 })
}

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
  maxTokens: number
  tools?: Anthropic.Beta.BetaToolUnion[]
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

function parse<T extends z.ZodType>(client: Anthropic, call: StructuredCall<T>) {
  return client.beta.messages.parse({
    model: call.model,
    max_tokens: call.maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: call.effort, format: zodOutputFormat(call.schema) },
    system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: call.user }],
    ...(call.tools ? { tools: call.tools } : {}),
  })
}

/**
 * One model call that must come back as JSON matching `schema`. The system prompt is cached, so
 * the per-run text goes in `user`. A safety refusal retries on the server's default fallback model
 * before it is reported as a refusal. A reply the SDK cannot parse (a broken string in the JSON,
 * seen once on Haiku) gets one more try; an API error does not.
 */
export async function callStructured<T extends z.ZodType>(
  client: Anthropic,
  call: StructuredCall<T>,
  attempt = 0,
): Promise<{ output: z.infer<T> | null; record: CallRecord }> {
  const startedAt = Date.now()
  let message: Awaited<ReturnType<typeof parse<T>>>
  try {
    message = await parse(client, call)
  } catch (error) {
    if (attempt === 0 && !(error instanceof Anthropic.APIError))
      return callStructured(client, call, 1)
    throw error
  }
  const usage = usageFrom(message.usage)
  const refused = message.stop_reason === 'refusal'
  return {
    output: refused ? null : message.parsed_output,
    record: {
      model: message.model,
      stopReason: message.stop_reason,
      usage,
      costUsd: costOf(message.model, usage),
      durationMs: Date.now() - startedAt,
      refusal: refused ? (message.stop_details?.explanation ?? 'declined') : null,
    },
  }
}
