/** @fileoverview Recipient-owned dashboard notifications with explicit read acknowledgement. */
import { useEffect, useState } from 'react';
import { apiRequest, jsonBody } from '../core/api.js';
import { Modal } from './Modal.js';
/** Loads current notifications when the user opens the bell menu. */
export function Notifications({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [items, setItems] = useState<
    { id: string; title: string; detail: string; read_at: string | null; created_at: string }[]
  >([]);
  const [error, setError] = useState('');
  useEffect(
    /** Synchronises Notifications with its dependencies and cleans up pending work when the view changes. */
    () => {
      const abort = new AbortController();
      void apiRequest<{ items: typeof items }>('/api/v1/notifications', {}, abort.signal)
        .then(
          /** Applies the completed Notifications result to the next step or current view state. */
          (data) => {
            setItems(data.items);
          },
        )
        .catch(
          /** Reports Notifications failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted)
              setError(
                reason instanceof Error
                  ? errorMessage(reason)
                  : 'Notifications could not be loaded.',
              );
          },
        );
      return /** Cancels the Notifications request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [],
  );
  /** Coordinates mark within Notifications, preserving the caller's validation and error handling. */
  const mark = async (id: string): Promise<void> => {
    try {
      await apiRequest(`/api/v1/notifications/${id}/read`, { method: 'POST', ...jsonBody({}) });
      setItems(
        /** Coordinates Notifications within Notifications, preserving the caller's validation and error handling. */
        (current) =>
          current.map(
            /** Transforms current entries into the Notifications output representation. */
            (item) => (item.id === id ? { ...item, read_at: new Date().toISOString() } : item),
          ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? errorMessage(reason) : 'Could not acknowledge this notification.',
      );
    }
  };
  return (
    <Modal title="Notifications" onClose={onClose}>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {items.length ? (
        items.map(
          /** Renders items entries with their stable identifiers and visible labels. */
          (item) => (
            <article className="notification-item" key={item.id}>
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
              <small>{new Date(item.created_at).toLocaleString()}</small>
              {!item.read_at && (
                <button
                  type="button"
                  className="text-action"
                  onClick={
                    /** Handles Notifications mark state from the current control. */
                    () => void mark(item.id)
                  }
                >
                  Mark as read
                </button>
              )}
            </article>
          ),
        )
      ) : (
        <p className="chart-empty">No notifications to show.</p>
      )}
    </Modal>
  );
}

import { errorMessage } from '@edutex/contracts';
