/** @fileoverview Mobile clinical workspace selects only students accessible to the current care role or event schedule. */
import { useState } from 'react';
import { MedicalRecord } from '../components/MedicalRecord.js';
import { RecordFields } from '../components/RecordFields.js';
/** Keeps each opened medical record keyed to its selected student and clears the previous screen on selection. */
export function MedicalWorkspace(): React.JSX.Element {
  const [studentId, setStudentId] = useState('');
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Authorised care</p>
          <h1>Student medical records</h1>
          <p>
            Access depends on your care role or the event access schedule assigned by the school.
          </p>
        </div>
      </div>
      <div className="data-card portal-card">
        <RecordFields
          fields={[
            {
              key: 'studentId',
              label: 'Student',
              type: 'reference',
              reference: 'students',
              required: true,
            },
          ]}
          values={{ studentId }}
          onChange={
            /** Updates Medical Workspace update Student Id state from the current control. */
            (_key, value) => {
              setStudentId(scalarText(value ?? ''));
            }
          }
        />
      </div>
      {studentId && <MedicalRecord key={studentId} studentId={studentId} />}
    </section>
  );
}

import { scalarText } from '@edutex/contracts';
