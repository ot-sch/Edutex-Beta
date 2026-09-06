/**
 * @fileoverview Implements the public authentication-only React bundle that discovers tenant login methods and begins server-owned OAuth/passkey flows.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `lucide-react`, `react`, `./auth-api.js`, `/auth/edutex-logo.png`.
 * Security: Authentication/session security boundary; changes require negative tests for replay, binding, MFA and unauthenticated access.
 */

import type { AuthenticationMethod, PublicTenantConfiguration } from '@edutex/contracts';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  LifeBuoy,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { beginAuthentication, loadTenantConfiguration } from './auth-api.js';

/** Chooses the single local sign-in action that accurately reflects the school's enabled factors. */
function localSignInChoice(tenant: PublicTenantConfiguration):
  | {
      readonly key: AuthenticationMethod;
      readonly label: string;
      readonly detail: string;
    }
  | undefined {
  const passkey = tenant.enabledMethods.includes('passkey');
  const password = tenant.enabledMethods.includes('password');
  if (passkey && password) {
    return {
      key: 'passkey',
      label: 'Continue securely',
      detail: 'Use a passkey or your school password',
    };
  }
  if (passkey) {
    return {
      key: 'passkey',
      label: 'Continue with a passkey',
      detail: 'Fast, phishing-resistant sign in',
    };
  }
  if (password) {
    return {
      key: 'password',
      label: 'Username or email',
      detail: 'Password and any required authenticator verification',
    };
  }
  return undefined;
}

/** Renders a method-aware sign-in action without handling credentials in Edutex. */
function SignInButton(props: {
  readonly method: string;
  readonly label: string;
  readonly detail?: string;
  readonly emphasis?: boolean;
}): React.JSX.Element {
  const Icon =
    props.method === 'passkey' ? Fingerprint : props.method === 'password' ? KeyRound : Building2;
  return (
    <button
      className={
        props.emphasis
          ? 'signin-button signin-button-primary'
          : 'signin-button signin-button-secondary'
      }
      onClick={
        /** Handles the React `onClick` event inside `SignInButton`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `beginAuthentication`. */ () => {
          beginAuthentication(props.method);
        }
      }
      type="button"
    >
      <span className="button-icon" aria-hidden="true">
        <Icon size={21} strokeWidth={1.9} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[0.94rem] font-semibold">{props.label}</span>
        {props.detail ? (
          <span className="mt-0.5 block text-xs opacity-70">{props.detail}</span>
        ) : null}
      </span>
      <ArrowRight className="shrink-0 opacity-60" size={18} aria-hidden="true" />
    </button>
  );
}

/** Provides a minimal public shell while the hostname-specific policy loads. */
export function App(): React.JSX.Element {
  const [tenant, setTenant] = useState<PublicTenantConfiguration>();
  const [error, setError] = useState<string>();

  useEffect(
    /** Synchronises `App` with browser/API state after the declared React dependencies change and returns any required cleanup. Direct links: `loadTenantConfiguration(controller.signal) .t`, `loadTenantConfiguration`. */ () => {
      const controller = new AbortController();
      void loadTenantConfiguration(controller.signal)
        .then(setTenant)
        .catch(
          /** Derives the next immutable React state for `App` from the previous value supplied by the state setter. It receives `reason`. Direct links: `setError`. */ (
            reason: unknown,
          ) => {
            if (!controller.signal.aborted) {
              setError(
                reason instanceof Error ? reason.message : 'Sign in is temporarily unavailable.',
              );
            }
          },
        );
      return /** Performs the local `callback` operation inside `App` and returns control to the surrounding feature only after this body completes. Direct links: `controller.abort`. */ () => {
        controller.abort();
      };
    },
    [],
  );
  const localChoice = tenant ? localSignInChoice(tenant) : undefined;

  return (
    <main className="auth-canvas">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <section className="auth-layout" aria-label="Edutex sign in">
        <aside className="brand-panel">
          <div className="brand-mark">
            <img src="/auth/edutex-logo.png" alt="Edutex" className="h-11 w-auto" />
          </div>
          <div className="brand-copy">
            <p className="eyebrow">School operations, beautifully connected</p>
            <h1>One calm place for every school day.</h1>
            <p>
              Securely bring attendance, learning, people and school operations together without
              losing sight of what matters.
            </p>
          </div>
          <div className="trust-list" aria-label="Platform protections">
            <span>
              <ShieldCheck size={17} /> Protected at the edge
            </span>
            <span>
              <LockKeyhole size={17} /> Encrypted in transit and at rest
            </span>
            <span>
              <CheckCircle2 size={17} /> School-managed access
            </span>
          </div>
        </aside>

        <div className="signin-panel">
          {!tenant && !error ? (
            <div className="loading-state" role="status">
              <LoaderCircle className="animate-spin text-brand-600" size={28} />
              <p className="font-semibold text-slate-900">Preparing secure sign in</p>
              <p className="text-sm text-slate-500">Checking your school’s access policy…</p>
            </div>
          ) : null}

          {error ? (
            <div className="error-state" role="alert">
              <div className="error-icon">
                <LockKeyhole size={24} />
              </div>
              <h2>Sign in unavailable</h2>
              <p>{error}</p>
              <button
                type="button"
                className="retry-button"
                onClick={
                  /** Handles the React `onClick` event inside `App`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `window.location.reload`. */ () => {
                    window.location.reload();
                  }
                }
              >
                Try again
              </button>
            </div>
          ) : null}

          {tenant ? (
            <div className="w-full">
              <div className="school-heading">
                <div className="school-logo">
                  {tenant.logoUrl ? <img src={tenant.logoUrl} alt="" /> : <Building2 size={26} />}
                </div>
                <div>
                  <p className="text-sm font-medium text-brand-700">Welcome to</p>
                  <h2>{tenant.name}</h2>
                </div>
              </div>
              {tenant.maintenanceMessage ? (
                <div className="maintenance-note" role="status">
                  {tenant.maintenanceMessage}
                </div>
              ) : null}

              <div className="method-stack">
                {localChoice ? (
                  <SignInButton
                    method={localChoice.key}
                    label={localChoice.label}
                    detail={localChoice.detail}
                    emphasis
                  />
                ) : null}
              </div>

              {tenant.providers.length > 0 ? (
                <>
                  <div className="divider">
                    <span>or use your school account</span>
                  </div>
                  <div className="method-stack">
                    {tenant.providers
                      .filter(
                        /** Keeps only input items that satisfy this predicate before `App` continues its lookup, render or request construction. It receives `provider`. It uses only the local values shown in its body. */ (
                          provider,
                        ) => provider.enabled,
                      )
                      .map(
                        /** Performs the local `tenant.providers .filter((provider) => provider.enabled) .ma` operation inside `App` and returns control to the surrounding feature only after this body completes. It receives `provider`. It uses only the local values shown in its body. */ (
                          provider,
                        ) => (
                          <SignInButton
                            key={provider.id}
                            method={provider.key}
                            label={provider.buttonLabel}
                          />
                        ),
                      )}
                  </div>
                </>
              ) : null}

              <p className="security-note">
                <ShieldCheck size={15} aria-hidden="true" /> Your school controls which account and
                verification methods are accepted.
              </p>
              {tenant.supportUrl ? (
                <a className="support-link" href={tenant.supportUrl} rel="noreferrer">
                  <LifeBuoy size={16} /> Need help signing in?
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
      <footer>© {new Date().getFullYear()} Edutex · Authorised users only</footer>
    </main>
  );
}
