/** @fileoverview Dedicated ICT console is a separate browser bundle with server-enforced technician authorization. */
import { FailureBoundary } from '../../portal-web/src/components/FailureBoundary.js';
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { SessionProvider, useSession } from '../../portal-web/src/core/session.js';
import { apiRequest, jsonBody } from '../../portal-web/src/core/api.js';
import { AppearanceControl, AppearanceProvider } from '../../portal-web/src/core/appearance.js';
import '../../portal-web/src/styles.css';
interface Status {
  version: string;
  time: string;
  uptimeSeconds: number;
  memoryMiB: number;
  database: { status: string; latencyMs: number };
  school: { name: string; timezone: string; locale: string };
  alerts: { enabled: number; queued: number; failed: number };
  settings: { timezone: string; locale: string; rowVersion: number };
}
/** Shows measured service health and tightly bounded school-wide technical settings. */
function TechnicianApp(): React.JSX.Element {
  const { session, hasPermission, signOut } = useSession();
  const [status, setStatus] = useState<Status>();
  const [error, setError] = useState('');
  const [timezone, setTimezone] = useState('');
  const [locale, setLocale] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(
    /** Synchronises main with its dependencies and cleans up pending work when the view changes. */
    () => {
      const abort = new AbortController();
      void apiRequest<Status>('/api/v1/technician/status', {}, abort.signal)
        .then(
          /** Applies the completed main result to the next step or current view state. */
          (result) => {
            setStatus(result);
            setTimezone(result.settings.timezone);
            setLocale(result.settings.locale);
          },
        )
        .catch(
          /** Reports main failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted) setError(errorMessage(reason));
          },
        );
      return /** Cancels the main request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [refresh],
  );
  return (
    <main className="page-stack technician-main">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Edutex · ICT administration</p>
          <h1>Technician console</h1>
          <p>{session.user.displayName}</p>
        </div>
        <div className="heading-actions">
          <a className="button-secondary" href="/app/">
            School workspace
          </a>
          <button
            className="button-secondary"
            type="button"
            onClick={
              /** Handles main sign Out state from the current control. */
              () =>
                void signOut().catch(
                  /** Surfaces main failures through the existing error handler without silently succeeding. */
                  (reason: unknown) => {
                    setError(errorMessage(reason));
                  },
                )
            }
          >
            Sign out
          </button>
        </div>
      </div>
      <AppearanceControl />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <>
          <div className="portal-grid">
            <article className="data-card portal-card">
              <h2>Application</h2>
              <p>Version {status.version}</p>
              <p>Uptime {Math.round(status.uptimeSeconds / 60)} minutes</p>
              <p>Process memory {status.memoryMiB} MiB</p>
            </article>
            <article className="data-card portal-card">
              <h2>Database</h2>
              <p>{status.database.status}</p>
              <p>Measured query time {status.database.latencyMs} ms</p>
            </article>
            <article className="data-card portal-card">
              <h2>Alert processing</h2>
              <p>{status.alerts.enabled} enabled rules</p>
              <p>{status.alerts.queued} queued deliveries</p>
              <p>{status.alerts.failed} blocked or failed deliveries</p>
            </article>
            <article className="data-card portal-card">
              <h2>School settings</h2>
              <p>{status.school.name}</p>
              <p>{status.school.timezone}</p>
              <p>{status.school.locale}</p>
            </article>
          </div>
          <p className="field-help">
            Measured {new Date(status.time).toLocaleString()}. AWS and Cloudflare infrastructure
            changes use the reviewed deployment plan.
          </p>
          <button
            className="button-secondary"
            type="button"
            onClick={
              /** Handles main update Refresh state from the current control. */
              () => {
                setRefresh(
                  /** Coordinates main within main, preserving the caller's validation and error handling. */
                  (value) => value + 1,
                );
              }
            }
          >
            Refresh measured status
          </button>
          {hasPermission('technician:manage') && (
            <form
              className="data-card portal-card"
              onSubmit={
                /** Validates and submits main update Busy state from the current control. */
                (event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError('');
                  void apiRequest('/api/v1/technician/settings', {
                    method: 'PATCH',
                    ...jsonBody({ timezone, locale, rowVersion: status.settings.rowVersion }),
                  })
                    .then(
                      /** Applies the completed main result to the next step or current view state. */
                      () => {
                        setRefresh(
                          /** Coordinates main within main, preserving the caller's validation and error handling. */
                          (value) => value + 1,
                        );
                      },
                    )
                    .catch(
                      /** Surfaces main failures through the existing error handler without silently succeeding. */
                      (reason: unknown) => {
                        setError(errorMessage(reason));
                      },
                    )
                    .finally(
                      /** Clears main pending state after either success or failure so the next action is available. */
                      () => {
                        setBusy(false);
                      },
                    );
                }
              }
            >
              <h2>Regional configuration</h2>
              <p>
                Changing the school timezone changes day boundaries for attendance, alerts and
                scheduled medical access. Existing recorded timestamps remain absolute.
              </p>
              <div className="form-grid">
                <label className="field">
                  IANA timezone
                  <input
                    value={timezone}
                    onChange={
                      /** Updates main update Timezone state from the current control. */
                      (event) => {
                        setTimezone(event.target.value);
                      }
                    }
                    required
                    placeholder="Australia/Melbourne"
                  />
                </label>
                <label className="field">
                  Language and region
                  <input
                    value={locale}
                    onChange={
                      /** Updates main update Locale state from the current control. */
                      (event) => {
                        setLocale(event.target.value);
                      }
                    }
                    required
                    placeholder="en-AU"
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button className="button-primary" disabled={busy}>
                  Save regional configuration
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </main>
  );
}
const root = document.querySelector('#root');
if (!root) throw new Error('Technician mount point is missing.');
createRoot(root).render(
  <SessionProvider>
    <AppearanceProvider>
      <FailureBoundary>
        <TechnicianApp />
      </FailureBoundary>
    </AppearanceProvider>
  </SessionProvider>,
);

import { errorMessage } from '@edutex/contracts';
