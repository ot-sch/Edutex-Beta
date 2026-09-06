/** @fileoverview Parent and student workspaces expose only verified relationships and published learning records. */
import { useEffect, useState } from 'react';
import { apiRequest, jsonBody } from '../core/api.js';
import { useSession } from '../core/session.js';
import { Modal } from '../components/Modal.js';
import { MedicalRecord } from '../components/MedicalRecord.js';
interface Child {
  id: string;
  first_name: string;
  last_name: string;
  year_level: string;
}
interface Contact {
  role: string;
  display_name: string;
  email: string | null;
  phone: string | null;
}
type Row = Record<string, string | number | null>;
interface Details {
  timetable: Row[];
  grades: Row[];
  dates: Row[];
  events: Row[];
  fees: Row[];
  materials: Row[];
  assignments: Row[];
}
/** Renders parallel school records as scrollable, labelled tables with plain-language empty states. */
function PortalTable({
  rows,
  columns,
}: {
  rows: Row[];
  columns: readonly (readonly [string, string])[];
}): React.JSX.Element {
  return rows.length ? (
    <div className="table-scroll" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {columns.map(
              /** Renders columns entries with their stable identifiers and visible labels. */
              ([key, label]) => (
                <th key={key}>{label}</th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(
            /** Renders rows entries with their stable identifiers and visible labels. */
            (row, index) => (
              <tr key={String(row['id'] ?? index)}>
                {columns.map(
                  /** Renders columns entries with their stable identifiers and visible labels. */
                  ([key]) => (
                    <td key={key}>
                      {key === 'weekday'
                        ? ([
                            'Monday',
                            'Tuesday',
                            'Wednesday',
                            'Thursday',
                            'Friday',
                            'Saturday',
                            'Sunday',
                          ][Number(row[key]) - 1] ?? '—')
                        : String(row[key] ?? '—')}
                    </td>
                  ),
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="empty-inline">Nothing published here yet.</p>
  );
}
/** Keeps community navigation and mutations tied to the currently selected verified child. */
export function CommunityPortal(): React.JSX.Element {
  const { session } = useSession();
  const parent = session.user.category === 'parent_guardian';
  const [children, setChildren] = useState<Child[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState('');
  const [details, setDetails] = useState<Details>();
  const [tab, setTab] = useState('timetable');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [absence, setAbsence] = useState(false);
  const [assignment, setAssignment] = useState<Row>();
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [contact, setContact] = useState<Row>();
  useEffect(
    /** Synchronises Community Portal with its dependencies and cleans up pending work when the view changes. */
    () => {
      const abort = new AbortController();
      void apiRequest<{ children: Child[]; contacts: Contact[] }>(
        '/api/v1/portal/children',
        {},
        abort.signal,
      )
        .then(
          /** Applies the completed Community Portal result to the next step or current view state. */
          (result) => {
            setChildren(result.children);
            setContacts(result.contacts);
            setSelected(result.children[0]?.id ?? '');
          },
        )
        .catch(
          /** Reports Community Portal failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted) setError(errorMessage(reason));
          },
        );
      return /** Cancels the Community Portal request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [],
  );
  useEffect(
    /** Synchronises Community Portal with its dependencies and cleans up pending work when the view changes. */
    () => {
      if (!selected) return;
      const abort = new AbortController();
      setDetails(undefined);
      void apiRequest<Details>(`/api/v1/portal/students/${selected}`, {}, abort.signal)
        .then(setDetails)
        .catch(
          /** Reports Community Portal failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted) setError(errorMessage(reason));
          },
        );
      return /** Cancels the Community Portal request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [selected, refresh],
  );
  /** Coordinates mutate within Community Portal, preserving the caller's validation and error handling. */
  const mutate = async (path: string, body: unknown): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      await apiRequest(path, { method: 'POST', ...jsonBody(body) });
      setAbsence(false);
      setAssignment(undefined);
      setContent('');
      setRefresh(
        /** Coordinates Community Portal within Community Portal, preserving the caller's validation and error handling. */
        (value) => value + 1,
      );
    } catch (reason) {
      setError(reason instanceof Error ? errorMessage(reason) : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const tabs = parent
    ? ['timetable', 'grades', 'events', 'fees', 'medical', 'dates', 'contacts', 'forms', 'messages']
    : ['timetable', 'grades', 'assignments', 'materials', 'dates', 'contacts', 'forms', 'messages'];
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">{parent ? 'Family workspace' : 'Learning workspace'}</p>
          <h1>{parent ? 'Parent portal' : 'Student portal'}</h1>
          <p>School information and tasks for {parent ? 'your family' : 'you'}.</p>
        </div>
        {parent && (
          <div className="heading-actions">
            <button
              className="button-primary"
              type="button"
              disabled={!selected}
              onClick={
                /** Handles Community Portal update Absence state from the current control. */
                () => {
                  setAbsence(true);
                }
              }
            >
              Submit an absence
            </button>
            <button
              className="button-secondary"
              type="button"
              onClick={
                /** Handles Community Portal api Request state from the current control. */
                () => {
                  void apiRequest<Row | null>('/api/v1/portal/contact')
                    .then(
                      /** Applies the completed Community Portal result to the next step or current view state. */
                      (value) => {
                        if (value) setContact(value);
                        else setError('A guardian contact record must be linked by the school.');
                      },
                    )
                    .catch(
                      /** Surfaces Community Portal failures through the existing error handler without silently succeeding. */
                      (reason: unknown) => {
                        setError(errorMessage(reason));
                      },
                    );
                }
              }
            >
              Update my contact details
            </button>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <label className="field child-picker">
        {parent ? 'Child' : 'Student'}
        <select
          value={selected}
          onChange={
            /** Updates Community Portal update Selected state from the current control. */
            (event) => {
              setSelected(event.target.value);
              setError('');
            }
          }
        >
          {children.map(
            /** Renders children entries with their stable identifiers and visible labels. */
            (child) => (
              <option key={child.id} value={child.id}>
                {child.first_name} {child.last_name} · Year {child.year_level}
              </option>
            ),
          )}
        </select>
      </label>
      {!children.length && (
        <p className="form-notice">
          Ask the school to link your account to the correct student record.
        </p>
      )}
      <nav className="section-tabs" aria-label="Portal sections">
        {tabs.map(
          /** Renders tabs entries with their stable identifiers and visible labels. */
          (item) => (
            <button
              type="button"
              key={item}
              aria-current={tab === item ? 'page' : undefined}
              onClick={
                /** Handles Community Portal update Tab state from the current control. */
                () => {
                  setTab(item);
                }
              }
            >
              {item.slice(0, 1).toUpperCase() + item.slice(1)}
            </button>
          ),
        )}
      </nav>
      {selected && tab === 'medical' && <MedicalRecord key={selected} studentId={selected} />}
      {tab === 'contacts' && (
        <div className="portal-grid">
          {contacts.map(
            /** Renders contacts entries with their stable identifiers and visible labels. */
            (item, index) => (
              <article className="data-card portal-card" key={index}>
                <p className="page-eyebrow">{item.role.replaceAll('_', ' ')}</p>
                <h2>{item.display_name}</h2>
                {item.email && <a href={'mailto:' + item.email}>{item.email}</a>}
                {item.phone && <a href={'tel:' + item.phone}>{item.phone}</a>}
              </article>
            ),
          )}
          {!contacts.length && <p>School contacts have not been published.</p>}
        </div>
      )}
      {selected && tab === 'forms' && <PortalForms key={selected} studentId={selected} />}{' '}
      {tab === 'messages' && <PortalMessages />}
      {details && (
        <>
          {tab === 'timetable' && (
            <div className="data-card">
              <PortalTable
                rows={details.timetable}
                columns={[
                  ['weekday', 'Day'],
                  ['starts_at', 'Start'],
                  ['ends_at', 'End'],
                  ['class', 'Class'],
                  ['room', 'Room'],
                ]}
              />
            </div>
          )}
          {tab === 'grades' && (
            <div className="data-card">
              <PortalTable
                rows={details.grades}
                columns={[
                  ['title', 'Assessment'],
                  ['score', 'Score'],
                  ['grade_code', 'Grade'],
                  ['feedback', 'Feedback'],
                ]}
              />
            </div>
          )}
          {tab === 'dates' && (
            <div className="data-card">
              <PortalTable
                rows={details.dates}
                columns={[
                  ['title', 'Date / activity'],
                  ['starts_on', 'From'],
                  ['ends_on', 'Until'],
                  ['action', 'Classes'],
                ]}
              />
            </div>
          )}
          {tab === 'fees' && (
            <div className="data-card portal-card">
              <h2>Your allocated fees</h2>
              <PortalTable
                rows={details.fees}
                columns={[
                  ['invoice_number', 'Invoice'],
                  ['due_date', 'Due'],
                  ['total', 'Your share'],
                  ['paid', 'Your payments'],
                  ['balance_due', 'Your balance'],
                  ['currency_code', 'Currency'],
                  ['status', 'Status'],
                ]}
              />
              <p className="field-help">
                For payment, use the verified instructions on your school invoice or contact the
                school finance team. Edutex does not collect card details.
              </p>
            </div>
          )}
          {tab === 'events' && (
            <div className="portal-grid">
              {details.events.map(
                /** Renders details.events entries with their stable identifiers and visible labels. */
                (event) => (
                  <article className="data-card portal-card" key={String(event['id'])}>
                    <h2>{event['title']}</h2>
                    <p>{event['location']}</p>
                    <p>{event['starts_at']}</p>
                    <p>Consent: {event['consent_status']}</p>
                    <div className="heading-actions">
                      {['granted', 'declined', 'withdrawn'].map(
                        /** Renders granted declined withdrawn entries with their stable identifiers and visible labels. */
                        (decision) => (
                          <button
                            type="button"
                            className="button-secondary"
                            disabled={busy}
                            key={decision}
                            onClick={
                              /** Handles Community Portal mutate state from the current control. */
                              () =>
                                void mutate('/api/v1/portal/consent', {
                                  studentId: selected,
                                  eventId: event['id'],
                                  decision,
                                })
                            }
                          >
                            {decision === 'granted'
                              ? 'Give consent'
                              : decision === 'declined'
                                ? 'Decline'
                                : 'Withdraw consent'}
                          </button>
                        ),
                      )}
                    </div>
                  </article>
                ),
              )}
              {!details.events.length && <p>No published event invitations.</p>}
            </div>
          )}
          {tab === 'materials' && (
            <div className="portal-grid">
              {details.materials.map(
                /** Renders details.materials entries with their stable identifiers and visible labels. */
                (item) => (
                  <article className="data-card portal-card" key={String(item['id'])}>
                    <h2>{item['title']}</h2>
                    <p>{item['description']}</p>
                    <div className="preserve-text">{item['content']}</div>
                    <small>
                      {item['language']} · {item['licence']}
                    </small>
                  </article>
                ),
              )}
              {!details.materials.length && <p>No course materials published.</p>}
            </div>
          )}
          {tab === 'assignments' && (
            <div className="portal-grid">
              {details.assignments.map(
                /** Renders details.assignments entries with their stable identifiers and visible labels. */
                (item) => (
                  <article className="data-card portal-card" key={String(item['id'])}>
                    <h2>{item['title']}</h2>
                    <p className="preserve-text">{item['instructions']}</p>
                    <p>Due {item['due_at']}</p>
                    {item['submitted_at'] ? (
                      <p>Submitted {item['submitted_at']}</p>
                    ) : (
                      <button
                        className="button-primary"
                        type="button"
                        onClick={
                          /** Handles Community Portal update Assignment state from the current control. */
                          () => {
                            setAssignment(item);
                          }
                        }
                      >
                        Submit assignment
                      </button>
                    )}
                  </article>
                ),
              )}
              {!details.assignments.length && <p>No assignments published.</p>}
            </div>
          )}
        </>
      )}
      {absence && (
        <Modal
          title="Submit an absence"
          onClose={
            /** Handles Community Portal update Absence state from the current control. */
            () => {
              setAbsence(false);
            }
          }
        >
          <form
            onSubmit={
              /** Validates and submits Community Portal mutate state from the current control. */
              (event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void mutate('/api/v1/portal/absences', {
                  studentId: selected,
                  requestType: data.get('type'),
                  effectiveAt: new Date(scalarText(data.get('when'))).toISOString(),
                  reason: data.get('reason'),
                });
              }
            }
          >
            <label className="field">
              Type
              <select name="type">
                <option value="absence">All day absence</option>
                <option value="late_arrival">Late arrival</option>
                <option value="early_departure">Leave early</option>
              </select>
            </label>
            <label className="field">
              Date and time in your device time zone
              <input name="when" type="datetime-local" required />
            </label>
            <label className="field">
              Reason
              <textarea name="reason" required minLength={3} maxLength={2000} />
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="modal-actions">
              <button className="button-primary" disabled={busy}>
                Submit to school
              </button>
            </div>
          </form>
        </Modal>
      )}
      {assignment && (
        <Modal
          title={'Submit ' + scalarText(assignment['title'])}
          onClose={
            /** Handles Community Portal update Assignment state from the current control. */
            () => {
              setAssignment(undefined);
            }
          }
        >
          <form
            onSubmit={
              /** Validates and submits Community Portal mutate state from the current control. */
              (event) => {
                event.preventDefault();
                void mutate(`/api/v1/portal/assignments/${assignment['id']}`, {
                  studentId: selected,
                  content,
                });
              }
            }
          >
            <label className="field">
              Your response
              <textarea
                required
                maxLength={100000}
                rows={10}
                value={content}
                onChange={
                  /** Updates Community Portal update Content state from the current control. */
                  (event) => {
                    setContent(event.target.value);
                  }
                }
              />
            </label>
            <p className="field-help">
              Check your response before submitting. Contact your teacher if a submitted response
              needs correction.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="modal-actions">
              <button className="button-primary" disabled={busy}>
                Submit response
              </button>
            </div>
          </form>
        </Modal>
      )}
      {contact && (
        <Modal
          title="My contact details"
          onClose={
            /** Handles Community Portal update Contact state from the current control. */
            () => {
              setContact(undefined);
            }
          }
        >
          <form
            onSubmit={
              /** Validates and submits Community Portal update Busy state from the current control. */
              (event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                setBusy(true);
                void apiRequest('/api/v1/portal/contact', {
                  method: 'PATCH',
                  ...jsonBody({
                    rowVersion: Number(contact['row_version']),
                    contactEmail: data.get('email'),
                    mobilePhone: data.get('phone'),
                    postalAddress: data.get('address'),
                  }),
                })
                  .then(
                    /** Applies the completed Community Portal result to the next step or current view state. */
                    () => {
                      setContact(undefined);
                    },
                  )
                  .catch(
                    /** Surfaces Community Portal failures through the existing error handler without silently succeeding. */
                    (reason: unknown) => {
                      setError(errorMessage(reason));
                    },
                  )
                  .finally(
                    /** Clears Community Portal pending state after either success or failure so the next action is available. */
                    () => {
                      setBusy(false);
                    },
                  );
              }
            }
          >
            <p>Your sign-in email is managed separately by the school.</p>
            <label className="field">
              Contact email
              <input
                name="email"
                type="email"
                required
                defaultValue={String(contact['contact_email'] ?? '')}
              />
            </label>
            <label className="field">
              Phone
              <input
                name="phone"
                type="tel"
                required
                defaultValue={String(contact['mobile_phone'] ?? '')}
              />
            </label>
            <label className="field">
              Address
              <textarea
                name="address"
                required
                defaultValue={String(contact['postal_address'] ?? '')}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <div className="modal-actions">
              <button className="button-primary" disabled={busy}>
                Save my details
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
interface SchoolForm {
  id: string;
  title: string;
  description: string;
  definition: {
    questions?: {
      key: string;
      label: string;
      required?: boolean;
      type?: string;
      options?: string[];
    }[];
  };
}
/** Renders supported published forms and submits named answers through the school's review queue. */
function PortalForms({ studentId }: { studentId: string }): React.JSX.Element {
  const [forms, setForms] = useState<SchoolForm[]>([]);
  const [selected, setSelected] = useState<SchoolForm>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(
    /** Synchronises Community Portal with its dependencies and cleans up pending work when the view changes. */
    () => {
      const abort = new AbortController();
      void apiRequest<{ items: SchoolForm[] }>('/api/v1/portal/forms', {}, abort.signal)
        .then(
          /** Applies the completed Community Portal result to the next step or current view state. */
          (value) => {
            setForms(value.items);
          },
        )
        .catch(
          /** Reports Community Portal failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted) setMessage(errorMessage(reason));
          },
        );
      return /** Cancels the Community Portal request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [],
  );
  return (
    <div className="portal-grid">
      {forms.map(
        /** Renders forms entries with their stable identifiers and visible labels. */
        (form) => (
          <article key={form.id} className="data-card portal-card">
            <h2>{form.title}</h2>
            <p>{form.description}</p>
            <button
              className="button-primary"
              onClick={
                /** Handles Community Portal update Selected state from the current control. */
                () => {
                  setSelected(form);
                  setMessage('');
                }
              }
              type="button"
            >
              Complete form
            </button>
          </article>
        ),
      )}
      {!forms.length && <p>No forms available.</p>}
      {message && <p role="status">{message}</p>}
      {selected && (
        <Modal
          title={selected.title}
          onClose={
            /** Handles Community Portal update Selected state from the current control. */
            () => {
              setSelected(undefined);
            }
          }
        >
          <form
            onSubmit={
              /** Validates and submits Community Portal update Busy state from the current control. */
              (event) => {
                event.preventDefault();
                const values = Object.fromEntries(new FormData(event.currentTarget));
                setBusy(true);
                void apiRequest(`/api/v1/portal/forms/${selected.id}`, {
                  method: 'POST',
                  ...jsonBody({ studentId, answers: values }),
                })
                  .then(
                    /** Applies the completed Community Portal result to the next step or current view state. */
                    () => {
                      setSelected(undefined);
                      setMessage('Form submitted for school review.');
                    },
                  )
                  .catch(
                    /** Surfaces Community Portal failures through the existing error handler without silently succeeding. */
                    (reason: unknown) => {
                      setMessage(errorMessage(reason));
                    },
                  )
                  .finally(
                    /** Clears Community Portal pending state after either success or failure so the next action is available. */
                    () => {
                      setBusy(false);
                    },
                  );
              }
            }
          >
            {selected.definition.questions?.map(
              /** Renders selected.definition.questions entries with their stable identifiers and visible labels. */
              (question) => (
                <label className="field" key={question.key}>
                  {question.label}
                  {question.type === 'select' ? (
                    <select name={question.key} required={question.required}>
                      <option value="">Choose…</option>
                      {question.options?.map(
                        /** Renders question.options entries with their stable identifiers and visible labels. */
                        (option) => (
                          <option key={option}>{option}</option>
                        ),
                      )}
                    </select>
                  ) : (
                    <textarea name={question.key} required={question.required} maxLength={10000} />
                  )}
                </label>
              ),
            )}
            {message && <p role="alert">{message}</p>}
            <div className="modal-actions">
              <button className="button-primary" disabled={busy}>
                Submit form
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
/** Reads only communications explicitly addressed to the current verified account. */
function PortalMessages(): React.JSX.Element {
  const [messages, setMessages] = useState<Row[]>([]);
  const [error, setError] = useState('');
  useEffect(
    /** Synchronises Community Portal with its dependencies and cleans up pending work when the view changes. */
    () => {
      const abort = new AbortController();
      void apiRequest<{ items: Row[] }>('/api/v1/portal/messages', {}, abort.signal)
        .then(
          /** Applies the completed Community Portal result to the next step or current view state. */
          (value) => {
            setMessages(value.items);
          },
        )
        .catch(
          /** Reports Community Portal failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted) setError(errorMessage(reason));
          },
        );
      return /** Cancels the Community Portal request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [],
  );
  return (
    <div className="portal-grid">
      {messages.map(
        /** Renders messages entries with their stable identifiers and visible labels. */
        (item) => (
          <article className="data-card portal-card" key={String(item['id'])}>
            <h2>{item['subject']}</h2>
            <p className="preserve-text">{item['body']}</p>
            <small>{item['sent_at']}</small>
          </article>
        ),
      )}
      {error && <p role="alert">{error}</p>}
      {!messages.length && !error && <p>No school messages.</p>}
    </div>
  );
}

import { errorMessage, scalarText } from '@edutex/contracts';
