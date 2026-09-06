/**
 * @fileoverview Implements the protected AttendancePage React feature, linking session-authorised UI state to same-origin Edutex API contracts.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `lucide-react`, `react`, `../components/PageStates.js`, `../core/api.js`, `../core/session.js`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { resourceListResponseSchema, type ResourceRecord } from '@edutex/contracts';
import { Check, CheckCircle2, ChevronRight, Clock3, Save } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState, PageError, PageLoading } from '../components/PageStates.js';
import { apiRequest, jsonBody } from '../core/api.js';
import { useSession } from '../core/session.js';

interface RollResponse {
  readonly session: {
    readonly id: string;
    readonly date: string;
    readonly label: string;
    readonly status: string;
    readonly rowVersion: number;
  };
  readonly students: readonly {
    readonly id: string;
    readonly studentNumber: string;
    readonly displayName: string;
    readonly mark: {
      readonly status: string;
      readonly minutesLate: number | null;
      readonly comment: string;
      readonly rowVersion: number;
    } | null;
  }[];
}

/** Provides an optimistic-lock-aware classroom roll workflow. */
export function AttendancePage(): React.JSX.Element {
  const { hasPermission } = useSession();
  const [sessions, setSessions] = useState<readonly ResourceRecord[]>();
  const [selected, setSelected] = useState<string>();
  const [roll, setRoll] = useState<RollResponse>();
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(
    /** Synchronises `AttendancePage` with browser/API state after the declared React dependencies change and returns any required cleanup. Direct links: `apiRequest<unknown>( '/api/v1/resources/atten`, `apiRequest`. */ () => {
      const controller = new AbortController();
      const query = new URLSearchParams({
        page: '1',
        pageSize: '50',
        sort: 'sessionDate',
        direction: 'desc',
      });
      void apiRequest<unknown>(
        `/api/v1/resources/attendance-sessions?${query}`,
        {},
        controller.signal,
      )
        .then(
          /** Performs the local `apiRequest<unknown>( '/api/v1/resources/attendance-sessions?` operation inside `AttendancePage` and returns control to the surrounding feature only after this body completes. It receives `value`. Direct links: `setSessions`, `resourceListResponseSchema.parse`. */ (
            value,
          ) => {
            setSessions(resourceListResponseSchema.parse(value).items);
          },
        )
        .catch(
          /** Performs the local `apiRequest<unknown>( '/api/v1/resources/attendance-sessions?` operation inside `AttendancePage` and returns control to the surrounding feature only after this body completes. It receives `reason`. Direct links: `setError`. */ (
            reason: unknown,
          ) => {
            if (!controller.signal.aborted)
              setError(
                reason instanceof Error ? errorMessage(reason) : 'Attendance could not be loaded.',
              );
          },
        );
      return /** Performs the local `callback` operation inside `AttendancePage` and returns control to the surrounding feature only after this body completes. Direct links: `controller.abort`. */ () => {
        controller.abort();
      };
    },
    [version],
  );

  const loadRoll = useCallback(
    /** Keeps the `AttendancePage` callback identity stable for React effects/children while still using the declared dependencies. It receives `sessionId`. Direct links: `setSelected`, `setRoll`, `setError`, `apiRequest<RollResponse>('/api/v1/attendance/`, `apiRequest`. */ (
      sessionId: string,
    ) => {
      setSelected(sessionId);
      setRoll(undefined);
      setError(undefined);
      void apiRequest<RollResponse>(`/api/v1/attendance/sessions/${sessionId}/roll`)
        .then(
          /** Performs the local `apiRequest<RollResponse>('/api/v1/attendance/sessions/${sess` operation inside `AttendancePage` and returns control to the surrounding feature only after this body completes. It receives `value`. Direct links: `setRoll`, `setMarks`, `Object.fromEntries`, `value.students.map`. */ (
            value,
          ) => {
            setRoll(value);
            setMarks(
              Object.fromEntries(
                value.students.map(
                  /** Transforms each input item for `AttendancePage` into the derived value or React element consumed by the surrounding collection. It receives `student`. It uses only the local values shown in its body. */ (
                    student,
                  ) => [student.id, student.mark?.status ?? 'present'],
                ),
              ),
            );
          },
        )
        .catch(
          /** Performs the local `apiRequest<RollResponse>('/api/v1/attendance/sessions/${sess` operation inside `AttendancePage` and returns control to the surrounding feature only after this body completes. It receives `reason`. Direct links: `setError`. */ (
            reason: unknown,
          ) => {
            setError(
              reason instanceof Error ? errorMessage(reason) : 'The roll could not be loaded.',
            );
          },
        );
    },
    [],
  );

  /** Saves the current roll with per-mark versions and returns the new session version on success. */
  const save = async (): Promise<number | undefined> => {
    if (!roll) return undefined;
    setSaving(true);
    setError(undefined);
    try {
      const response = await apiRequest<{ rowVersion: number }>(
        `/api/v1/attendance/sessions/${roll.session.id}/marks`,
        {
          method: 'PUT',
          ...jsonBody({
            marks: roll.students.map(
              /** Transforms each input item for `save` into the derived value or React element consumed by the surrounding collection. It receives `student`. It uses only the local values shown in its body. */ (
                student,
              ) => ({
                studentId: student.id,
                status: marks[student.id] ?? 'unknown',
                minutesLate: marks[student.id] === 'late' ? 1 : null,
                comment: student.mark?.comment ?? '',
                rowVersion: student.mark?.rowVersion ?? null,
              }),
            ),
          }),
        },
      );
      loadRoll(roll.session.id);
      return response.rowVersion;
    } catch (reason) {
      setError(reason instanceof Error ? errorMessage(reason) : 'Marks could not be saved.');
      return undefined;
    } finally {
      setSaving(false);
    }
  };

  /** Persists outstanding marks, then closes the attendance session with optimistic concurrency. */
  const submit = async (): Promise<void> => {
    if (!roll) return;
    setSaving(true);
    setError(undefined);
    try {
      const rowVersion = await save();
      if (rowVersion === undefined) return;
      await apiRequest(`/api/v1/attendance/sessions/${roll.session.id}/submit`, {
        method: 'POST',
        ...jsonBody({ rowVersion }),
      });
      setSelected(undefined);
      setRoll(undefined);
      setVersion(
        /** Derives the next immutable React state for `submit` from the previous value supplied by the state setter. It receives `value`. It uses only the local values shown in its body. */ (
          value,
        ) => value + 1,
      );
    } catch (reason) {
      setError(reason instanceof Error ? errorMessage(reason) : 'The roll could not be submitted.');
    } finally {
      setSaving(false);
    }
  };

  if (!sessions && !error) return <PageLoading />;
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Learning & wellbeing</p>
          <h1>Attendance</h1>
          <p>Fast, reliable rolls with a complete change history.</p>
        </div>
      </div>
      {error ? (
        <PageError
          message={error}
          retry={
            /** Handles the React `retry` event inside `AttendancePage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setVersion`. */ () => {
              setVersion(
                /** Derives the next immutable React state for `AttendancePage` from the previous value supplied by the state setter. It receives `value`. It uses only the local values shown in its body. */ (
                  value,
                ) => value + 1,
              );
            }
          }
        />
      ) : null}
      <div className="attendance-layout">
        <aside className="roll-list panel">
          <div className="panel-heading">
            <div>
              <p className="panel-eyebrow">Sessions</p>
              <h2>Recent rolls</h2>
            </div>
            <Clock3 size={20} className="text-slate-400" />
          </div>
          {!sessions?.length ? (
            <EmptyState
              title="No rolls available"
              detail="Create an attendance session from your class schedule."
            />
          ) : (
            sessions.map(
              /** Transforms each input item for `AttendancePage` into the derived value or React element consumed by the surrounding collection. It receives `session`. Direct links: `String`, `new Date(String(session.fields['sessionDate']`. */ (
                session,
              ) => (
                <button
                  className={
                    selected === session.id
                      ? 'roll-list-item roll-list-item-active'
                      : 'roll-list-item'
                  }
                  key={session.id}
                  type="button"
                  onClick={
                    /** Handles the React `onClick` event inside `AttendancePage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `loadRoll`. */ () => {
                      loadRoll(session.id);
                    }
                  }
                >
                  <span>
                    <strong>{String(session.fields['sessionLabel'])}</strong>
                    <small>
                      {new Date(String(session.fields['sessionDate'])).toLocaleDateString([], {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </small>
                  </span>
                  <span className={`status-pill status-${String(session.fields['status'])}`}>
                    {String(session.fields['status'])}
                  </span>
                  <ChevronRight size={17} />
                </button>
              ),
            )
          )}
        </aside>
        <article className="panel roll-workspace">
          {!selected ? (
            <EmptyState title="Choose a roll" detail="Select a session to mark attendance." />
          ) : !roll ? (
            <PageLoading />
          ) : (
            <>
              <div className="panel-heading roll-heading">
                <div>
                  <p className="panel-eyebrow">
                    {new Date(`${roll.session.date}T00:00:00`).toLocaleDateString([], {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </p>
                  <h2>{roll.session.label}</h2>
                </div>
                <span className={`status-pill status-${roll.session.status}`}>
                  {roll.session.status}
                </span>
              </div>
              <div className="roll-students">
                {roll.students.map(
                  /** Transforms each input item for `AttendancePage` into the derived value or React element consumed by the surrounding collection. It receives `student`. Direct links: `student.displayName .split(/\s+/) .map((part)`, `student.displayName .split(/\s+/) .map`, `student.displayName .split`, `['present', 'late', 'absent', 'excused'].map`. */ (
                    student,
                  ) => (
                    <div className="student-mark" key={student.id}>
                      <span className="student-avatar">
                        {student.displayName
                          .split(/\s+/)
                          .map(
                            /** Transforms each input item for `AttendancePage` into the derived value or React element consumed by the surrounding collection. It receives `part`. It uses only the local values shown in its body. */ (
                              part,
                            ) => part[0],
                          )
                          .slice(0, 2)
                          .join('')}
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong>{student.displayName}</strong>
                        <small>{student.studentNumber}</small>
                      </span>
                      <div
                        className="mark-options"
                        role="group"
                        aria-label={`Attendance for ${student.displayName}`}
                      >
                        {['present', 'late', 'absent', 'excused'].map(
                          /** Transforms each input item for `AttendancePage` into the derived value or React element consumed by the surrounding collection. It receives `status`. It uses only the local values shown in its body. */ (
                            status,
                          ) => (
                            <button
                              key={status}
                              type="button"
                              className={
                                marks[student.id] === status
                                  ? `mark-${status} mark-selected`
                                  : `mark-${status}`
                              }
                              onClick={
                                /** Handles the React `onClick` event inside `AttendancePage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setMarks`. */ () => {
                                  setMarks(
                                    /** Derives the next immutable React state for `AttendancePage` from the previous value supplied by the state setter. It receives `current`. It uses only the local values shown in its body. */ (
                                      current,
                                    ) => ({ ...current, [student.id]: status }),
                                  );
                                }
                              }
                            >
                              {marks[student.id] === status ? <Check size={14} /> : null}
                              <span>{status}</span>
                            </button>
                          ),
                        )}
                      </div>
                    </div>
                  ),
                )}
              </div>
              {hasPermission('attendance:edit') &&
              ['planned', 'open', 'reopened'].includes(roll.session.status) ? (
                <div className="roll-actions">
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={
                      /** Handles the React `onClick` event inside `AttendancePage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `save`. */ () =>
                        void save()
                    }
                    disabled={saving}
                  >
                    <Save size={16} /> Save draft
                  </button>
                  {hasPermission('attendance:approve') ? (
                    <button
                      className="button-primary"
                      type="button"
                      onClick={
                        /** Handles the React `onClick` event inside `AttendancePage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `submit`. */ () =>
                          void submit()
                      }
                      disabled={saving}
                    >
                      <CheckCircle2 size={16} /> Submit roll
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </article>
      </div>
    </section>
  );
}

import { errorMessage } from '@edutex/contracts';
