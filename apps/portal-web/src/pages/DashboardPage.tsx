/** @fileoverview A readable school dashboard with per-account column choices and combined demographic filters. */
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ClipboardCheck,
  GraduationCap,
  UserRoundCheck,
  WalletCards,
  SlidersHorizontal,
} from 'lucide-react';
import { apiRequest } from '../core/api.js';
import { useSession } from '../core/session.js';
import { usePreferences } from '../core/preferences.js';
import { PageLoading, PageError } from '../components/PageStates.js';
import { RecordFields } from '../components/RecordFields.js';
const defaults = {
  filters: { campusIds: [] as string[], yearLevels: [] as string[], genders: [] as string[] },
  followUpColumn: 'movement',
  hiddenMetrics: [] as string[],
};
interface DashboardData {
  school: { name: string; timezone: string };
  today: string;
  metrics: Record<string, number | null>;
  attendanceTrend: { date: string; percentage: number | null }[];
  followUps: Record<string, string>[];
  activity: { occurredAt: string; action: string; resourceType: string; outcome: string }[];
}
const cards = [
  { key: 'activeStudents', label: 'Active students', icon: GraduationCap, colour: 'blue' },
  { key: 'activeStaff', label: 'Active staff', icon: UserRoundCheck, colour: 'violet' },
  { key: 'openAttendance', label: 'Open rolls', icon: ClipboardCheck, colour: 'amber' },
  { key: 'outstandingInvoices', label: 'Open invoices', icon: WalletCards, colour: 'emerald' },
] as const;
/** Presents only permitted metrics and persists customisation on the user's account. */
export function DashboardPage({
  navigate,
}: {
  readonly navigate: (path: string) => void;
}): React.JSX.Element {
  const { session, hasPermission } = useSession();
  const prefs = usePreferences('dashboard', defaults);
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [customise, setCustomise] = useState(false);
  useEffect(
    /** Synchronises Dashboard Page with its dependencies and cleans up pending work when the view changes. */
    () => {
      const abort = new AbortController();
      setError('');
      void apiRequest<DashboardData>('/api/v1/dashboard', {}, abort.signal)
        .then(setData)
        .catch(
          /** Reports Dashboard Page failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted)
              setError(
                reason instanceof Error
                  ? errorMessage(reason)
                  : 'The dashboard could not be opened.',
              );
          },
        );
      return /** Cancels the Dashboard Page request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [version],
  );
  if (error)
    return (
      <PageError
        message={error}
        retry={
          /** Handles Dashboard Page update Version state from the current control. */
          () => {
            setVersion(
              /** Coordinates Dashboard Page within Dashboard Page, preserving the caller's validation and error handling. */
              (v) => v + 1,
            );
          }
        }
      />
    );
  if (!data) return <PageLoading />;
  /** Coordinates save within Dashboard Page, preserving the caller's validation and error handling. */
  const save = async (): Promise<void> => {
    try {
      await prefs.save();
      setVersion(
        /** Coordinates Dashboard Page within Dashboard Page, preserving the caller's validation and error handling. */
        (v) => v + 1,
      );
      setCustomise(false);
    } catch {
      /* The preference editor displays the specific conflict or validation message. */
    }
  };
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">
            {data.school.name} · {data.today}
          </p>
          <h1>Welcome, {session.user.displayName.split(' ')[0]}</h1>
          <p>Your school day, at a glance.</p>
        </div>
        <button
          type="button"
          className="button-secondary"
          aria-expanded={customise}
          onClick={
            /** Handles Dashboard Page update Customise state from the current control. */
            () => {
              setCustomise(
                /** Coordinates Dashboard Page within Dashboard Page, preserving the caller's validation and error handling. */
                (v) => !v,
              );
            }
          }
        >
          <SlidersHorizontal size={16} />
          Personalise view
        </button>
      </div>
      {customise && (
        <article className="panel">
          <h2>Your dashboard preferences</h2>
          <p className="field-help mb-4">
            Saved to your account and available on your other devices. Staff counts use campus
            filters; year and gender filters apply to student records.
          </p>
          <RecordFields
            fields={[
              { key: 'yearLevels', label: 'Year levels', type: 'tags' },
              { key: 'genders', label: 'Gender values', type: 'tags' },
              {
                key: 'followUpColumn',
                label: 'Attendance follow-up column',
                type: 'select',
                options: ['movement', 'room', 'class', 'yearLevel'],
              },
            ]}
            values={{ ...prefs.value.filters, followUpColumn: prefs.value.followUpColumn }}
            onChange={
              /** Updates Dashboard Page scalar Text state from the current control. */
              (key, value) => {
                prefs.setValue(
                  /** Coordinates scalar Text within Dashboard Page, preserving the caller's validation and error handling. */
                  (current) =>
                    key === 'followUpColumn'
                      ? { ...current, followUpColumn: scalarText(value) }
                      : { ...current, filters: { ...current.filters, [key]: value } },
                );
              }
            }
          />
          <div className="filter-chips mt-4">
            {cards.map(
              /** Renders cards entries with their stable identifiers and visible labels. */
              (card) => (
                <label key={card.key}>
                  <input
                    type="checkbox"
                    checked={!prefs.value.hiddenMetrics.includes(card.key)}
                    onChange={
                      /** Updates Dashboard Page interaction state from the current control. */
                      (e) => {
                        prefs.setValue(
                          /** Coordinates Dashboard Page within Dashboard Page, preserving the caller's validation and error handling. */
                          (current) => ({
                            ...current,
                            hiddenMetrics: e.target.checked
                              ? current.hiddenMetrics.filter(
                                  /** Selects current.hidden Metrics entries using the explicit key card.key condition. */
                                  (key) => key !== card.key,
                                )
                              : [...current.hiddenMetrics, card.key],
                          }),
                        );
                      }
                    }
                  />
                  {card.label}
                </label>
              ),
            )}
          </div>
          {prefs.error && (
            <p role="alert" className="form-error">
              {prefs.error}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={
                /** Handles Dashboard Page interaction state from the current control. */
                () => {
                  prefs.setValue(defaults);
                }
              }
            >
              Reset preferences
            </button>
            <button
              type="button"
              className="button-primary"
              disabled={prefs.saving || prefs.loading}
              onClick={
                /** Handles Dashboard Page save state from the current control. */
                () => void save()
              }
            >
              {prefs.saving ? 'Saving…' : 'Save to my account'}
            </button>
          </div>
        </article>
      )}
      <div className="metric-grid">
        {cards
          .filter(
            /** Selects cards entries using the explicit prefs.value.hidden Metrics.includes card.key data.metrics card.key null condition. */
            (card) =>
              !prefs.value.hiddenMetrics.includes(card.key) && data.metrics[card.key] !== null,
          )
          .map(
            /** Renders cards.filter card prefs.value.hidden Metrics.includes card.key data.metrics card.key null entries with their stable identifiers and visible labels. */
            (card) => {
              const Icon = card.icon;
              return (
                <article className="metric-card" key={card.key}>
                  <span className={'metric-icon metric-icon-' + card.colour}>
                    <Icon size={21} />
                  </span>
                  <div>
                    <p>{card.label}</p>
                    <strong>{data.metrics[card.key]?.toLocaleString() ?? '—'}</strong>
                  </div>
                </article>
              );
            },
          )}
      </div>
      <div className="dashboard-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="panel-eyebrow">Submitted rolls · last 7 days</p>
              <h2>Attendance overview</h2>
            </div>
          </div>
          {data.attendanceTrend.length ? (
            <div className="bar-chart" aria-label="Daily attendance percentages">
              {data.attendanceTrend.map(
                /** Renders data.attendance Trend entries with their stable identifiers and visible labels. */
                (item) => (
                  <div className="bar-column" key={item.date}>
                    <div className="bar-value">{item.percentage ?? '—'}%</div>
                    <div className="bar-track">
                      <span
                        className={
                          'bar-height-' +
                          String(
                            Math.max(5, Math.min(100, Math.round((item.percentage ?? 0) / 5) * 5)),
                          )
                        }
                      />
                    </div>
                    <div className="bar-label">
                      {new Date(item.date + 'T12:00:00').toLocaleDateString([], {
                        weekday: 'short',
                      })}
                    </div>
                  </div>
                ),
              )}
            </div>
          ) : (
            <p className="chart-empty">No submitted rolls match this view.</p>
          )}
          {hasPermission('attendance:view') && (
            <button
              type="button"
              className="panel-link"
              onClick={
                /** Handles Dashboard Page navigate state from the current control. */
                () => {
                  navigate('attendance');
                }
              }
            >
              Open attendance
              <ArrowRight size={16} />
            </button>
          )}
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="panel-eyebrow">Today's priorities</p>
              <h2>Attendance follow-up</h2>
            </div>
            <span className="status-pill">{data.followUps.length} records</span>
          </div>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Attendance follow-up"
          >
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Session</th>
                  <th>
                    {prefs.value.followUpColumn === 'yearLevel'
                      ? 'Year'
                      : prefs.value.followUpColumn}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.followUps.map(
                  /** Renders data.follow Ups entries with their stable identifiers and visible labels. */
                  (row) => (
                    <tr key={row['id']}>
                      <td>{row['student']}</td>
                      <td>{row['session']}</td>
                      <td>{row[prefs.value.followUpColumn] ?? '—'}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          {!data.followUps.length && (
            <p className="chart-empty">No follow-ups in your permitted view.</p>
          )}
        </article>
      </div>
      {hasPermission('audit:view') && (
        <article className="panel">
          <div className="panel-heading">
            <h2>Recent activity</h2>
            <button
              type="button"
              className="text-action"
              onClick={
                /** Handles Dashboard Page navigate state from the current control. */
                () => {
                  navigate('audit');
                }
              }
            >
              View audit trail
            </button>
          </div>
          <div className="activity-list">
            {data.activity.map(
              /** Renders data.activity entries with their stable identifiers and visible labels. */
              (entry, index) => (
                <div className="activity-item" key={index}>
                  <span className="activity-dot activity-dot-success" />
                  <div>
                    <p>
                      <strong>{entry.action}</strong> · {entry.resourceType.replaceAll('_', ' ')}
                    </p>
                    <span>{new Date(entry.occurredAt).toLocaleString()}</span>
                  </div>
                </div>
              ),
            )}
          </div>
        </article>
      )}
    </section>
  );
}

import { errorMessage, scalarText } from '@edutex/contracts';
