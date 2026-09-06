/**
 * @fileoverview Implements a protected-portal trust helper for same-origin API access, navigation, session state or browser-side restricted-field encryption.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `/auth/`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { apiErrorSchema, type ApiError } from '@edutex/contracts';

let csrfToken: string | undefined;

/** Stores the per-session CSRF secret only in JavaScript memory. */
export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

export class ApiRequestError extends Error {
  /** Constructs `api` and assembles the AWS/resource relationships defined in this class without exposing a public origin or broader credentials. It receives `response`. Direct links: `super`. */ public constructor(
    public readonly response: ApiError,
  ) {
    super(response.message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Calls the same-origin BFF with credentials, bounded response handling and the
 * in-memory CSRF token for state-changing requests.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  headers.set('accept', 'application/json');
  if (options.body && !(options.body instanceof FormData))
    headers.set('content-type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers,
    redirect: 'error',
    ...(signal ? { signal } : {}),
  });
  if (response.status === 401) {
    setCsrfToken(undefined);
    // The session module listens for this local event and drops all non-extractable sensitive-field
    // key references before navigation; avoiding a direct crypto import keeps the API/crypto module
    // graph acyclic.
    window.dispatchEvent(new Event('edutex:session-expired'));
    window.location.replace('/auth/');
    throw new Error('Your session has expired.');
  }
  if (!response.ok) {
    const candidate: unknown = await response.json().catch(
      /** Handles a rejected asynchronous operation inside `apiRequest`, suppressing abort-only failures and exposing a bounded user-safe error. Direct links: `response.headers.get`. */ () => ({
        statusCode: response.status,
        code: 'REQUEST_FAILED',
        message: 'The request could not be completed.',
        requestId: response.headers.get('x-request-id') ?? 'unknown',
      }),
    );
    throw new ApiRequestError(apiErrorSchema.parse(candidate));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Serializes a value with an explicit JSON content type for mutation requests. */
export function jsonBody(value: unknown): Pick<RequestInit, 'body' | 'headers'> {
  return { body: JSON.stringify(value), headers: { 'content-type': 'application/json' } };
}
