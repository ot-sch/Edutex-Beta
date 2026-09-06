/**
 * @fileoverview Implements a protected-portal trust helper for same-origin API access, navigation, session state or browser-side restricted-field encryption.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `react`, `./api.js`, `./field-encryption.js`, `/api/v1/session`, `/api/v1/auth/passkeys/register`, `/api/v1/auth/logout`, `/app/edutex-logo.png`, `/auth/`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { sessionResponseSchema, type ModuleId, type SessionResponse } from '@edutex/contracts';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { apiRequest, jsonBody, setCsrfToken } from './api.js';
import { clearSensitiveFieldKeys } from './field-encryption.js';

interface SessionContextValue {
  readonly session: SessionResponse;
  readonly hasPermission: (permission: string) => boolean;
  readonly isModuleEnabled: (module: ModuleId) => boolean;
  readonly registerPasskey: () => Promise<void>;
  readonly signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

/** Makes the authenticated session and immutable permission set available to pages. */
export function SessionProvider(props: { readonly children: React.ReactNode }): React.JSX.Element {
  const [session, setSession] = useState<SessionResponse>();
  const [error, setError] = useState<string>();

  useEffect(
    /** Synchronises `SessionProvider` with browser/API state after the declared React dependencies change and returns any required cleanup. Direct links: `apiRequest<unknown>('/api/v1/session', {}, co`, `apiRequest`. */ () => {
      const controller = new AbortController();
      void apiRequest<unknown>('/api/v1/session', {}, controller.signal)
        .then(
          /** Performs the local `apiRequest<unknown>('/api/v1/session', {}, controller.signal` operation inside `SessionProvider` and returns control to the surrounding feature only after this body completes. It receives `value`. Direct links: `sessionResponseSchema.parse`, `setCsrfToken`, `setSession`. */ (
            value,
          ) => {
            const parsed = sessionResponseSchema.parse(value);
            setCsrfToken(parsed.csrfToken);
            setSession(parsed);
          },
        )
        .catch(
          /** Performs the local `apiRequest<unknown>('/api/v1/session', {}, controller.signal` operation inside `SessionProvider` and returns control to the surrounding feature only after this body completes. It receives `reason`. Direct links: `setError`. */ (
            reason: unknown,
          ) => {
            if (!controller.signal.aborted) {
              setError(
                reason instanceof Error
                  ? errorMessage(reason)
                  : 'Your session could not be loaded.',
              );
            }
          },
        );
      return /** Performs the local `callback` operation inside `SessionProvider` and returns control to the surrounding feature only after this body completes. Direct links: `controller.abort`. */ () => {
        controller.abort();
      };
    },
    [],
  );

  useEffect(
    /** Drops restricted-field keys whenever the same-origin API reports that this device session expired. */ () => {
      /** Handles the in-memory session-expiry event without reading or writing browser storage. */
      const clearKeys = (): void => {
        clearSensitiveFieldKeys();
        setCsrfToken(undefined);
      };
      window.addEventListener('edutex:session-expired', clearKeys);
      return /** Removes the session-expiry listener when the protected application unmounts. */ () => {
        window.removeEventListener('edutex:session-expired', clearKeys);
      };
    },
    [],
  );

  const value = useMemo<SessionContextValue | undefined>(
    /** Memoises the derived value used by `SessionProvider` until the declared React dependencies change. It uses only the local values shown in its body. */ () => {
      if (!session) return undefined;
      return {
        session,
        /** Implements `hasPermission` for implements a protected-portal trust helper for same-origin api access, navigation, session state or browser-side restricted-field encryption. It receives `permission`. Direct links: `session.user.permissions.includes`. */ hasPermission:
          (permission) =>
            session.user.permissions.includes(permission) ||
            session.user.permissions.includes((permission.split(':')[0] ?? '') + ':manage') ||
            session.user.permissions.includes('platform:manage'),
        /** Implements `isModuleEnabled` for implements a protected-portal trust helper for same-origin api access, navigation, session state or browser-side restricted-field encryption. It receives `module`. Direct links: `session.user.enabledModules.includes`. */ isModuleEnabled:
          (module) => session.user.enabledModules.includes(module),
        /** Implements `registerPasskey` for implements a protected-portal trust helper for same-origin api access, navigation, session state or browser-side restricted-field encryption. Direct links: `apiRequest`, `jsonBody`, `window.location.assign`. */ registerPasskey:
          async () => {
            const response = await apiRequest<{ redirectTo: string }>(
              '/api/v1/auth/passkeys/register',
              { method: 'POST', ...jsonBody({}) },
            );
            window.location.assign(response.redirectTo);
          },
        /** Implements `signOut` for implements a protected-portal trust helper for same-origin api access, navigation, session state or browser-side restricted-field encryption. Direct links: `clearSensitiveFieldKeys`, `apiRequest`, `jsonBody`, `setCsrfToken`, `window.location.replace`. */ signOut:
          async () => {
            clearSensitiveFieldKeys();
            const response = await apiRequest<{ redirectTo: string }>('/api/v1/auth/logout', {
              method: 'POST',
              ...jsonBody({}),
            });
            setCsrfToken(undefined);
            window.location.replace(response.redirectTo);
          },
      };
    },
    [session],
  );

  if (error) {
    return (
      <main className="boot-screen" role="alert">
        <img src="/app/edutex-logo.png" className="h-10 w-auto" alt="Edutex" />
        <h1>We couldn’t open your workspace</h1>
        <p>{error}</p>
        <a className="button-primary mt-4" href="/auth/">
          Return to sign in
        </a>
      </main>
    );
  }
  if (!value) {
    return (
      <main className="boot-screen" role="status">
        <img src="/app/edutex-logo.png" className="h-10 w-auto" alt="Edutex" />
        <span className="loading-line" aria-hidden="true" />
        <p>Opening your secure workspace…</p>
      </main>
    );
  }
  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}

/** Returns the loaded session; callers must be descendants of SessionProvider. */
export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider.');
  return value;
}

import { errorMessage } from '@edutex/contracts';
