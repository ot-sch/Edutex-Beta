/** @fileoverview Online medical editing decrypts only the selected child's scoped envelope in browser memory. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EncryptedFieldEnvelope } from '@edutex/contracts';
import { apiRequest, jsonBody } from '../core/api.js';
import {
  encryptSensitiveField,
  decryptSensitiveField,
  clearSensitiveFieldKeys,
} from '../core/field-encryption.js';
import { useSession } from '../core/session.js';
/** Re-reads visibility after asynchronous key operations; browser state may change during any await. */
function medicalViewHidden(): boolean {
  return document.hidden;
}

/** Locks clinical text when the page is hidden and requires a fresh authorised read to reopen it. */
export function MedicalRecord({ studentId }: { readonly studentId: string }): React.JSX.Element {
  const { session } = useSession();
  const [text, setText] = useState('');
  const [version, setVersion] = useState(0);
  const [canEdit, setCanEdit] = useState(false);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const pending = useRef<AbortController | undefined>(undefined);
  /** Invalidates pending work before clearing visible clinical data and in-memory keys. */
  const lock = useCallback(
    /** Cancels pending reads and wipes the visible record before releasing cached keys. */
    (): void => {
      generation.current += 1;
      pending.current?.abort();
      pending.current = undefined;
      setText('');
      setVersion(0);
      setCanEdit(false);
      setOpened(false);
      setBusy(false);
      clearSensitiveFieldKeys();
    },
    [],
  );
  useEffect(
    /** Locks the view on hidden-page, session-expiry and page-lifecycle events. */
    () => {
      /** Clears the clinical view before a hidden page can be shown again. */
      const hidden = (): void => {
        if (medicalViewHidden()) lock();
      };
      document.addEventListener('visibilitychange', hidden);
      window.addEventListener('pagehide', lock);
      window.addEventListener('edutex:session-expired', lock);
      return /** Removes listeners and invalidates late work when the selected record is left. */ () => {
        document.removeEventListener('visibilitychange', hidden);
        window.removeEventListener('pagehide', lock);
        window.removeEventListener('edutex:session-expired', lock);
        lock();
      };
    },
    [studentId, lock],
  );
  useEffect(
    /** Bounds the visible record lifetime independently of key caching and network activity. */
    () => {
      if (!opened) return;
      const timer = window.setTimeout(
        /** Requires a fresh server access check after the one-minute viewing window. */
        () => {
          lock();
          setMessage(
            'The one-minute viewing window ended. Open the record again to check current access.',
          );
        },
        60_000,
      );
      return /** Cancels the previous window when the record locks or the component closes. */ () => {
        window.clearTimeout(timer);
      };
    },
    [opened, lock],
  );
  /** Coordinates open within Medical Record, preserving the caller's validation and error handling. */
  const open = async (): Promise<void> => {
    const ticket = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const result = await apiRequest<{
        record: { envelope: EncryptedFieldEnvelope; row_version: number } | null;
        canEdit: boolean;
      }>(`/api/v1/medical/${studentId}`, {}, controller.signal);
      if (ticket !== generation.current || medicalViewHidden()) return;
      const plaintext = result.record
        ? await decryptSensitiveField({
            tenantId: session.user.tenantId,
            studentId,
            medicalStudentId: studentId,
            fieldKey: 'medical-record',
            envelope: result.record.envelope,
          })
        : '';
      if (ticket !== generation.current || medicalViewHidden()) return;
      setCanEdit(result.canEdit);
      setVersion(result.record?.row_version ?? 0);
      setText(plaintext);
      setOpened(true);
    } catch (error) {
      if (ticket !== generation.current) return;
      setText('');
      setOpened(false);
      setMessage(error instanceof Error ? error.message : 'Medical records are unavailable.');
    } finally {
      if (ticket === generation.current) {
        pending.current = undefined;
        setBusy(false);
      }
    }
  };
  /** Coordinates save within Medical Record, preserving the caller's validation and error handling. */
  const save = async (): Promise<void> => {
    if (!opened || !canEdit || busy || medicalViewHidden()) return;
    const ticket = generation.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const envelope = await encryptSensitiveField({
        tenantId: session.user.tenantId,
        studentId,
        medicalStudentId: studentId,
        fieldKey: 'medical-record',
        plaintext: text,
      });
      if (ticket !== generation.current || medicalViewHidden()) return;
      const result = await apiRequest<{ rowVersion: number }>(
        `/api/v1/medical/${studentId}`,
        {
          method: 'PUT',
          ...jsonBody({ envelope, rowVersion: version }),
        },
        controller.signal,
      );
      if (ticket !== generation.current) return;
      setVersion(result.rowVersion);
      setMessage('Medical information saved securely.');
    } catch (error) {
      if (ticket !== generation.current) return;
      setMessage(
        error instanceof Error ? error.message : 'Medical information could not be saved.',
      );
    } finally {
      if (ticket === generation.current) {
        pending.current = undefined;
        setBusy(false);
      }
    }
  };
  return (
    <section className="data-card medical-card">
      <h2>Medical information</h2>
      <p className="field-help">
        Allergies, medication, care plans and emergency instructions. Available online to authorised
        carers; the record locks when you leave this screen or after one minute. Save edits before
        it locks.
      </p>
      {opened ? (
        <>
          <label className="field">
            Care information
            <textarea
              rows={8}
              value={text}
              disabled={!canEdit || busy}
              onChange={
                /** Updates Medical Record update Text state from the current control. */
                (event) => {
                  setText(event.target.value);
                }
              }
            />
          </label>
          <div className="heading-actions">
            {canEdit && (
              <button
                type="button"
                className="button-primary"
                disabled={busy}
                onClick={
                  /** Handles Medical Record save state from the current control. */
                  () => void save()
                }
              >
                Save medical information
              </button>
            )}
            <button
              type="button"
              className="button-secondary"
              onClick={
                /** Handles Medical Record update Opened state from the current control. */
                () => {
                  lock();
                }
              }
            >
              Lock record
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={
            /** Handles Medical Record open state from the current control. */
            () => void open()
          }
        >
          {busy ? 'Opening…' : 'Open medical information'}
        </button>
      )}
      {message && (
        <p role="status" className="form-notice">
          {message}
        </p>
      )}
    </section>
  );
}
