/**
 * @fileoverview Implements the reusable protected-portal StudentSensitiveFields component used by one or more authenticated pages.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `lucide-react`, `react`, `../core/api.js`, `../core/field-encryption.js`, `../core/session.js`, `/api/v1/auth/start?`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { encryptedFieldEnvelopeSchema } from '@edutex/contracts';
import { Eye, EyeOff, LockKeyhole, Save, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiRequestError, apiRequest, jsonBody } from '../core/api.js';
import {
  clearSensitiveFieldKeys,
  decryptSensitiveField,
  encryptSensitiveField,
} from '../core/field-encryption.js';
import { useSession } from '../core/session.js';

interface StoredField {
  readonly fieldKey: string;
  readonly rowVersion: number;
  readonly envelope: unknown;
}

const fieldDefinitions = [
  { key: 'learning-adjustments', label: 'Learning adjustments' },
  { key: 'health-notes', label: 'Health notes' },
  { key: 'safeguarding-notes', label: 'Safeguarding notes' },
] as const;

/** Re-checks live page visibility after asynchronous cryptographic work without stale type narrowing. */
function sensitiveViewHidden(): boolean {
  return document.hidden;
}

/**
 * Keeps decrypted student notes in component memory only. The save path encrypts
 * in the browser before the API request body is created.
 */
export function StudentSensitiveFields(props: { readonly studentId: string }): React.JSX.Element {
  const { session, hasPermission } = useSession();
  const [values, setValues] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [stepUpUrl, setStepUpUrl] = useState<string>();
  const canEdit = hasPermission('students:sensitive-edit');

  const generation = useRef(0);
  /** Clears decrypted fields and invalidates pending cryptographic work. */
  const lock = useCallback(
    /** Retains no visible note or cached key after a view lock. */
    (): void => {
      generation.current += 1;
      clearSensitiveFieldKeys();
      setValues({});
      setVersions({});
      setUnlocked(false);
      setBusy(false);
    },
    [],
  );
  useEffect(
    /** Locks restricted notes on page hiding, sign-out and record teardown. */
    () => {
      /** Clears the hidden view before it can be restored. */
      const hidden = (): void => {
        if (sensitiveViewHidden()) lock();
      };
      document.addEventListener('visibilitychange', hidden);
      window.addEventListener('pagehide', lock);
      window.addEventListener('edutex:session-expired', lock);
      return /** Removes the view listeners and invalidates pending unlocks. */ () => {
        document.removeEventListener('visibilitychange', hidden);
        window.removeEventListener('pagehide', lock);
        window.removeEventListener('edutex:session-expired', lock);
        lock();
      };
    },
    [props.studentId, lock],
  );
  useEffect(
    /** Requires fresh access after five minutes of restricted-note viewing. */
    () => {
      if (!unlocked) return;
      const timer = window.setTimeout(lock, 5 * 60_000);
      return /** Cancels the previous view deadline when the fields lock. */ () => {
        window.clearTimeout(timer);
      };
    },
    [unlocked, lock],
  );

  /** Requests a recent-assurance key, decrypts authorised fields in memory, and exposes step-up when required. */
  const unlock = async (): Promise<void> => {
    const ticket = ++generation.current;
    setBusy(true);
    setError(undefined);
    setStepUpUrl(undefined);
    setMessage(undefined);
    try {
      const response = await apiRequest<{ fields: readonly StoredField[] }>(
        `/api/v1/students/${props.studentId}/sensitive`,
      );
      if (ticket !== generation.current || sensitiveViewHidden()) return;
      const decrypted: Record<string, string> = {};
      const currentVersions: Record<string, number> = {};
      for (const field of response.fields) {
        const envelope = encryptedFieldEnvelopeSchema.parse(field.envelope);
        decrypted[field.fieldKey] = await decryptSensitiveField({
          tenantId: session.user.tenantId,
          studentId: props.studentId,
          fieldKey: field.fieldKey,
          envelope,
        });
        currentVersions[field.fieldKey] = field.rowVersion;
      }
      if (ticket !== generation.current || sensitiveViewHidden()) return;
      setValues(decrypted);
      setVersions(currentVersions);
      setUnlocked(true);
    } catch (reason) {
      if (ticket !== generation.current) return;
      if (reason instanceof ApiRequestError && reason.response.code === 'STEP_UP_REQUIRED') {
        const candidate = reason.response.details?.['stepUpUrl'];
        if (typeof candidate === 'string' && candidate.startsWith('/api/v1/auth/start?')) {
          setStepUpUrl(candidate);
        }
      }
      setError(
        reason instanceof Error ? errorMessage(reason) : 'Sensitive fields could not be unlocked.',
      );
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  };

  /** Encrypts every editable restricted field before issuing optimistic, field-scoped API mutations. */
  const save = async (): Promise<void> => {
    if (!unlocked || !canEdit || busy || sensitiveViewHidden()) return;
    const ticket = generation.current;
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      for (const definition of fieldDefinitions) {
        const envelope = await encryptSensitiveField({
          tenantId: session.user.tenantId,
          studentId: props.studentId,
          fieldKey: definition.key,
          plaintext: values[definition.key] ?? '',
        });
        if (ticket !== generation.current || sensitiveViewHidden()) return;
        const response = await apiRequest<{ rowVersion: number }>(
          `/api/v1/students/${props.studentId}/sensitive/${definition.key}`,
          {
            method: 'PUT',
            ...jsonBody({
              ...envelope,
              ...(versions[definition.key] === undefined
                ? {}
                : { rowVersion: versions[definition.key] }),
            }),
          },
        );
        if (ticket !== generation.current) return;
        setVersions(
          /** Derives the next immutable React state for `save` from the previous value supplied by the state setter. It receives `current`. It uses only the local values shown in its body. */ (
            current,
          ) => ({ ...current, [definition.key]: response.rowVersion }),
        );
      }
      setMessage('Sensitive fields encrypted and saved.');
    } catch (reason) {
      if (ticket !== generation.current) return;
      setError(
        reason instanceof Error ? errorMessage(reason) : 'Sensitive fields could not be saved.',
      );
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  };

  return (
    <section className="sensitive-section">
      <div className="sensitive-heading">
        <span className="sensitive-icon">
          <LockKeyhole size={18} />
        </span>
        <div>
          <strong>Client-encrypted fields</strong>
          <p>
            Notes are encrypted before sending and lock when you leave the page or after five
            minutes.
          </p>
        </div>
      </div>
      {!unlocked ? (
        <button
          className="button-secondary"
          type="button"
          onClick={
            /** Handles the React `onClick` event inside `StudentSensitiveFields`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `unlock`. */ () =>
              void unlock()
          }
          disabled={busy}
        >
          <Eye size={16} /> {busy ? 'Verifying…' : 'Unlock with recent MFA'}
        </button>
      ) : (
        <>
          <div className="grid gap-3">
            {fieldDefinitions.map(
              /** Transforms each input item for `StudentSensitiveFields` into the derived value or React element consumed by the surrounding collection. It receives `definition`. It uses only the local values shown in its body. */ (
                definition,
              ) => (
                <label className="field" key={definition.key}>
                  <span>
                    {definition.label}
                    <em>Encrypted</em>
                  </span>
                  <textarea
                    rows={3}
                    value={values[definition.key] ?? ''}
                    disabled={!canEdit || busy}
                    onChange={
                      /** Handles the React `onChange` event inside `StudentSensitiveFields`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setValues`. */ (
                        event,
                      ) => {
                        setValues(
                          /** Derives the next immutable React state for `StudentSensitiveFields` from the previous value supplied by the state setter. It receives `current`. It uses only the local values shown in its body. */ (
                            current,
                          ) => ({ ...current, [definition.key]: event.target.value }),
                        );
                      }
                    }
                  />
                </label>
              ),
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="button-secondary"
              type="button"
              onClick={
                /** Handles the React `onClick` event inside `StudentSensitiveFields`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setUnlocked`, `setValues`. */ () => {
                  lock();
                }
              }
            >
              <EyeOff size={16} /> Lock fields
            </button>
            {canEdit ? (
              <button
                className="button-primary"
                type="button"
                onClick={
                  /** Handles the React `onClick` event inside `StudentSensitiveFields`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `save`. */ () =>
                    void save()
                }
                disabled={busy}
              >
                <Save size={16} /> {busy ? 'Encrypting…' : 'Encrypt & save'}
              </button>
            ) : null}
          </div>
        </>
      )}
      {error ? (
        <div className="form-error" role="alert">
          {error}
          {stepUpUrl ? (
            <a className="ml-2 font-semibold underline" href={stepUpUrl}>
              Verify now
            </a>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <div className="success-message" role="status">
          <ShieldCheck size={16} /> {message}
        </div>
      ) : null}
    </section>
  );
}

import { errorMessage } from '@edutex/contracts';
