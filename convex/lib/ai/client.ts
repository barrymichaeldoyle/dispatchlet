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
  // Busy and rate-limit replies (429, 529) are retried with backoff, which rides out a spike of
  // runs starting at once; a run that still fails gives its free run back (runs.serviceFailure).
  return new Anthropic({ apiKey, maxRetries: 4, timeout: 8 * 60_000 })
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
  /** Thinking counts against this, so high-effort calls need room: 8,000 cut a research reply mid-JSON. */
  maxTokens: number
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

/** Room for thinking plus the JSON on the research, playbook and write calls. Under 21,333, past which the SDK insists on streaming. */
export const STRUCTURED_MAX_TOKENS = 16_000

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
): Promise<{ output: z.infer<T> | null; record: CallRecord; toolErrors: ToolError[] }> {
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
    toolErrors: toolErrorsIn(message.content),
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
