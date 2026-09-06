/**
 * @fileoverview Implements the protected AuditPage React feature, linking session-authorised UI state to same-origin Edutex API contracts.
 *
 * @remarks
 * Direct links: `lucide-react`, `react`, `../components/PageStates.js`, `../core/api.js`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { ChevronLeft, ChevronRight, Search, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState, PageError, PageLoading } from '../components/PageStates.js';
import { apiRequest } from '../core/api.js';

interface AuditResponse {
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly items: readonly {
    readonly id: string;
    readonly occurredAt: string;
    readonly actorUserId: string | null;
    readonly action: string;
    readonly resourceType: string;
    readonly resourceId: string | null;
    readonly requestId: string | null;
    readonly outcome: string;
    readonly eventHash: string;
  }[];
}

/** Displays the append-only, hash-chained tenant audit trail without sensitive diffs. */
export function AuditPage(): React.JSX.Element {
  const [data, setData] = useState<AuditResponse>();
  const [page, setPage] = useState(1);
  const [resourceType, setResourceType] = useState('');
  const [applied, setApplied] = useState('');
  const [error, setError] = useState<string>();
  const load = useCallback(
    /** Keeps the `AuditPage` callback identity stable for React effects/children while still using the declared dependencies. It receives `signal`. Direct links: `setError`, `String`, `query.set`, `apiRequest<AuditResponse>('/api/v1/audit/even`, `apiRequest`. */ (
      signal?: AbortSignal,
    ) => {
      setError(undefined);
      const query = new URLSearchParams({ page: String(page), pageSize: '50' });
      if (applied) query.set('resourceType', applied);
      void apiRequest<AuditResponse>(`/api/v1/audit/events?${query.toString()}`, {}, signal)
        .then(setData)
        .catch(
          /** Performs the local `apiRequest<AuditResponse>('/api/v1/audit/events?${query.toSt` operation inside `AuditPage` and returns control to the surrounding feature only after this body completes. It receives `reason`. Direct links: `setError`. */ (
            reason: unknown,
          ) => {
            if (!signal?.aborted)
              setError(
                reason instanceof Error
                  ? errorMessage(reason)
                  : 'The audit trail could not be loaded.',
              );
          },
        );
    },
    [applied, page],
  );
  useEffect(
    /** Synchronises `AuditPage` with browser/API state after the declared React dependencies change and returns any required cleanup. Direct links: `load`. */ () => {
      const controller = new AbortController();
      load(controller.signal);
      return /** Performs the local `callback` operation inside `AuditPage` and returns control to the surrounding feature only after this body completes. Direct links: `controller.abort`. */ () => {
        controller.abort();
      };
    },
    [load],
  );

  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Governance</p>
          <h1>Audit trail</h1>
          <p>Immutable, tenant-scoped evidence of security and business events.</p>
        </div>
        <span className="secure-badge large">
          <ShieldCheck size={16} /> Hash chained
        </span>
      </div>
      <div className="data-card">
        <form
          className="table-toolbar"
          onSubmit={
            /** Handles the React `onSubmit` event inside `AuditPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `event.preventDefault`, `setApplied`, `setPage`. */ (
              event,
            ) => {
              event.preventDefault();
              setApplied(resourceType);
              setPage(1);
            }
          }
        >
          <label className="table-search">
            <Search size={17} />
            <input
              value={resourceType}
              onChange={
                /** Handles the React `onChange` event inside `AuditPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setResourceType`. */ (
                  event,
                ) => {
                  setResourceType(event.target.value);
                }
              }
              placeholder="Filter by resource type…"
            />
          </label>
          <button className="button-secondary" type="submit">
            Apply filter
          </button>
        </form>
        {!data && !error ? (
          <PageLoading />
        ) : error ? (
          <PageError
            message={error}
            retry={
              /** Handles the React `retry` event inside `AuditPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `load`. */ () => {
                load();
              }
            }
          />
        ) : data?.items.length === 0 ? (
          <EmptyState
            title="No audit events found"
            detail="Change the filter or return after activity has occurred."
          />
        ) : (
          <div className="audit-list">
            {data?.items.map(
              /** Transforms each input item for `AuditPage` into the derived value or React element consumed by the surrounding collection. It receives `event`. Direct links: `event.action.replaceAll`, `event.resourceType.replaceAll`, `new Date(event.occurredAt).toLocaleString`, `event.eventHash.slice`. */ (
                event,
              ) => (
                <article className="audit-event" key={event.id}>
                  <span
                    className={
                      event.outcome === 'success'
                        ? 'audit-symbol audit-symbol-success'
                        : 'audit-symbol'
                    }
                  >
                    <ShieldCheck size={17} />
                  </span>
                  <div className="min-w-0">
                    <p>
                      <strong>{event.action.replaceAll('_', ' ')}</strong>
                      <span>{event.resourceType.replaceAll('_', ' ')}</span>
                    </p>
                    <small>
                      {new Date(event.occurredAt).toLocaleString([], {
                        dateStyle: 'medium',
                        timeStyle: 'medium',
                      })}{' '}
                      · Request {event.requestId ?? 'not recorded'}
                    </small>
                    <code title={event.eventHash}>{event.eventHash.slice(0, 18)}…</code>
                  </div>
                  <span className={`status-pill status-${event.outcome}`}>{event.outcome}</span>
                </article>
              ),
            )}
          </div>
        )}
        {data && data.total > 0 ? (
          <div className="pagination">
            <p>
              {data.total.toLocaleString()} events · Page {page}
            </p>
            <div>
              <button
                type="button"
                className="pagination-button"
                disabled={page === 1}
                onClick={
                  /** Handles the React `onClick` event inside `AuditPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setPage`. */ () => {
                    setPage(
                      /** Derives the next immutable React state for `AuditPage` from the previous value supplied by the state setter. It receives `value`. It uses only the local values shown in its body. */ (
                        value,
                      ) => value - 1,
                    );
                  }
                }
              >
                <ChevronLeft size={17} /> Previous
              </button>
              <button
                type="button"
                className="pagination-button"
                disabled={page * data.pageSize >= data.total}
                onClick={
                  /** Handles the React `onClick` event inside `AuditPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setPage`. */ () => {
                    setPage(
                      /** Derives the next immutable React state for `AuditPage` from the previous value supplied by the state setter. It receives `value`. It uses only the local values shown in its body. */ (
                        value,
                      ) => value + 1,
                    );
                  }
                }
              >
                Next <ChevronRight size={17} />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

import { errorMessage } from '@edutex/contracts';
