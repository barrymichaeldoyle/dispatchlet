/**
 * For tests that stub `fetch`: a stub answers the Messages API with one JSON message, but a
 * streamed call (research reports its searches as they land) expects server-sent events. This
 * wraps a stub so a streamed request gets the same message as an event stream.
 */
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type Message = { content: { type: string; text?: string }[]; usage: object } & Record<
  string,
  unknown
>

function asEvents(message: Message): Response {
  const events: [string, unknown][] = [
    ['message_start', { type: 'message_start', message: { ...message, content: [] } }],
  ]
  message.content.forEach((block, index) => {
    if (block.type === 'text') {
      events.push(
        [
          'content_block_start',
          { type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
        ],
        [
          'content_block_delta',
          { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } },
        ],
      )
    } else {
      events.push([
        'content_block_start',
        { type: 'content_block_start', index, content_block: block },
      ])
    }
    events.push(['content_block_stop', { type: 'content_block_stop', index }])
  })
  events.push(
    [
      'message_delta',
      {
        type: 'message_delta',
        delta: { stop_reason: message.stop_reason, stop_sequence: null },
        usage: message.usage,
      },
    ],
    ['message_stop', { type: 'message_stop' }],
  )
  const body = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

export function withStreaming(stub: Fetch): Fetch {
  return async (input, init) => {
    const response = await stub(input, init)
    let asked = false
    try {
      asked = JSON.parse(String(init?.body ?? '{}')).stream === true
    } catch {
      asked = false
    }
    if (!asked || !response.ok) return response
    const message = (await response.clone().json()) as Message
    return message?.type === 'message' ? asEvents(message) : response
  }
}
