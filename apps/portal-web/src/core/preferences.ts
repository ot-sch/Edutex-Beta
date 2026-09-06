/** @fileoverview Account-saved preferences; no school data or dashboard choices enter local browser storage. */
import { useCallback, useEffect, useState } from 'react';
import { apiRequest, jsonBody } from './api.js';
/** Loads and version-checks a preference namespace owned by the current authenticated account. */
export function usePreferences<T>(
  namespace: string,
  defaults: T,
): {
  value: T;
  setValue: React.Dispatch<React.SetStateAction<T>>;
  save: () => Promise<void>;
  loading: boolean;
  error: string;
  saving: boolean;
  saved: boolean;
} {
  const [value, setValue] = useState(defaults);
  const [rowVersion, setRowVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(
    /** Synchronises preferences with its dependencies and cleans up pending work when the view changes. */
    () => {
      const abort = new AbortController();
      void apiRequest<{ preferences: T | null; rowVersion: number }>(
        `/api/v1/preferences/${namespace}`,
        {},
        abort.signal,
      )
        .then(
          /** Applies the completed preferences result to the next step or current view state. */
          (data) => {
            setValue(data.preferences ?? defaults);
            setRowVersion(data.rowVersion);
          },
        )
        .catch(
          /** Reports preferences failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted)
              setError(
                reason instanceof Error ? errorMessage(reason) : 'Preferences could not be loaded.',
              );
          },
        )
        .finally(
          /** Clears preferences pending state after either success or failure so the next action is available. */
          () => {
            if (!abort.signal.aborted) setLoading(false);
          },
        );
      return /** Cancels the preferences request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [namespace, defaults],
  );
  const save = useCallback(
    /** Coordinates update Saving within preferences, preserving the caller's validation and error handling. */
    async () => {
      setSaving(true);
      setSaved(false);
      setError('');
      try {
        const result = await apiRequest<{ rowVersion: number }>(
          `/api/v1/preferences/${namespace}`,
          { method: 'PUT', ...jsonBody({ preferences: value, rowVersion }) },
        );
        setRowVersion(result.rowVersion);
        setSaved(true);
      } catch (reason) {
        setError(
          reason instanceof Error ? errorMessage(reason) : 'Preferences could not be saved.',
        );
        throw reason;
      } finally {
        setSaving(false);
      }
    },
    [namespace, value, rowVersion],
  );
  return { value, setValue, save, loading, error, saving, saved };
}

import { errorMessage } from '@edutex/contracts';
