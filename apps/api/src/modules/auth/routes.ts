/**
 * @fileoverview Registers the auth HTTP API routes, validates untrusted requests and connects authenticated Fastify handlers to tenant-scoped services/PostgreSQL transactions.
 *
 * @remarks
 * Direct links: `node:crypto`, `@edutex/contracts`, `fastify`, `zod`, `../../shared/errors.js`, `../../shared/encoding.js`, `./cognito.js`, `./identity-repository.js`, `/app`, `/api/v1/auth/callback`, `/api/v1/public/tenant`, `/api/v1/auth/start`, `/api/v1/auth/passkeys/register`, `/api/v1/session`.
 * Security: Authentication/session security boundary; changes require negative tests for replay, binding, MFA and unauthenticated access.
 */

import { createHash } from 'node:crypto';

import { sessionResponseSchema, sessionUserSchema } from '@edutex/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ApplicationError } from '../../shared/errors.js';
import { hashToken, randomToken, safeTokenEqual } from '../../shared/encoding.js';
import {
  authenticationMethods,
  buildAuthorizationUrl,
  buildPasskeyRegistrationUrl,
  createAuthorizationMaterial,
  exchangeAuthorizationCode,
  federatedProviderMatches,
  mfaWasSatisfied,
  requireLiveLocalMfaPolicy,
  selectDirectoryClaims,
  verifyIdentityToken,
} from './cognito.js';
import {
  establishIdentity,
  resolveAuthRuntime,
  resolvePublicTenant,
} from './identity-repository.js';
import {
  cookieNames,
  issueSession,
  requireCsrf,
  requireSession,
  revokeCurrentSession,
} from './session.js';

const startQuerySchema = z.object({
  method: z.string().regex(/^[a-z][a-z0-9-]{1,62}$/),
  returnTo: z
    .string()
    .regex(/^\/app(?:\/.*)?$/)
    .default('/app'),
  stepUp: z.coerce.boolean().default(false),
});

const callbackQuerySchema = z.object({
  code: z.string().min(16).max(8192),
  state: z.string().min(32).max(512),
});

/** Canonicalises the request host for exact school-domain resolution. */
function requestHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/** Builds the single registered OAuth callback URL from production configuration. */
function callbackUrl(server: FastifyInstance): string {
  return new URL('/api/v1/auth/callback', server.configuration.publicBaseUrl).toString();
}

/** Uses the `__Host-` cookie prefix whenever secure production cookies are enabled. */
function authenticationCookieName(server: FastifyInstance): string {
  return `${server.configuration.cookieSecure ? '__Host-' : ''}edutex_auth`;
}

/** Registers public OIDC entry points and authenticated device-session endpoints. */
export function registerAuthenticationRoutes(server: FastifyInstance): void {
  server.get('/api/v1/public/tenant', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    /** Implements `handler` for registers the auth http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `resolvePublicTenant`, `requestHostname`, `reply.header`. */ handler:
      async (request, reply) => {
        const configuration = await resolvePublicTenant(requestHostname(request.hostname));
        if (!configuration) {
          throw new ApplicationError(
            404,
            'TENANT_NOT_FOUND',
            'This Edutex school domain is not configured.',
          );
        }
        reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300');
        return configuration;
      },
  });

  server.get('/api/v1/auth/start', {
    config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
    /** Implements `handler` for registers the auth http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `startQuerySchema.parse`, `resolvePublicTenant`, `requestHostname`, `resolveAuthRuntime`, `['password', 'passkey'].includes`. */ handler:
      async (request, reply) => {
        const query = startQuerySchema.parse(request.query);
        const publicTenant = await resolvePublicTenant(requestHostname(request.hostname));
        if (!publicTenant) {
          throw new ApplicationError(
            404,
            'TENANT_NOT_FOUND',
            'This Edutex school domain is not configured.',
          );
        }
        const runtime = await resolveAuthRuntime(publicTenant.tenantId);
        const isLocalMethod = ['password', 'passkey'].includes(query.method);
        const externalProvider = publicTenant.providers.find(
          /** Selects the first input item matching this lookup condition for `handler`; no match deliberately returns undefined. It receives `provider`. It uses only the local values shown in its body. */ (
            provider,
          ) => provider.key === query.method && provider.enabled,
        );
        if (
          (isLocalMethod &&
            !publicTenant.enabledMethods.some(
              /** Reports whether at least one input item satisfies this authorization/validation condition for `handler`. It receives `method`. It uses only the local values shown in its body. */ (
                method,
              ) => method === query.method,
            )) ||
          (!isLocalMethod && !externalProvider)
        ) {
          throw new ApplicationError(
            400,
            'AUTHENTICATION_METHOD_DISABLED',
            'That sign-in method is unavailable.',
          );
        }

        const providerKey = isLocalMethod ? 'local' : query.method;
        const cognitoProviderName = isLocalMethod ? 'COGNITO' : runtime.providers[providerKey];
        if (!cognitoProviderName) {
          throw new ApplicationError(
            503,
            'IDENTITY_PROVIDER_UNAVAILABLE',
            'That sign-in method is unavailable.',
          );
        }

        const material = createAuthorizationMaterial();
        const rawBinding = randomToken(32);
        const expiresAtEpoch = Math.floor(Date.now() / 1000) + 5 * 60;
        await server.transactionStore.create({
          stateHash: material.stateHash,
          tenantId: publicTenant.tenantId,
          codeVerifier: material.codeVerifier,
          bindingHash: hashToken(rawBinding),
          nonce: material.nonce,
          providerKey,
          returnTo: query.returnTo,
          stepUp: query.stepUp,
          expiresAtEpoch,
        });
        reply.setCookie(authenticationCookieName(server), rawBinding, {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: server.configuration.cookieSecure,
          expires: new Date(expiresAtEpoch * 1000),
        });

        const destination = buildAuthorizationUrl(runtime, {
          callbackUrl: callbackUrl(server),
          state: material.state,
          nonce: material.nonce,
          codeChallenge: material.codeChallenge,
          cognitoProviderName,
          stepUp: query.stepUp,
        });
        reply.header('cache-control', 'no-store');
        return reply.redirect(destination, 303);
      },
  });

  server.get('/api/v1/auth/callback', {
    config: { rateLimit: { max: 30, timeWindow: '5 minutes' } },
    /** Implements `handler` for registers the auth http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `callbackQuerySchema.parse`, `createHash('sha256').update(query.state).dige`, `createHash('sha256').update`, `createHash`, `server.transactionStore.consume`. */ handler:
      async (request, reply) => {
        const query = callbackQuerySchema.parse(request.query);
        const stateHash = createHash('sha256').update(query.state).digest('base64url');
        const transaction = await server.transactionStore.consume(stateHash);
        const now = Math.floor(Date.now() / 1000);
        const rawBinding = request.cookies[authenticationCookieName(server)];
        if (!transaction || transaction.expiresAtEpoch <= now) {
          throw new ApplicationError(
            401,
            'AUTH_TRANSACTION_EXPIRED',
            'The sign-in request expired. Please try again.',
          );
        }
        if (!rawBinding || !safeTokenEqual(transaction.bindingHash, hashToken(rawBinding))) {
          throw new ApplicationError(
            401,
            'AUTH_TRANSACTION_BINDING_FAILED',
            'The sign-in request could not be verified on this browser.',
          );
        }
        reply.clearCookie(authenticationCookieName(server), {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: server.configuration.cookieSecure,
        });

        const runtime = await resolveAuthRuntime(transaction.tenantId);
        // The token response remains inside this callback. Only the verified ID-token claims are
        // used; access and refresh tokens are discarded when this handler returns.
        const tokens = await exchangeAuthorizationCode(
          runtime,
          query.code,
          transaction.codeVerifier,
          callbackUrl(server),
          server.configuration.awsRegion,
        );
        const claims = await verifyIdentityToken(
          runtime,
          tokens.id_token,
          transaction.nonce,
          server.configuration.awsRegion,
        );

        const subject = typeof claims.sub === 'string' ? claims.sub : '';
        const email = typeof claims['email'] === 'string' ? claims['email'] : '';
        const emailVerified =
          claims['email_verified'] === true || claims['email_verified'] === 'true';
        if (!subject || !email || (transaction.providerKey === 'local' && !emailVerified)) {
          throw new ApplicationError(
            403,
            'IDENTITY_CLAIMS_INCOMPLETE',
            'Your identity provider did not supply a verified account.',
          );
        }
        const displayName =
          (typeof claims['name'] === 'string' && claims['name']) ||
          (typeof claims['preferred_username'] === 'string' && claims['preferred_username']) ||
          email;
        if (transaction.providerKey === 'local') {
          if (!runtime.passkeyEnabled && !runtime.passwordEnabled) {
            throw new ApplicationError(
              403,
              'AUTHENTICATION_METHOD_DISABLED',
              'That local sign-in method is not enabled for this school.',
            );
          }
        } else {
          const expectedProviderName = runtime.providers[transaction.providerKey];
          if (!expectedProviderName) {
            throw new ApplicationError(
              403,
              'AUTHENTICATION_METHOD_DISABLED',
              'That identity provider is no longer enabled for this school.',
            );
          }
          if (!federatedProviderMatches(claims, expectedProviderName)) {
            throw new ApplicationError(
              403,
              'IDENTITY_PROVIDER_MISMATCH',
              'The identity provider did not match the sign-in request.',
            );
          }
        }

        const tokenMethods = authenticationMethods(claims, transaction.providerKey);
        const localPolicyMethods =
          transaction.providerKey === 'local'
            ? await requireLiveLocalMfaPolicy(runtime, server.configuration.awsRegion)
            : [];
        const methods = [...new Set([...tokenMethods, ...localPolicyMethods])].slice(0, 10);
        const highAssuranceAuthentication =
          transaction.providerKey === 'local' ? true : mfaWasSatisfied(methods);
        if (transaction.stepUp && !highAssuranceAuthentication) {
          throw new ApplicationError(
            403,
            'MFA_REQUIRED',
            'Passkey or authenticator verification is required for this action.',
          );
        }

        const databaseIdentity = await establishIdentity({
          tenantId: transaction.tenantId,
          subject,
          email,
          displayName,
          providerKey: transaction.providerKey,
          claims: selectDirectoryClaims(claims),
        });
        const user = sessionUserSchema.parse({
          ...databaseIdentity,
          authenticationMethods: methods,
          mfaSatisfiedAt: highAssuranceAuthentication ? new Date().toISOString() : null,
        });

        const existingSession = request.cookies[cookieNames(request).session];
        if (existingSession) await server.sessionStore.delete(hashToken(existingSession));
        const absoluteExpiresAtEpoch = now + runtime.sessionAbsoluteHours * 60 * 60;
        const idleExpiresAtEpoch = now + runtime.sessionIdleMinutes * 60;
        await issueSession(request, reply, {
          csrfToken: randomToken(32),
          user,
          identityVersion: databaseIdentity.identityVersion,
          createdAtEpoch: now,
          lastSeenAtEpoch: now,
          identityCheckedAtEpoch: now,
          idleExpiresAtEpoch,
          absoluteExpiresAtEpoch,
          expiresAtEpoch: Math.min(idleExpiresAtEpoch, absoluteExpiresAtEpoch),
        });
        reply.header('cache-control', 'no-store');
        return reply.redirect(transaction.returnTo, 303);
      },
  });

  server.post('/api/v1/auth/passkeys/register', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    preHandler: [requireSession, requireCsrf],
    /** Implements `handler` for registers the auth http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `resolveAuthRuntime`, `createAuthorizationMaterial`, `randomToken`, `Math.floor`, `Date.now`. */ handler:
      async (request, reply) => {
        const tenantId = request.identity?.user.tenantId;
        if (!tenantId) {
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        }
        const runtime = await resolveAuthRuntime(tenantId);
        if (!runtime.passkeyEnabled) {
          throw new ApplicationError(
            403,
            'AUTHENTICATION_METHOD_DISABLED',
            'Passkey registration is unavailable for this school.',
          );
        }

        const material = createAuthorizationMaterial();
        const rawBinding = randomToken(32);
        const expiresAtEpoch = Math.floor(Date.now() / 1000) + 5 * 60;
        await server.transactionStore.create({
          stateHash: material.stateHash,
          tenantId,
          codeVerifier: material.codeVerifier,
          bindingHash: hashToken(rawBinding),
          nonce: material.nonce,
          providerKey: 'local',
          returnTo: '/app',
          stepUp: false,
          expiresAtEpoch,
        });
        reply.setCookie(authenticationCookieName(server), rawBinding, {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: server.configuration.cookieSecure,
          expires: new Date(expiresAtEpoch * 1000),
        });
        reply.header('cache-control', 'no-store');
        return {
          redirectTo: buildPasskeyRegistrationUrl(runtime, {
            callbackUrl: callbackUrl(server),
            state: material.state,
            nonce: material.nonce,
            codeChallenge: material.codeChallenge,
          }),
        };
      },
  });

  server.get('/api/v1/session', {
    preHandler: [requireSession],
    /** Implements `handler` for registers the auth http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `reply.header`, `sessionResponseSchema.parse`. */ handler:
      async (request, reply) => {
        if (!request.identity)
          throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
        reply.header('cache-control', 'no-store');
        return sessionResponseSchema.parse({
          user: request.identity.user,
          csrfToken: request.identity.csrfToken,
          expiresAt: request.identity.expiresAt,
        });
      },
  });

  server.post('/api/v1/auth/logout', {
    preHandler: [requireSession, requireCsrf],
    /** Implements `handler` for registers the auth http api routes, validates untrusted requests and connects authenticated fastify handlers to tenant-scoped services/postgresql transactions. It receives `request`, `reply`. Direct links: `revokeCurrentSession`, `resolveAuthRuntime`, `(() => { const base = new URL( runtime.cognit`, `reply.header`. */ handler:
      async (request, reply) => {
        const tenantId = request.identity?.user.tenantId;
        await revokeCurrentSession(request, reply);
        const runtime = tenantId ? await resolveAuthRuntime(tenantId) : undefined;
        const redirectTo = runtime
          ? (
              /** Performs the local `callback` operation inside `handler` and returns control to the surrounding feature only after this body completes. Direct links: `runtime.cognitoDomain.includes`, `new URLSearchParams({ client_id: runtime.cogn`, `new URL('/auth/', server.configuration.public`, `logout.toString`. */ () => {
                const base = new URL(
                  runtime.cognitoDomain.includes('://')
                    ? runtime.cognitoDomain
                    : `https://${runtime.cognitoDomain}`,
                );
                const logout = new URL('/logout', base);
                logout.search = new URLSearchParams({
                  client_id: runtime.cognitoClientId,
                  logout_uri: new URL('/auth/', server.configuration.publicBaseUrl).toString(),
                }).toString();
                return logout.toString();
              }
            )()
          : '/auth/';
        reply.header('cache-control', 'no-store');
        return { redirectTo };
      },
  });
}
