/**
 * @fileoverview Implements the authentication/session boundary that connects Cognito OAuth, tenant identity resolution, opaque server-side sessions and protected Fastify requests.
 *
 * @remarks
 * Direct links: `fastify`, `../../shared/errors.js`, `../../shared/encoding.js`, `./identity-repository.js`, `./session-store.js`.
 * Security: Authentication/session security boundary; changes require negative tests for replay, binding, MFA and unauthenticated access.
 */

import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';

import { ApplicationError } from '../../shared/errors.js';
import { hashToken, privacyHash, randomToken, safeTokenEqual } from '../../shared/encoding.js';
import { refreshIdentity, resolveAuthRuntime } from './identity-repository.js';
import type { StoredSession } from './session-store.js';

const identityRefreshSeconds = 60;
const touchIntervalSeconds = 30;

/** Returns cookie names that enforce the __Host- prefix in production. */
export function cookieNames(request: FastifyRequest): {
  readonly session: string;
  readonly device: string;
} {
  const prefix = request.server.configuration.cookieSecure ? '__Host-' : '';
  return { session: `${prefix}edutex_sid`, device: `${prefix}edutex_device` };
}

/** Creates an opaque, device-bound server-side session and emits only random cookies. */
export async function issueSession(
  request: FastifyRequest,
  reply: FastifyReply,
  input: Omit<StoredSession, 'sessionHash' | 'deviceHash' | 'userAgentHash'>,
): Promise<void> {
  const names = cookieNames(request);
  const rawSession = randomToken(32);
  const existingDevice = request.cookies[names.device];
  const rawDevice =
    existingDevice && existingDevice.length >= 32 ? existingDevice : randomToken(32);
  const session: StoredSession = {
    ...input,
    sessionHash: hashToken(rawSession),
    deviceHash: hashToken(rawDevice),
    userAgentHash: privacyHash(request.headers['user-agent'] ?? ''),
  };
  await request.server.sessionStore.create(session);

  const cookieOptions = {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: request.server.configuration.cookieSecure,
  };
  reply.setCookie(names.session, rawSession, {
    ...cookieOptions,
    expires: new Date(session.absoluteExpiresAtEpoch * 1000),
  });
  if (existingDevice !== rawDevice) {
    reply.setCookie(names.device, rawDevice, {
      ...cookieOptions,
      expires: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });
  }
}

/** Authenticates and refreshes a server-side session; fails closed on binding mismatch. */
export async function authenticateRequest(request: FastifyRequest): Promise<void> {
  const names = cookieNames(request);
  const rawSession = request.cookies[names.session];
  const rawDevice = request.cookies[names.device];
  if (!rawSession || !rawDevice) {
    throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in to continue.');
  }
  const sessionHash = hashToken(rawSession);
  let session = await request.server.sessionStore.get(sessionHash);
  const now = Math.floor(Date.now() / 1000);
  if (
    !session ||
    session.idleExpiresAtEpoch <= now ||
    session.absoluteExpiresAtEpoch <= now ||
    !safeTokenEqual(session.deviceHash, hashToken(rawDevice)) ||
    !safeTokenEqual(session.userAgentHash, privacyHash(request.headers['user-agent'] ?? ''))
  ) {
    if (session) await request.server.sessionStore.delete(sessionHash);
    throw new ApplicationError(
      401,
      'SESSION_INVALID',
      'Your session has expired. Please sign in again.',
    );
  }

  if (now - session.identityCheckedAtEpoch >= identityRefreshSeconds) {
    const refreshed = await refreshIdentity(session.user.tenantId, session.user.id);
    if (!refreshed) {
      await request.server.sessionStore.delete(sessionHash);
      throw new ApplicationError(401, 'ACCOUNT_DISABLED', 'This account is no longer active.');
    }
    session = {
      ...session,
      identityCheckedAtEpoch: now,
      identityVersion: refreshed.identityVersion,
      user: {
        ...refreshed,
        authenticationMethods: session.user.authenticationMethods,
        mfaSatisfiedAt: session.user.mfaSatisfiedAt,
      },
    };
    await request.server.sessionStore.replace(session);
  } else if (now - session.lastSeenAtEpoch >= touchIntervalSeconds) {
    const idleSeconds = Math.max(300, session.idleExpiresAtEpoch - session.lastSeenAtEpoch);
    const idleExpiresAtEpoch = now + idleSeconds;
    const expiresAtEpoch = Math.min(idleExpiresAtEpoch, session.absoluteExpiresAtEpoch);
    await request.server.sessionStore.touch(sessionHash, idleExpiresAtEpoch, expiresAtEpoch, now);
    session = { ...session, idleExpiresAtEpoch, expiresAtEpoch, lastSeenAtEpoch: now };
  }

  request.identity = {
    sessionHash,
    csrfToken: session.csrfToken,
    deviceHash: session.deviceHash,
    expiresAt: new Date(
      Math.min(session.idleExpiresAtEpoch, session.absoluteExpiresAtEpoch) * 1000,
    ).toISOString(),
    user: session.user,
  };
}

/** Fastify pre-handler that requires an authenticated session. */
export const requireSession: preHandlerAsyncHookHandler = async (request): Promise<void> => {
  await authenticateRequest(request);
};

/** Builds a pre-handler that checks an immutable server-side permission set. */
export function requirePermission(permission: string): preHandlerAsyncHookHandler {
  return /** Performs the local `callback` operation inside `requirePermission` and returns control to the surrounding feature only after this body completes. It receives `request`. Direct links: `authenticateRequest`, `request.identity?.user.permissions.includes`. */ async (
    request,
  ): Promise<void> => {
    if (!request.identity) await authenticateRequest(request);
    if (
      !request.identity?.user.permissions.includes(permission) &&
      !request.identity?.user.permissions.includes('platform:manage') &&
      !request.identity?.user.permissions.includes(`${permission.split(':')[0]}:manage`)
    ) {
      throw new ApplicationError(
        403,
        'PERMISSION_DENIED',
        'You do not have permission for this action.',
      );
    }
  };
}

/** Requires the in-memory CSRF token returned by the session endpoint for mutations. */
export const requireCsrf: preHandlerAsyncHookHandler = async (request): Promise<void> => {
  if (!request.identity) await authenticateRequest(request);
  const suppliedToken = request.headers['x-csrf-token'];
  if (
    typeof suppliedToken !== 'string' ||
    !request.identity ||
    !safeTokenEqual(suppliedToken, request.identity.csrfToken)
  ) {
    throw new ApplicationError(403, 'CSRF_VALIDATION_FAILED', 'The request could not be verified.');
  }
};

/** Requires a recent passkey or second factor before sensitive operations. */
export const requireRecentMfa: preHandlerAsyncHookHandler = async (request): Promise<void> => {
  if (!request.identity) await authenticateRequest(request);
  if (!request.identity)
    throw new ApplicationError(401, 'AUTHENTICATION_REQUIRED', 'Please sign in.');
  const runtime = await resolveAuthRuntime(request.identity.user.tenantId);
  const verifiedAt = request.identity.user.mfaSatisfiedAt
    ? Date.parse(request.identity.user.mfaSatisfiedAt)
    : Number.NaN;
  if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt > runtime.stepUpMinutes * 60 * 1000) {
    const method = runtime.passkeyEnabled ? 'passkey' : 'password';
    throw new ApplicationError(
      403,
      'STEP_UP_REQUIRED',
      'Recent multi-factor or passkey authentication is required.',
      {
        stepUpUrl: `/api/v1/auth/start?method=${method}&stepUp=true&returnTo=/app/students`,
      },
    );
  }
};

/** Deletes a single device session without affecting other valid devices. */
export async function revokeCurrentSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const names = cookieNames(request);
  const rawSession = request.cookies[names.session];
  if (rawSession) await request.server.sessionStore.delete(hashToken(rawSession));
  reply.clearCookie(names.session, {
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: request.server.configuration.cookieSecure,
  });
}
