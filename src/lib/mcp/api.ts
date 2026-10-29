/**
 * The MCP server's client for the Dispatchlet API (SPEC §44.6). Each call carries the caller's
 * own bearer token to the Convex site, so scope, allowances and rate limits are the API's.
 */

export class DispatchletApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

export type ApiClient = {
  get: (path: string, accept?: string) => Promise<unknown>
  send: (
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    contentType?: string,
  ) => Promise<unknown>
}

export function apiClient(
  baseUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): ApiClient {
  async function call(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body !== undefined && !headers['Content-Type']
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    const text = await response.text()
    const type = response.headers.get('content-type') ?? ''
    const data: unknown = type.includes('json') && text ? JSON.parse(text) : text
    if (!response.ok) {
      const error = (data as { error?: { code?: string; message?: string } })?.error
      throw new DispatchletApiError(
        response.status,
        error?.code ?? 'unavailable',
        error?.message ?? `The API answered ${response.status}.`,
      )
    }
    return data
  }
  return {
    get: (path, accept) => call('GET', path, undefined, accept ? { Accept: accept } : {}),
    send: (method, path, body, contentType) =>
      call(method, path, body, contentType ? { 'Content-Type': contentType } : {}),
  }
}
