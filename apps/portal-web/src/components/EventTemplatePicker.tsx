/** @fileoverview Reuses approved planning prompts in a new proposal while retaining explicit review of the actual venue, participants and risks. */
import { useState } from 'react';
import { resourceRecordSchema, errorMessage, scalarText } from '@edutex/contracts';
import { apiRequest } from '../core/api.js';
import { RecordFields } from './RecordFields.js';
/** Copies only editable planning defaults; templates cannot carry approval state or medical access. */
export function EventTemplatePicker({
  onApply,
}: {
  readonly onApply: (fields: Record<string, unknown>) => void;
}): React.JSX.Element {
  const [templateId, setTemplateId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** Coordinates apply within Event Template Picker, preserving the caller's validation and error handling. */
  const apply = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const record = resourceRecordSchema.parse(
        await apiRequest(`/api/v1/resources/event-templates/${templateId}`),
      );
      const keys = [
        'studentActivities',
        'staffActivities',
        'hazards',
        'studentsPerStaff',
        'overnight',
      ];
      onApply({
        ...Object.fromEntries(
          keys.map(
            /** Transforms keys entries into the Event Template Picker output representation. */
            (key) => [key, record.fields[key]],
          ),
        ),
        planningPrompts: record.fields['controlPrompts'] ?? '',
      });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="panel mb-4">
      <summary>Start from an event template</summary>
      <div className="mt-4">
        <RecordFields
          fields={[
            {
              key: 'templateId',
              label: 'Event template',
              type: 'reference',
              reference: 'event-templates',
            },
          ]}
          values={{ templateId }}
          onChange={
            /** Updates Event Template Picker update Template Id state from the current control. */
            (_, value) => {
              setTemplateId(scalarText(value));
            }
          }
        />
        <p className="field-help">
          Applying a template replaces the activity descriptions, hazards, ratio and planning
          prompts in this draft. Review each value for this event.
        </p>
        <button
          type="button"
          className="button-secondary"
          disabled={!templateId || busy}
          onClick={
            /** Handles Event Template Picker apply state from the current control. */
            () => void apply()
          }
        >
          Apply planning defaults
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </details>
  );
}
