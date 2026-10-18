import { convexAuth } from '@convex-dev/auth/server'
import type { OIDCConfig } from '@auth/core/providers'
import type { GenericMutationCtx } from 'convex/server'
import type { DataModel } from './_generated/dataModel'
import { fetchBufferAccount } from './lib/buffer'
import { isValidEmail, normalizeEmail } from './lib/email'
import { addSignInToWaitlist } from './waitlist'

/**
 * Sign in with Buffer. Buffer runs an OIDC provider that is not in the Auth.js list, so it is
 * configured by hand: PKCE, client_secret_post, and only `account:read` until the app needs to
 * post (see SPEC §0 on single-use refresh tokens before adding offline_access).
 */
const Buffer: OIDCConfig<{ sub: string }> = {
  id: 'buffer',
  name: 'Buffer',
  type: 'oidc',
  issuer: 'https://auth.buffer.com',
  clientId: process.env.BUFFER_CLIENT_ID,
  clientSecret: process.env.BUFFER_CLIENT_SECRET,
  authorization: { params: { scope: 'openid account:read' } },
  checks: ['pkce', 'state'],
  client: { token_endpoint_auth_method: 'client_secret_post' },
  async profile(claims, tokens) {
    const account = tokens.access_token ? await fetchBufferAccount(tokens.access_token) : null
    const email = account?.email ? normalizeEmail(account.email) : undefined
    return {
      id: claims.sub,
      email: email && isValidEmail(email) ? email : undefined,
      name: account?.name ?? undefined,
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
