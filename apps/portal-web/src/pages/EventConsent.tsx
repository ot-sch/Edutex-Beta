/** @fileoverview Printable consent forms and separately identified paper evidence help staff follow up without exposing medical information. */
import { useEffect, useState } from 'react';
import { apiRequest, jsonBody } from '../core/api.js';
import { useSession } from '../core/session.js';
import { RecordFields } from '../components/RecordFields.js';
import { errorMessage, scalarText } from '@edutex/contracts';
interface ConsentPack {
  event: Record<string, string>;
  participants: { student_id: string; student: string; consent_status: string }[];
  evidence: {
    student_id: string;
    decision: string;
    source: string;
    reference: string | null;
    recorded_at: string;
  }[];
}
/** Keeps the selected student, printed event information and signed-paper reference visible together. */
export function EventConsent(): React.JSX.Element {
  const { hasPermission } = useSession();
  const [eventId, setEventId] = useState('');
  const [pack, setPack] = useState<ConsentPack>();
  const [fields, setFields] = useState<Record<string, unknown>>({ decision: 'granted' });
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(
    /** Synchronises Event Consent with its dependencies and cleans up pending work when the view changes. */
    () => {
      setPack(undefined);
      setFields({ decision: 'granted' });
      if (!eventId) return;
      const abort = new AbortController();
      void apiRequest<ConsentPack>(`/api/v1/events/${eventId}/consent`, {}, abort.signal)
        .then(setPack)
        .catch(
          /** Reports Event Consent failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted) setError(errorMessage(reason));
          },
        );
      return /** Cancels the Event Consent request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [eventId, version],
  );
  const selected = pack?.participants.find(
    /** Selects pack .participants entries using the explicit student.student id fields student Id condition. */
    (student) => student.student_id === fields['studentId'],
  );
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Events</p>
          <h1>Consent and follow-up</h1>
          <p>
            View portal and paper decisions together. Keep signed paper in the school's approved
            records system.
          </p>
        </div>
      </div>
      <article className="panel">
        <RecordFields
          fields={[
            {
              key: 'eventId',
              label: 'Event',
              type: 'reference',
              reference: 'events',
              required: true,
            },
          ]}
          values={{ eventId }}
          onChange={
            /** Updates Event Consent update Event Id state from the current control. */
            (_, value) => {
              setEventId(scalarText(value));
              setError('');
            }
          }
        />
        {pack && (
          <label className="field mt-4">
            Student
            <select
              value={scalarText(fields['studentId'])}
              onChange={
                /** Updates Event Consent update Fields state from the current control. */
                (event) => {
                  setFields({ ...fields, studentId: event.target.value });
                }
              }
            >
              <option value="">Choose a participant…</option>
              {pack.participants.map(
                /** Renders pack.participants entries with their stable identifiers and visible labels. */
                (student) => (
                  <option key={student.student_id} value={student.student_id}>
                    {student.student} · {student.consent_status}
                  </option>
                ),
              )}
            </select>
          </label>
        )}
      </article>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pack && selected && (
        <>
          <article className="panel print-consent">
            <h2>{pack.event['title']} — consent form</h2>
            <p>Student: {selected.student}</p>
            <p>Location: {pack.event['location']}</p>
            <p>
              From {new Date(scalarText(pack.event['starts_at'])).toLocaleString()} to{' '}
              {new Date(scalarText(pack.event['ends_at'])).toLocaleString()}
            </p>
            <p className="preserve-text">{pack.event['description']}</p>
            <p>
              Please read the school's event information and contact the school with questions
              before deciding.
            </p>
            <p>Decision (circle one): Give consent / Decline consent / Withdraw previous consent</p>
            <p>Guardian name: ____________________________________</p>
            <p>Signature: ________________________________________</p>
            <p>Date: ____________________</p>
            <p>Return this signed form to the school using its approved process.</p>
            <button
              className="button-secondary no-print"
              type="button"
              onClick={
                /** Handles Event Consent interaction state from the current control. */
                () => {
                  window.print();
                }
              }
            >
              Print consent form
            </button>
          </article>
          {hasPermission('events:edit') && (
            <form
              className="panel"
              onSubmit={
                /** Validates and submits Event Consent update Busy state from the current control. */
                (event) => {
                  event.preventDefault();
                  setBusy(true);
                  setError('');
                  setNotice('');
                  void apiRequest(`/api/v1/events/${eventId}/paper-consent`, {
                    method: 'POST',
                    ...jsonBody(fields),
                  })
                    .then(
                      /** Applies the completed Event Consent result to the next step or current view state. */
                      () => {
                        setNotice('Paper decision recorded in the consent history.');
                        setVersion(
                          /** Coordinates Event Consent within Event Consent, preserving the caller's validation and error handling. */
                          (value) => value + 1,
                        );
                      },
                    )
                    .catch(
                      /** Surfaces Event Consent failures through the existing error handler without silently succeeding. */
                      (reason: unknown) => {
                        setError(errorMessage(reason));
                      },
                    )
                    .finally(
                      /** Clears Event Consent pending state after either success or failure so the next action is available. */
                      () => {
                        setBusy(false);
                      },
                    );
                }
              }
            >
              <h2>Record a signed paper decision</h2>
              <p>Verify the signer's identity and current consent rights before recording.</p>
              <RecordFields
                fields={[
                  {
                    key: 'guardianId',
                    label: 'Signing guardian',
                    type: 'reference',
                    reference: 'guardians',
                    required: true,
                  },
                  {
                    key: 'decision',
                    label: 'Decision on paper',
                    type: 'select',
                    options: ['granted', 'declined', 'withdrawn'],
                    required: true,
                  },
                  {
                    key: 'reference',
                    label: 'Signed document reference and date',
                    type: 'textarea',
                    required: true,
                  },
                ]}
                values={fields}
                onChange={
                  /** Updates Event Consent update Fields state from the current control. */
                  (key, value) => {
                    setFields({ ...fields, [key]: value });
                  }
                }
              />
              <div className="modal-actions">
                <button className="button-primary" disabled={busy}>
                  {busy ? 'Recording…' : 'Record paper decision'}
                </button>
              </div>
            </form>
          )}
          <article className="panel">
            <h2>Consent history</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Recorded</th>
                    <th>Decision</th>
                    <th>Source</th>
                    <th>Document reference</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.evidence
                    .filter(
                      /** Selects pack.evidence entries using the explicit item.student id selected.student id condition. */
                      (item) => item.student_id === selected.student_id,
                    )
                    .map(
                      /** Renders pack.evidence.filter item item.student id selected.student id entries with their stable identifiers and visible labels. */
                      (item, index) => (
                        <tr key={index}>
                          <td>{new Date(item.recorded_at).toLocaleString()}</td>
                          <td>{item.decision}</td>
                          <td>{item.source === 'paper' ? 'Signed paper' : 'Parent portal'}</td>
                          <td>{item.reference ?? '—'}</td>
                        </tr>
                      ),
                    )}
                </tbody>
              </table>
            </div>
          </article>
        </>
      )}
    </section>
  );
}
