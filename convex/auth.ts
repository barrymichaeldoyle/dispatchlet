import { convexAuth } from '@convex-dev/auth/server'
import type { OAuthConfig } from '@auth/core/providers'
import type { GenericMutationCtx } from 'convex/server'
import type { DataModel, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { removeBufferConnection, saveBufferConnection, type SignInGrant } from './buffer'
import { isAllowlisted } from './lib/allowlist'
import { expiresAtFrom, fetchBufferAccount, type BufferAccount } from './lib/buffer'
import { encryptSecret } from './lib/crypto'
import { isValidEmail, normalizeEmail } from './lib/email'
import { addSignInToWaitlist } from './waitlist'

/**
 * Sign in with Buffer. Buffer's app clients cannot request the `openid` scope, so this is plain
 * OAuth 2 with PKCE and client_secret_post. The same grant is what the app will post with, so it
 * asks for account and post access plus `offline_access` for a refresh token (`prompt=consent` is
 * what makes the provider issue one). The user is identified by their Buffer account ID.
 * `issuer` is set because Buffer returns an `iss` parameter that is checked.
 */
const Buffer: OAuthConfig<BufferAccount> = {
  id: 'buffer',
  name: 'Buffer',
  type: 'oauth',
  issuer: 'https://auth.buffer.com',
  clientId: process.env.BUFFER_CLIENT_ID,
  clientSecret: process.env.BUFFER_CLIENT_SECRET,
  authorization: {
    url: 'https://auth.buffer.com/auth',
    params: { scope: 'account:read posts:read posts:write offline_access', prompt: 'consent' },
  },
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
  // Tokens are encrypted here, in the HTTP action, so they never reach the database in plain text.
  async profile(account, tokens) {
    const email = account.email ? normalizeEmail(account.email) : undefined
    const grant: SignInGrant | undefined = tokens.access_token
      ? {
          bufferAccountId: account.id,
          accessTokenEnc: await encryptSecret(tokens.access_token),
          refreshTokenEnc: tokens.refresh_token
            ? await encryptSecret(tokens.refresh_token)
            : undefined,
          expiresAt: expiresAtFrom(tokens.expires_in),
          scope: typeof tokens.scope === 'string' ? tokens.scope : '',
        }
      : undefined
    return {
      id: account.id,
      email: email && isValidEmail(email) ? email : undefined,
      name: account.name ?? undefined,
      bufferGrant: grant,
    }
  },
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Buffer],
  /** A sign-in lasts a year, used or not; a scheduled agent should not sign its owner out. */
  session: { totalDurationMs: YEAR_MS, inactiveDurationMs: YEAR_MS },
  callbacks: {
    /**
     * One user per Buffer account. Everyone who signs in before launch joins the waiting list.
     * Only allowlisted accounts keep their Buffer grant (encrypted, in `bufferConnections`, never
     * on the user row); anyone else's grant is revoked straight away, since the app is not open.
     */
    async createOrUpdateUser(rawCtx, { existingUserId, profile }) {
      const ctx = rawCtx as unknown as GenericMutationCtx<DataModel>
      const email = typeof profile.email === 'string' ? profile.email : undefined
      const name = typeof profile.name === 'string' ? profile.name : undefined
      const fields = { email, name, emailVerificationTime: email ? Date.now() : undefined }
      let userId = existingUserId as Id<'users'> | null
      if (userId) await ctx.db.patch(userId, fields)
      else userId = await ctx.db.insert('users', fields)
      const grant = profile.bufferGrant as SignInGrant | undefined
      if (grant && isAllowlisted(grant.bufferAccountId, email ?? null)) {
        await saveBufferConnection(ctx, userId, grant)
      } else if (grant) {
        await removeBufferConnection(ctx, userId)
        await ctx.scheduler.runAfter(0, internal.buffer.revokeGrant, {
          accessTokenEnc: grant.accessTokenEnc,
          refreshTokenEnc: grant.refreshTokenEnc,
        })
      }
      if (email) await addSignInToWaitlist(ctx, email)
      return userId
    },
  },
})
