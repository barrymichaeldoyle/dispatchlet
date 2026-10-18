import { convexAuth } from '@convex-dev/auth/server'
import type { OAuthConfig } from '@auth/core/providers'
import type { GenericMutationCtx } from 'convex/server'
import type { DataModel } from './_generated/dataModel'
import { fetchBufferAccount, type BufferAccount } from './lib/buffer'
import { isValidEmail, normalizeEmail } from './lib/email'
import { addSignInToWaitlist } from './waitlist'

/**
 * Sign in with Buffer. Buffer's app clients cannot request the `openid` scope, so this is plain
 * OAuth 2 with PKCE and client_secret_post, asking only for `account:read`. The user is
 * identified by their Buffer account ID from the GraphQL `account` query, which also gives the
 * email and name. `issuer` is set because Buffer returns an `iss` parameter that is checked.
 */
const Buffer: OAuthConfig<BufferAccount> = {
  id: 'buffer',
  name: 'Buffer',
  type: 'oauth',
  issuer: 'https://auth.buffer.com',
  clientId: process.env.BUFFER_CLIENT_ID,
  clientSecret: process.env.BUFFER_CLIENT_SECRET,
  authorization: { url: 'https://auth.buffer.com/auth', params: { scope: 'account:read' } },
  token: 'https://auth.buffer.com/token',
  userinfo: {
    url: 'https://api.buffer.com',
    async request({ tokens }: { tokens: { access_token?: string } }) {
      const account = tokens.access_token ? await fetchBufferAccount(tokens.access_token) : null
      if (!account) throw new Error('Could not read the Buffer account after sign-in')
      return account
    },
  },
  checks: ['pkce', 'state'],
  client: { token_endpoint_auth_method: 'client_secret_post' },
  profile(account) {
    const email = account.email ? normalizeEmail(account.email) : undefined
    return {
      id: account.id,
      email: email && isValidEmail(email) ? email : undefined,
      name: account.name ?? undefined,
    }
  },
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Buffer],
  callbacks: {
    // Everyone who signs in before launch lands on the waiting list with the email Buffer gave us.
    async afterUserCreatedOrUpdated(ctx, { profile }) {
      if (typeof profile.email !== 'string') return
      await addSignInToWaitlist(ctx as unknown as GenericMutationCtx<DataModel>, profile.email)
    },
  },
})
