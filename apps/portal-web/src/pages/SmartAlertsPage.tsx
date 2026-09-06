/** @fileoverview A bounded shortcuts-style smart alert builder with templates, sharing and dry-run evidence. */
import { newRecordId } from '../core/record-id.js';
import { useEffect, useState } from 'react';
import { alertRuleSchema, alertSourceFields, type AlertRule } from '@edutex/contracts';
import { apiRequest, jsonBody } from '../core/api.js';
import { useSession } from '../core/session.js';
import { RecordFields } from '../components/RecordFields.js';
const initial: AlertRule = {
  name: 'Absence follow-up',
  source: 'attendance',
  logic: 'all',
  conditions: [{ field: 'status', operator: 'equals', value: 'absent' }],
  threshold: 3,
  countBy: 'distinct_days',
  timeline: 'weekly',
  actions: [{ channel: 'dashboard', userIds: [], groupIds: [], includeParents: false }],
  enabled: false,
};
const templates = [
  {
    name: 'Pending event consent this month',
    rule: {
      ...initial,
      name: 'Pending event consent',
      source: 'event-consent',
      conditions: [{ field: 'status', operator: 'equals', value: 'pending' }],
      threshold: 1,
      countBy: 'records',
      timeline: 'monthly',
      actions: [{ channel: 'dashboard', userIds: [], groupIds: [], includeParents: true }],
    } as AlertRule,
  },
  { name: 'Three absent days in a week', rule: initial },
  {
    name: 'Outstanding fees',
    rule: {
      ...initial,
      name: 'Outstanding fees',
      source: 'invoices',
      conditions: [{ field: 'balanceDue', operator: 'greater_than', value: 0 }],
      threshold: 1,
      countBy: 'records',
      timeline: 'monthly',
    } as AlertRule,
  },
  {
    name: 'Departure without approval',
    rule: {
      ...initial,
      name: 'Departure without approval',
      source: 'sign-in-out',
      conditions: [{ field: 'parentApproved', operator: 'equals', value: false }],
      threshold: 1,
      countBy: 'records',
      timeline: 'daily',
    } as AlertRule,
  },
];
interface SavedAlert {
  id: string;
  definition: AlertRule;
  row_version: number;
  owner_user_id: string;
  share_group_id: string | null;
  last_evaluated_at: string | null;
  last_error_code: string | null;
}
/** Saves reusable alert rules and previews their matches before enabling deliveries. */
export function SmartAlertsPage(): React.JSX.Element {
  const { session, hasPermission } = useSession();
  const [rule, setRule] = useState<AlertRule>(initial);
  const [id, setId] = useState<string>(newRecordId());
  const [version, setVersion] = useState(0);
  const [owner, setOwner] = useState(session.user.id);
  const [share, setShare] = useState<string | null>(null);
  const [items, setItems] = useState<SavedAlert[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const canEdit =
    owner === session.user.id &&
    (hasPermission('smart-alerts:edit') ||
      hasPermission('smart-alerts:create') ||
      hasPermission('smart-alerts:manage'));
  useEffect(
    /** Synchronises Smart Alerts Page with its dependencies and cleans up pending work when the view changes. */
    () => {
      const abort = new AbortController();
      void apiRequest<{ items: SavedAlert[] }>('/api/v1/smart-alerts', {}, abort.signal)
        .then(
          /** Applies the completed Smart Alerts Page result to the next step or current view state. */
          (result) => {
            setItems(result.items);
          },
        )
        .catch(
          /** Reports Smart Alerts Page failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted)
              setError(
                reason instanceof Error ? errorMessage(reason) : 'Rules could not be loaded.',
              );
          },
        );
      return /** Cancels the Smart Alerts Page request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [],
  );
  /** Coordinates save within Smart Alerts Page, preserving the caller's validation and error handling. */
  const save = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const definition = alertRuleSchema.parse(rule);
      const result = await apiRequest<{ rowVersion: number }>(`/api/v1/smart-alerts/${id}`, {
        method: 'PUT',
        ...jsonBody({ definition, shareGroupId: share, rowVersion: version }),
      });
      setVersion(result.rowVersion);
      setItems(
        /** Coordinates Smart Alerts Page within Smart Alerts Page, preserving the caller's validation and error handling. */
        (current) => [
          {
            id,
            definition,
            row_version: result.rowVersion,
            owner_user_id: owner,
            share_group_id: share,
            last_evaluated_at: null,
            last_error_code: null,
          },
          ...current.filter(
            /** Selects current entries using the explicit item.id id condition. */
            (item) => item.id !== id,
          ),
        ],
      );
      setNotice('Rule saved. Preview matches before enabling delivery.');
    } catch (reason) {
      setError(reason instanceof Error ? errorMessage(reason) : 'The rule could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  /** Coordinates preview within Smart Alerts Page, preserving the caller's validation and error handling. */
  const preview = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<{ matches: number; queued: number }>(
        `/api/v1/smart-alerts/${id}/evaluate`,
        { method: 'POST', ...jsonBody({ dryRun: true }) },
      );
      setNotice(
        `${result.matches} matching student or record groups. Preview sends no notifications.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? errorMessage(reason) : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Smart alerts</p>
          <h1>Build a school workflow</h1>
          <p>Choose a pattern, a time window and the people who should be notified.</p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="button-secondary"
            disabled={!version || busy}
            onClick={
              /** Handles Smart Alerts Page preview state from the current control. */
              () => void preview()
            }
          >
            Preview saved rule
          </button>
          {canEdit && (
            <button
              type="button"
              className="button-primary"
              disabled={busy}
              onClick={
                /** Handles Smart Alerts Page save state from the current control. */
                () => void save()
              }
            >
              {busy ? 'Working…' : 'Save alert'}
            </button>
          )}
        </div>
      </div>
      <article className="panel">
        <div className="inline-fields">
          <label className="field">
            Saved alerts
            <select
              value={
                items.some(
                  /** Selects items entries using the explicit item.id id condition. */
                  (item) => item.id === id,
                )
                  ? id
                  : ''
              }
              onChange={
                /** Updates Smart Alerts Page update Id state from the current control. */
                (e) => {
                  const item = items.find(
                    /** Selects items entries using the explicit item.id e.target.value condition. */
                    (item) => item.id === e.target.value,
                  );
                  if (item) {
                    setId(item.id);
                    setRule(item.definition);
                    setVersion(item.row_version);
                    setOwner(item.owner_user_id);
                    setShare(item.share_group_id);
                  } else {
                    setId(newRecordId());
                    setRule(structuredClone(initial));
                    setVersion(0);
                    setOwner(session.user.id);
                    setShare(null);
                  }
                  setError('');
                  setNotice('');
                }
              }
            >
              <option value="">New alert</option>
              {items.map(
                /** Renders items entries with their stable identifiers and visible labels. */
                (item) => (
                  <option key={item.id} value={item.id}>
                    {item.definition.name}
                    {item.owner_user_id !== session.user.id ? ' · Shared' : ''}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="field">
            Start from a template
            <select
              value=""
              onChange={
                /** Updates Smart Alerts Page Number state from the current control. */
                (e) => {
                  const template = templates[Number(e.target.value)];
                  if (template) {
                    setRule(structuredClone(template.rule));
                    setId(newRecordId());
                    setVersion(0);
                    setOwner(session.user.id);
                    setShare(null);
                  }
                }
              }
            >
              <option value="">Choose a template…</option>
              {templates.map(
                /** Renders templates entries with their stable identifiers and visible labels. */
                (template, i) => (
                  <option key={template.name} value={i}>
                    {template.name}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
      </article>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="security-explainer" role="status">
          {notice}
        </p>
      )}
      <article className="panel">
        <div className="smart-flow">
          <div className="smart-step">
            <strong>1 · Name and source</strong>
            <RecordFields
              disabled={!canEdit}
              fields={[
                { key: 'name', label: 'Alert name', required: true },
                {
                  key: 'source',
                  label: 'Watch records in',
                  type: 'select',
                  options: [
                    'students',
                    'attendance',
                    'invoices',
                    'payments',
                    'payroll',
                    'purchase-orders',
                    'incidents',
                    'maintenance',
                    'sign-in-out',
                    'event-consent',
                  ],
                },
                {
                  key: 'logic',
                  label: 'Match conditions',
                  type: 'select',
                  options: ['all', 'any'],
                },
              ]}
              values={rule}
              onChange={
                /** Updates Smart Alerts Page update Rule state from the current control. */
                (key, value) => {
                  if (key === 'source') {
                    setRule({
                      ...rule,
                      source: value as AlertRule['source'],
                      conditions: [{ field: 'status', operator: 'equals', value: '' }],
                      countBy: 'records',
                    });
                  } else setRule({ ...rule, [key]: value });
                }
              }
            />
          </div>
          <div className="smart-step">
            <strong>2 · If these conditions match</strong>
            {rule.conditions.map(
              /** Renders rule.conditions entries with their stable identifiers and visible labels. */
              (condition, index) => (
                <div className="inline-fields" key={index}>
                  <label className="field">
                    Field
                    <select
                      disabled={!canEdit}
                      value={condition.field}
                      onChange={
                        /** Updates Smart Alerts Page update Rule state from the current control. */
                        (e) => {
                          setRule({
                            ...rule,
                            conditions: rule.conditions.map(
                              /** Transforms rule.conditions entries into the Smart Alerts Page output representation. */
                              (item, i) =>
                                i === index
                                  ? { ...item, field: e.target.value as typeof condition.field }
                                  : item,
                            ),
                          });
                        }
                      }
                    >
                      {alertSourceFields[rule.source].map(
                        /** Renders status year Level class Id student Id amount balance Due category severity parent Approved entries with their stable identifiers and visible labels. */
                        (field) => (
                          <option key={field}>{field}</option>
                        ),
                      )}
                    </select>
                  </label>
                  <label className="field">
                    Condition
                    <select
                      disabled={!canEdit}
                      value={condition.operator}
                      onChange={
                        /** Updates Smart Alerts Page update Rule state from the current control. */
                        (e) => {
                          setRule({
                            ...rule,
                            conditions: rule.conditions.map(
                              /** Transforms rule.conditions entries into the Smart Alerts Page output representation. */
                              (item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      operator: e.target.value as typeof condition.operator,
                                    }
                                  : item,
                            ),
                          });
                        }
                      }
                    >
                      {['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'in'].map(
                        /** Renders equals not equals contains greater than less than in entries with their stable identifiers and visible labels. */
                        (value) => (
                          <option key={value} value={value}>
                            {value.replaceAll('_', ' ')}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label className="field">
                    Value
                    <input
                      disabled={!canEdit}
                      value={
                        Array.isArray(condition.value)
                          ? condition.value.join(', ')
                          : String(condition.value)
                      }
                      onChange={
                        /** Updates Smart Alerts Page update Rule state from the current control. */
                        (e) => {
                          setRule({
                            ...rule,
                            conditions: rule.conditions.map(
                              /** Transforms rule.conditions entries into the Smart Alerts Page output representation. */
                              (item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      value:
                                        condition.operator === 'in'
                                          ? e.target.value.split(',').map(
                                              /** Transforms e.target.value.split entries into the Smart Alerts Page output representation. */
                                              (v) => v.trim(),
                                            )
                                          : e.target.value,
                                    }
                                  : item,
                            ),
                          });
                        }
                      }
                    />
                  </label>
                  {canEdit && rule.conditions.length > 1 && (
                    <button
                      type="button"
                      className="text-action"
                      onClick={
                        /** Handles Smart Alerts Page update Rule state from the current control. */
                        () => {
                          setRule({
                            ...rule,
                            conditions: rule.conditions.filter(
                              /** Selects rule.conditions entries using the explicit i index condition. */
                              (_, i) => i !== index,
                            ),
                          });
                        }
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              ),
            )}
            {canEdit && (
              <button
                type="button"
                className="text-action"
                disabled={rule.conditions.length >= 20}
                onClick={
                  /** Handles Smart Alerts Page update Rule state from the current control. */
                  () => {
                    setRule({
                      ...rule,
                      conditions: [
                        ...rule.conditions,
                        { field: 'status', operator: 'equals', value: '' },
                      ],
                    });
                  }
                }
              >
                Add condition
              </button>
            )}
          </div>
          <div className="smart-step">
            <strong>3 · Count within a time window</strong>
            <RecordFields
              disabled={!canEdit}
              fields={[
                {
                  key: 'threshold',
                  label: 'At least',
                  type: 'number',
                  min: 1,
                  max: 10000,
                  required: true,
                },
                {
                  key: 'countBy',
                  label: 'Count',
                  type: 'select',
                  options: ['attendance', 'sign-in-out', 'incidents'].includes(rule.source)
                    ? ['records', 'distinct_days']
                    : ['records'],
                },
                {
                  key: 'timeline',
                  label: 'During the current',
                  type: 'select',
                  options: [
                    'daily',
                    'weekly',
                    'fortnightly',
                    'monthly',
                    'quarterly',
                    'termly',
                    'yearly',
                  ],
                },
              ]}
              values={rule}
              onChange={
                /** Updates Smart Alerts Page update Rule state from the current control. */
                (key, value) => {
                  setRule({ ...rule, [key]: key === 'threshold' ? Number(value) : value });
                }
              }
            />
          </div>
          <div className="smart-step">
            <strong>4 · Then notify</strong>
            {rule.actions.map(
              /** Renders rule.actions entries with their stable identifiers and visible labels. */
              (action, index) => (
                <div className="builder-card" key={index}>
                  <RecordFields
                    disabled={!canEdit}
                    fields={[
                      {
                        key: 'channel',
                        label: 'Delivery channel',
                        type: 'select',
                        options: ['dashboard', 'email', 'sms'],
                      },
                      {
                        key: 'user',
                        label: 'Recipient user',
                        type: 'reference',
                        reference: 'users',
                      },
                      {
                        key: 'group',
                        label: 'Recipient group',
                        type: 'reference',
                        reference: 'school-groups',
                      },
                      {
                        key: 'includeParents',
                        label: 'Include linked parents allowed to receive communications',
                        type: 'boolean',
                      },
                    ]}
                    values={{
                      channel: action.channel,
                      user: action.userIds[0],
                      group: action.groupIds[0],
                      includeParents: action.includeParents,
                    }}
                    onChange={
                      /** Updates Smart Alerts Page update Rule state from the current control. */
                      (key, value) => {
                        setRule({
                          ...rule,
                          actions: rule.actions.map(
                            /** Transforms rule.actions entries into the Smart Alerts Page output representation. */
                            (item, i) =>
                              i !== index
                                ? item
                                : key === 'user'
                                  ? { ...item, userIds: value ? [scalarText(value)] : [] }
                                  : key === 'group'
                                    ? { ...item, groupIds: value ? [scalarText(value)] : [] }
                                    : { ...item, [key]: value },
                          ),
                        });
                      }
                    }
                  />
                  {canEdit && rule.actions.length > 1 && (
                    <button
                      type="button"
                      className="text-action"
                      onClick={
                        /** Handles Smart Alerts Page update Rule state from the current control. */
                        () => {
                          setRule({
                            ...rule,
                            actions: rule.actions.filter(
                              /** Selects rule.actions entries using the explicit i index condition. */
                              (_, i) => i !== index,
                            ),
                          });
                        }
                      }
                    >
                      Remove action
                    </button>
                  )}
                </div>
              ),
            )}
            {canEdit && (
              <button
                type="button"
                className="text-action"
                disabled={rule.actions.length >= 10}
                onClick={
                  /** Handles Smart Alerts Page update Rule state from the current control. */
                  () => {
                    setRule({
                      ...rule,
                      actions: [
                        ...rule.actions,
                        { channel: 'dashboard', userIds: [], groupIds: [], includeParents: false },
                      ],
                    });
                  }
                }
              >
                Add another action
              </button>
            )}
          </div>
          <div className="smart-step">
            <strong>5 · Share and activate</strong>
            <RecordFields
              disabled={!canEdit}
              fields={[
                {
                  key: 'share',
                  label: 'Share with a group you manage',
                  type: 'reference',
                  reference: 'school-groups',
                },
                { key: 'enabled', label: 'Enable scheduled evaluation', type: 'boolean' },
              ]}
              values={{ share, enabled: rule.enabled }}
              onChange={
                /** Updates Smart Alerts Page update Share state from the current control. */
                (key, value) => {
                  if (key === 'share') setShare(value ? scalarText(value) : null);
                  else setRule({ ...rule, enabled: Boolean(value) });
                }
              }
            />
            <p className="field-help">
              Email and SMS require the school's configured delivery service. Failed or unavailable
              delivery is retained for review.
            </p>
          </div>
        </div>
      </article>
    </section>
  );
}

import { errorMessage, scalarText } from '@edutex/contracts';
