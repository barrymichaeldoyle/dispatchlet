import { describe, expect, it } from 'vitest'
import { operationName } from './serverEvents'

describe('server events', () => {
  it('name each Buffer call by its GraphQL operation', () => {
    expect(operationName('query DispatchletChannels($orgId: OrganizationId!) { channels }')).toBe(
      'DispatchletChannels',
    )
    expect(operationName('mutation DispatchletIdea($input: CreateIdeaInput!) {}')).toBe(
      'DispatchletIdea',
    )
    expect(operationName('{ account { id } }')).toBe('unnamed')
  })
})
