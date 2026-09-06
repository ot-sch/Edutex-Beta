/** @fileoverview Reviewable financial reports from the server's fixed report catalogue. */
import { useEffect, useState } from 'react';
import { apiRequest, jsonBody } from '../core/api.js';
import { useSession } from '../core/session.js';
interface Report {
  title: string;
  items: Record<string, unknown>[];
  truncated: boolean;
  generatedAt: string;
}
/** Keeps reporting periods explicit and exposes source-data limitations instead of inventing results. */
export function FinanceReports(): React.JSX.Element {
  const { hasPermission } = useSession();
  const [catalogue, setCatalogue] = useState<{ key: string; label: string }[]>([]);
  const [kind, setKind] = useState('trial-balance');
  const [start, setStart] = useState(String(new Date().getFullYear()) + '-01-01');
  const [end, setEnd] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(
    /** Synchronises Finance Reports with its dependencies and cleans up pending work when the view changes. */
    () => {
      const abort = new AbortController();
      void apiRequest<{ reports: typeof catalogue }>('/api/v1/finance/reports', {}, abort.signal)
        .then(
          /** Applies the completed Finance Reports result to the next step or current view state. */
          (data) => {
            setCatalogue(data.reports);
          },
        )
        .catch(
          /** Reports Finance Reports failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted)
              setError(
                reason instanceof Error ? errorMessage(reason) : 'Reports could not be loaded.',
              );
          },
        );
      return /** Cancels the Finance Reports request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [],
  );
  /** Coordinates run within Finance Reports, preserving the caller's validation and error handling. */
  const run = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      setReport(
        await apiRequest<Report>(
          `/api/v1/finance/reports/${kind}?${new URLSearchParams({ start, end })}`,
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? errorMessage(reason) : 'The report could not be generated.',
      );
    } finally {
      setBusy(false);
    }
  };
  /** Coordinates gl within Finance Reports, preserving the caller's validation and error handling. */
  const gl = async (): Promise<void> => {
    try {
      await apiRequest('/api/v1/finance/gl-template', {
        method: 'POST',
        ...jsonBody({ template: 'australian-school' }),
      });
      setKind('chart-of-accounts');
      setError('');
    } catch (reason) {
      setError(
        reason instanceof Error ? errorMessage(reason) : 'The GL template could not be added.',
      );
    }
  };
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Finance</p>
          <h1>Reports & analysis</h1>
          <p>Check periods, source completeness and accounting treatment before publishing.</p>
        </div>
        {hasPermission('finance:manage') && (
          <button
            type="button"
            className="button-secondary"
            onClick={
              /** Handles Finance Reports gl state from the current control. */
              () => void gl()
            }
          >
            Add school GL template
          </button>
        )}
      </div>
      <article className="panel">
        <div className="inline-fields">
          <label className="field">
            Report
            <select
              value={kind}
              onChange={
                /** Updates Finance Reports update Kind state from the current control. */
                (e) => {
                  setKind(e.target.value);
                }
              }
            >
              {catalogue.map(
                /** Renders catalogue entries with their stable identifiers and visible labels. */
                (item) => (
                  <option value={item.key} key={item.key}>
                    {item.label}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="field">
            From
            <input
              type="date"
              value={start}
              onChange={
                /** Updates Finance Reports update Start state from the current control. */
                (e) => {
                  setStart(e.target.value);
                }
              }
            />
          </label>
          <label className="field">
            To
            <input
              type="date"
              value={end}
              onChange={
                /** Updates Finance Reports update End state from the current control. */
                (e) => {
                  setEnd(e.target.value);
                }
              }
            />
          </label>
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={
              /** Handles Finance Reports run state from the current control. */
              () => void run()
            }
          >
            {busy ? 'Generating…' : 'Generate report'}
          </button>
        </div>
      </article>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>{report.title}</h2>
              <p className="field-help">
                {start} to {end} · Generated {new Date(report.generatedAt).toLocaleString()}
              </p>
            </div>
            {hasPermission('finance:export') && (
              <button
                type="button"
                className="button-secondary"
                onClick={
                  /** Handles Finance Reports interaction state from the current control. */
                  () => {
                    window.print();
                  }
                }
              >
                Print report
              </button>
            )}
          </div>
          {report.truncated && (
            <p role="alert" className="form-error">
              More than 10,000 rows match. Narrow the date range for a complete report.
            </p>
          )}
          <div className="table-scroll" tabIndex={0} role="region" aria-label={report.title}>
            <table>
              <thead>
                <tr>
                  {Object.keys(report.items[0] ?? {}).map(
                    /** Renders Object.keys report.items 0 entries with their stable identifiers and visible labels. */
                    (key) => (
                      <th key={key}>{key.replaceAll('_', ' ')}</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {report.items.map(
                  /** Renders report.items entries with their stable identifiers and visible labels. */
                  (row, index) => (
                    <tr key={index}>
                      {Object.entries(row).map(
                        /** Renders Object.entries row entries with their stable identifiers and visible labels. */
                        ([key, value]) => (
                          <td key={key}>{value === null ? '—' : scalarText(value)}</td>
                        ),
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          {!report.items.length && <p className="chart-empty">No source records in this period.</p>}
        </article>
      )}
    </section>
  );
}

import { errorMessage, scalarText } from '@edutex/contracts';
