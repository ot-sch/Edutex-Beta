/** @fileoverview Responsive searchable records, complete detail views, bounded editing and audited workflow actions. */
import {
  resourceListResponseSchema,
  workflowActions,
  type ResourceRecord,
  type EncryptedFieldEnvelope,
} from '@edutex/contracts';
import { ChevronLeft, ChevronRight, Download, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { newRecordId } from '../core/record-id.js';
import { useEffect, useRef, useState } from 'react';
import { EventTemplatePicker } from '../components/EventTemplatePicker.js';
import { EmptyState, PageError, PageLoading } from '../components/PageStates.js';
import { Modal } from '../components/Modal.js';
import { RecordFields } from '../components/RecordFields.js';
import { StudentSensitiveFields } from '../components/StudentSensitiveFields.js';
import { apiRequest, jsonBody } from '../core/api.js';
import {
  clearSensitiveFieldKeys,
  encryptSensitiveField,
  decryptSensitiveField,
} from '../core/field-encryption.js';
import { useSession } from '../core/session.js';
import {
  resourcePageConfigurations,
  type ResourceFieldConfiguration,
  type ResourcePageConfiguration,
} from './resource-config.js';

/** Formats dates without shifting date-only records into a different day. */
function displayValue(value: unknown, key: string): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return 'Restricted encrypted record';
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\d/.test(value)) {
    const date = new Date(value.length === 10 ? value + 'T12:00:00' : value);
    if (Number.isFinite(date.valueOf()))
      return date.toLocaleString([], {
        dateStyle: 'medium',
        ...(value.length > 10 ? { timeStyle: 'short' } : {}),
      });
  }
  return scalarText(value).replaceAll(key === 'status' ? '_' : '\u0000', ' ');
}

/** Converts UI values into the shared, bounded API representation. */
function serializeField(field: ResourceFieldConfiguration, value: unknown): unknown {
  if (field.type === 'tags') return Array.isArray(value) ? value : [];
  if (field.type === 'boolean') return Boolean(value);
  if (value === '' || value === undefined) return field.type === 'textarea' ? '' : null;
  if (field.type === 'number') return Number(value);
  if (field.type === 'datetime-local' && typeof value === 'string')
    return new Date(value).toISOString();
  if (field.key === 'definition' && typeof value === 'string') return JSON.parse(value) as unknown;
  return value;
}

/** Creates editable date and JSON values while retaining every original field on the server. */
function initialFields(
  config: ResourcePageConfiguration,
  record?: ResourceRecord,
): Record<string, unknown> {
  return Object.fromEntries(
    config.createFields.map(
      /** Transforms config.create Fields entries into the Resource Page output representation. */
      (field) => {
        let value =
          record?.fields[field.key] ??
          field.defaultValue ??
          (field.type === 'boolean' ? false : field.type === 'tags' ? [] : '');
        if (field.type === 'encrypted') value = '';
        if (field.type === 'datetime-local' && typeof value === 'string' && value) {
          const d = new Date(value);
          value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        }
        if (field.key === 'definition' && typeof value === 'object')
          value = JSON.stringify(value, null, 2);
        return [field.key, value] as const;
      },
    ),
  );
}

/** Saves a record with optimistic concurrency; clinical notes are encrypted before the request. */
function ResourceForm(props: {
  config: ResourcePageConfiguration;
  record?: ResourceRecord;
  canEdit: boolean;
  onSaved: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { session, hasPermission } = useSession();
  const allowedFields = props.config.createFields.filter(
    /** Selects props.config.create Fields entries using the explicit field.manage Only has Permission props.config.resource manage condition. */
    (field) => !field.manageOnly || hasPermission(props.config.resource + ':manage'),
  );
  const [id] = useState(props.record?.id ?? newRecordId());
  const [fields, setFields] = useState(
    /** Coordinates initial Fields within Resource Page, preserving the caller's validation and error handling. */
    () => initialFields(props.config, props.record),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [decrypting, setDecrypting] = useState(false);
  const [decryptionFailed, setDecryptionFailed] = useState(false);
  const [history, setHistory] = useState<Record<string, string>[]>([]);

  const sensitive = props.config.createFields.some(
    /** Identifies a form that may contain decrypted clinical content. */
    (field) => field.type === 'encrypted',
  );
  const lifetime = useRef(0);
  const closeSensitive = useRef(props.onCancel);
  closeSensitive.current = props.onCancel;
  useEffect(
    /** Limits decrypted clinical dialogs and closes them on page lock or session expiry. */
    () => {
      if (!sensitive) return;
      /** Invalidates pending saves before removing clinical content from the view. */
      const lock = (): void => {
        lifetime.current += 1;
        clearSensitiveFieldKeys();
        setFields({});
        setDecryptionFailed(true);
        closeSensitive.current();
      };
      /** Locks any clinical dialog that becomes hidden. */
      const hidden = (): void => {
        if (document.hidden) lock();
      };
      const timer = window.setTimeout(lock, 5 * 60_000);
      document.addEventListener('visibilitychange', hidden);
      window.addEventListener('pagehide', lock);
      window.addEventListener('edutex:session-expired', lock);
      return /** Removes clinical listeners and invalidates pending crypto without closing a later dialog. */ () => {
        lifetime.current += 1;
        window.clearTimeout(timer);
        document.removeEventListener('visibilitychange', hidden);
        window.removeEventListener('pagehide', lock);
        window.removeEventListener('edutex:session-expired', lock);
        clearSensitiveFieldKeys();
      };
    },
    [sensitive, id],
  );
  useEffect(
    /** Synchronises Resource Page with its dependencies and cleans up pending work when the view changes. */
    () => {
      if (!props.record || !workflowActions[props.config.resource]) return;
      const abort = new AbortController();
      void apiRequest<{ items: Record<string, string>[] }>(
        `/api/v1/workflows/${props.config.resource}/${id}/history`,
        {},
        abort.signal,
      )
        .then(
          /** Applies the completed Resource Page result to the next step or current view state. */
          (result) => {
            setHistory(result.items);
          },
        )
        .catch(
          /** Reports Resource Page failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted) setError(errorMessage(reason));
          },
        );
      return /** Cancels the Resource Page request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [props.config.resource, props.record, id],
  );
  useEffect(
    /** Synchronises Resource Page with its dependencies and cleans up pending work when the view changes. */
    () => {
      let cancelled = false;
      const encrypted = props.config.createFields.filter(
        /** Selects props.config.create Fields entries using the explicit field.type encrypted props.record .fields field.key condition. */
        (field) => field.type === 'encrypted' && props.record?.fields[field.key],
      );
      if (!encrypted.length) return;
      setDecrypting(true);
      void Promise.all(
        encrypted.map(
          /** Transforms encrypted entries into the Resource Page output representation. */
          async (field) =>
            [
              field.key,
              await decryptSensitiveField({
                tenantId: session.user.tenantId,
                studentId: id,
                fieldKey: props.config.resource + ':' + field.key,
                envelope: requiredValue(props.record).fields[field.key] as EncryptedFieldEnvelope,
              }),
            ] as const,
        ),
      )
        .then(
          /** Applies the completed Resource Page result to the next step or current view state. */
          (values) => {
            if (!cancelled)
              setFields(
                /** Coordinates Resource Page within Resource Page, preserving the caller's validation and error handling. */
                (current) => ({ ...current, ...Object.fromEntries(values) }),
              );
          },
        )
        .catch(
          /** Surfaces Resource Page failures through the existing error handler without silently succeeding. */
          (reason: unknown) => {
            if (!cancelled) {
              setDecryptionFailed(true);
              setError(
                reason instanceof Error
                  ? errorMessage(reason)
                  : 'The restricted record could not be opened.',
              );
            }
          },
        )
        .finally(
          /** Clears Resource Page pending state after either success or failure so the next action is available. */
          () => {
            if (!cancelled) setDecrypting(false);
          },
        );
      return /** Releases the Resource Page resources owned by this lifecycle callback. */ () => {
        cancelled = true;
      };
    },
    [id, props.config, props.record, session.user.tenantId],
  );
  /** Coordinates save within Resource Page, preserving the caller's validation and error handling. */
  const save = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving || decrypting || decryptionFailed || !props.canEdit) return;
    const ticket = lifetime.current;
    setSaving(true);
    setError('');
    try {
      const values: Record<string, unknown> = Object.fromEntries(
        await Promise.all(
          allowedFields.map(
            /** Transforms allowed Fields entries into the Resource Page output representation. */
            async (field) => {
              let value = serializeField(field, fields[field.key]);
              if (field.type === 'encrypted' && typeof value === 'string')
                value = await encryptSensitiveField({
                  tenantId: session.user.tenantId,
                  studentId: id,
                  fieldKey: props.config.resource + ':' + field.key,
                  plaintext: value,
                });
              return [field.key, value] as const;
            },
          ),
        ),
      );
      if (ticket !== lifetime.current || (sensitive && document.hidden)) return;
      await apiRequest(
        `/api/v1/resources/${props.config.resource}${props.record ? '/' + id : ''}`,
        {
          method: props.record ? 'PATCH' : 'POST',
          ...jsonBody({
            fields: values,
            ...(props.record ? { rowVersion: props.record.rowVersion } : { id }),
          }),
        },
      );
      if (ticket === lifetime.current) props.onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? errorMessage(reason) : 'The record could not be saved.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      className={sensitive ? 'sensitive-dialog' : undefined}
      onSubmit={
        /** Validates and submits Resource Page save state from the current control. */
        (event) => void save(event)
      }
    >
      {props.config.resource === 'event-plans' && props.canEdit && (
        <EventTemplatePicker
          onApply={
            /** Handles Resource Page update Fields state from the current control. */
            (values) => {
              setFields(
                /** Coordinates Resource Page within Resource Page, preserving the caller's validation and error handling. */
                (current) => ({ ...current, ...values }),
              );
            }
          }
        />
      )}
      {decrypting ? (
        <PageLoading />
      ) : (
        <RecordFields
          fields={allowedFields}
          values={fields}
          onChange={
            /** Updates Resource Page update Fields state from the current control. */
            (key, value) => {
              setFields(
                /** Coordinates Resource Page within Resource Page, preserving the caller's validation and error handling. */
                (current) => ({ ...current, [key]: value }),
              );
            }
          }
          disabled={!props.canEdit || saving}
        />
      )}
      {props.config.resource === 'students' && props.record && (
        <StudentSensitiveFields studentId={id} />
      )}
      {history.length > 0 && (
        <details className="mt-5">
          <summary>Decision history</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>By</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {history.map(
                  /** Renders history entries with their stable identifiers and visible labels. */
                  (row, index) => (
                    <tr key={index}>
                      <td>{displayValue(row['occurred_at'], 'date')}</td>
                      <td>{row['action']}</td>
                      <td>{row['actor'] ?? 'Authorised staff'}</td>
                      <td>{row['note']}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="button-secondary" onClick={props.onCancel}>
          Close
        </button>
        {props.canEdit && (
          <button
            type="submit"
            className="button-primary"
            disabled={saving || decrypting || decryptionFailed}
          >
            {saving ? 'Saving…' : props.record ? 'Save changes' : `Create ${props.config.singular}`}
          </button>
        )}
      </div>
    </form>
  );
}

/** Downloads permitted, visible rows as a spreadsheet-safe CSV with formula injection protection. */
function exportRows(config: ResourcePageConfiguration, items: readonly ResourceRecord[]): void {
  /** Coordinates cell within Resource Page, preserving the caller's validation and error handling. */
  const cell = (value: string): string =>
    '"' + (/^[=+@\-\t\r\n]/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
  const lines = [
    config.columns
      .map(
        /** Transforms config.columns entries into the Resource Page output representation. */
        ([, label]) => cell(label),
      )
      .join(','),
    ...items.map(
      /** Transforms items entries into the Resource Page output representation. */
      (item) =>
        config.columns
          .map(
            /** Transforms config.columns entries into the Resource Page output representation. */
            ([key]) => cell(displayValue(item.fields[key], key)),
          )
          .join(','),
    ),
  ];
  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = config.resource + '.csv';
  link.click();
  setTimeout(
    /** Expires the temporary Resource Page state at its configured deadline. */
    () => {
      URL.revokeObjectURL(url);
    },
    1000,
  );
}

/** Shows all existing and new record workflows in the same full-width, accessible workspace. */
export function ResourcePage(props: { readonly route: string }): React.JSX.Element {
  const config = resourcePageConfigurations[props.route];
  if (!config) return <PageError message="This page is not configured." />;
  return <ResourceWorkspace key={props.route} config={config} />;
}

/** Separates each resource's view state so navigation cannot retain the prior module's records or form. */
function ResourceWorkspace({ config }: { config: ResourcePageConfiguration }): React.JSX.Element {
  const { hasPermission } = useSession();
  const permission =
    config.permissionModule ??
    (config.resource === 'assessments'
      ? 'grades'
      : config.resource === 'invoices'
        ? 'finance'
        : config.resource === 'knowledge-articles'
          ? 'knowledge-base'
          : config.resource === 'sign-in-out-requests'
            ? 'sign-in-out'
            : config.resource);
  const canCreate =
    hasPermission(`${permission}:${config.adminOnly ? 'manage' : 'create'}`) ||
    hasPermission(`${permission}:manage`);
  const canEdit =
    hasPermission(`${permission}:${config.adminOnly ? 'manage' : 'edit'}`) ||
    hasPermission(`${permission}:manage`);
  const [items, setItems] = useState<ResourceRecord[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(
    /** Synchronises Resource Page with its dependencies and cleans up pending work when the view changes. */
    () => {
      const abort = new AbortController();
      setLabels({});
      void Promise.all(
        config.createFields
          .filter(
            /** Selects config.create Fields entries using the explicit field.type reference condition. */
            (field) => field.type === 'reference',
          )
          .map(
            /** Renders config.create Fields.filter field field.type reference entries with their stable identifiers and visible labels. */
            async (field) => {
              const ids = [
                ...new Set(
                  items
                    .map(
                      /** Transforms items entries into the Resource Page output representation. */
                      (item) => scalarText(item.fields[field.key]),
                    )
                    .filter(Boolean),
                ),
              ];
              if (!ids.length) return [];
              const result = await apiRequest<{ items: { id: string; label: string }[] }>(
                `/api/v1/lookups/${field.reference}?ids=${encodeURIComponent(ids.join(','))}`,
                {},
                abort.signal,
              );
              return result.items.map(
                /** Transforms result.items entries into the Resource Page output representation. */
                (item) => [field.key + ':' + item.id, item.label] as const,
              );
            },
          ),
      )
        .then(
          /** Applies the completed Resource Page result to the next step or current view state. */
          (results) => {
            setLabels(Object.fromEntries(results.flat()));
          },
        )
        .catch(
          /** Surfaces Resource Page failures through the existing error handler without silently succeeding. */
          () => {
            /* Restricted reference labels stay hidden; the original records remain available. */
          },
        );
      return /** Cancels the Resource Page request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [items, config],
  );
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<ResourceRecord | 'new'>();
  const [filterOpen, setFilterOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<ResourceRecord>();
  const [action, setAction] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(
    /** Synchronises Resource Page with its dependencies and cleans up pending work when the view changes. */
    () => {
      const timer = setTimeout(
        /** Expires the temporary Resource Page state at its configured deadline. */
        () => {
          setAppliedQuery(query);
          setPage(1);
        },
        250,
      );
      return /** Releases the Resource Page resources owned by this lifecycle callback. */ () => {
        clearTimeout(timer);
      };
    },
    [query],
  );
  useEffect(
    /** Synchronises Resource Page with its dependencies and cleans up pending work when the view changes. */
    () => {
      const controller = new AbortController();
      setLoading(true);
      setError('');
      const search = new URLSearchParams({
        search: appliedQuery,
        page: String(page),
        pageSize: '25',
        ...(status ? { status } : {}),
      });
      void apiRequest<unknown>(
        `/api/v1/resources/${config.resource}?${search}`,
        {},
        controller.signal,
      )
        .then(
          /** Applies the completed Resource Page result to the next step or current view state. */
          (value) => {
            const parsed = resourceListResponseSchema.parse(value);
            setItems(parsed.items);
            setTotal(parsed.total);
          },
        )
        .catch(
          /** Reports Resource Page failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!controller.signal.aborted)
              setError(
                reason instanceof Error ? errorMessage(reason) : 'Records could not be loaded.',
              );
          },
        )
        .finally(
          /** Clears Resource Page pending state after either success or failure so the next action is available. */
          () => {
            if (!controller.signal.aborted) setLoading(false);
          },
        );
      return /** Cancels the Resource Page request when dependencies change or the view unmounts. */ () => {
        controller.abort();
      };
    },
    [appliedQuery, page, status, refresh, config.resource],
  );
  /** Coordinates advance within Resource Page, preserving the caller's validation and error handling. */
  const advance = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest(`/api/v1/workflows/${config.resource}/${selected.id}/${action}`, {
        method: 'POST',
        ...jsonBody({ rowVersion: selected.rowVersion, note, paymentReference: note }),
      });
      setSelected(undefined);
      setNote('');
      setRefresh(
        /** Coordinates Resource Page within Resource Page, preserving the caller's validation and error handling. */
        (value) => value + 1,
      );
    } catch (reason) {
      setError(reason instanceof Error ? errorMessage(reason) : 'The workflow could not advance.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">School records</p>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
          {permission === 'finance' &&
            !config.createFields.some(
              /** Shows the supported base currency when a finance record has no currency selector. */
              (field) => field.key === 'currencyCode',
            ) && (
              <p className="field-help">
                Amounts in this workspace are AUD unless a linked bank account specifies its
                currency.
              </p>
            )}
        </div>
        <div className="heading-actions">
          {hasPermission(`${permission}:export`) && (
            <button
              className="button-secondary"
              type="button"
              disabled={!items.length}
              onClick={
                /** Handles Resource Page export Rows state from the current control. */
                () => {
                  exportRows(config, items);
                }
              }
            >
              <Download size={16} />
              Export visible rows
            </button>
          )}
          {canCreate && (
            <button
              className="button-primary"
              type="button"
              onClick={
                /** Handles Resource Page update Editing state from the current control. */
                () => {
                  setEditing('new');
                }
              }
            >
              <Plus size={17} />
              Add {config.singular}
            </button>
          )}
        </div>
      </div>
      <div className="data-card">
        <div className="table-toolbar">
          <label className="table-search">
            <Search size={17} />
            <input
              value={query}
              onChange={
                /** Updates Resource Page update Query state from the current control. */
                (e) => {
                  setQuery(e.target.value);
                }
              }
              placeholder={`Search ${config.title.toLowerCase()}…`}
              aria-label={`Search ${config.title}`}
            />
          </label>
          <div className="heading-actions">
            <span className="result-count">{total.toLocaleString()} records</span>
            {config.columns.some(
              /** Selects config.columns entries using the explicit key status condition. */
              ([key]) => key === 'status',
            ) && (
              <button
                type="button"
                className="button-secondary"
                aria-expanded={filterOpen}
                onClick={
                  /** Handles Resource Page update Filter Open state from the current control. */
                  () => {
                    setFilterOpen(
                      /** Coordinates Resource Page within Resource Page, preserving the caller's validation and error handling. */
                      (value) => !value,
                    );
                  }
                }
              >
                <SlidersHorizontal size={16} />
                Filters
              </button>
            )}
          </div>
        </div>
        {filterOpen && (
          <div className="filters-panel">
            <label className="field">
              Status
              <input
                value={status}
                onChange={
                  /** Updates Resource Page update Status state from the current control. */
                  (e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }
                }
                placeholder="e.g. draft"
              />
            </label>
            <button
              type="button"
              className="button-secondary"
              onClick={
                /** Handles Resource Page update Status state from the current control. */
                () => {
                  setStatus('');
                }
              }
            >
              Clear filter
            </button>
          </div>
        )}
        {loading ? (
          <PageLoading />
        ) : error && !selected ? (
          <PageError
            message={error}
            retry={
              /** Handles Resource Page update Refresh state from the current control. */
              () => {
                setRefresh(
                  /** Coordinates Resource Page within Resource Page, preserving the caller's validation and error handling. */
                  (value) => value + 1,
                );
              }
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title={
              appliedQuery || status
                ? 'No matching records'
                : `No ${config.title.toLowerCase()} yet`
            }
            detail="Records appear here when they are created or imported."
          />
        ) : (
          <div
            className="table-scroll"
            role="region"
            aria-label={config.title + ' records'}
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  {config.columns.map(
                    /** Renders config.columns entries with their stable identifiers and visible labels. */
                    ([key, label]) => (
                      <th key={key}>{label}</th>
                    ),
                  )}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(
                  /** Renders items entries with their stable identifiers and visible labels. */
                  (record) => (
                    <tr key={record.id}>
                      {config.columns.map(
                        /** Renders config.columns entries with their stable identifiers and visible labels. */
                        ([key]) => (
                          <td key={key}>
                            {key === 'status' ? (
                              <span className={'status-pill status-' + String(record.fields[key])}>
                                {displayValue(record.fields[key], key)}
                              </span>
                            ) : config.createFields.some(
                                /** Selects config.create Fields entries using the explicit field.key key field.type reference condition. */
                                (field) => field.key === key && field.type === 'reference',
                              ) ? (
                              (labels[key + ':' + scalarText(record.fields[key])] ??
                              (record.fields[key] ? 'Linked record' : '—'))
                            ) : (
                              displayValue(record.fields[key], key)
                            )}
                          </td>
                        ),
                      )}
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="text-action"
                            onClick={
                              /** Handles Resource Page update Editing state from the current control. */
                              () => {
                                setEditing(record);
                              }
                            }
                          >
                            Open record
                          </button>
                          {Object.entries(workflowActions[config.resource] ?? {})
                            .filter(
                              /** Selects Object.entries workflow Actions config.resource entries using the explicit rule.from.includes String record.fields status has Permission permission rule.permission has Permission permission manage condition. */
                              ([, rule]) =>
                                rule.from.includes(String(record.fields['status'])) &&
                                (hasPermission(`${permission}:${rule.permission}`) ||
                                  hasPermission(`${permission}:manage`)),
                            )
                            .map(
                              /** Renders Object.entries workflow Actions config.resource .filter rule rule.from.includes String record.fields status has Permission permission rule.permission has Permission permission manage entries with their stable identifiers and visible labels. */
                              ([key, rule]) => (
                                <button
                                  className="text-action"
                                  type="button"
                                  key={key}
                                  onClick={
                                    /** Handles Resource Page update Selected state from the current control. */
                                    () => {
                                      setSelected(record);
                                      setAction(key);
                                      setNote('');
                                      setError('');
                                    }
                                  }
                                >
                                  {rule.label}
                                </button>
                              ),
                            )}
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <p>
            Page {page} of {Math.max(1, Math.ceil(total / 25))}
          </p>
          <div>
            <button
              type="button"
              className="pagination-button"
              disabled={page === 1}
              onClick={
                /** Handles Resource Page update Page state from the current control. */
                () => {
                  setPage(
                    /** Coordinates Resource Page within Resource Page, preserving the caller's validation and error handling. */
                    (value) => value - 1,
                  );
                }
              }
            >
              <ChevronLeft size={17} />
              Previous
            </button>
            <button
              type="button"
              className="pagination-button"
              disabled={page * 25 >= total}
              onClick={
                /** Handles Resource Page update Page state from the current control. */
                () => {
                  setPage(
                    /** Coordinates Resource Page within Resource Page, preserving the caller's validation and error handling. */
                    (value) => value + 1,
                  );
                }
              }
            >
              Next
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </div>
      {editing && (
        <Modal
          title={(editing === 'new' ? 'Add ' : 'Open ') + config.singular}
          onClose={
            /** Handles Resource Page update Editing state from the current control. */
            () => {
              setEditing(undefined);
            }
          }
        >
          <ResourceForm
            config={config}
            {...(editing === 'new' ? {} : { record: editing })}
            canEdit={
              editing === 'new'
                ? canCreate
                : canEdit &&
                  (!workflowActions[config.resource] ||
                    ['draft', 'rejected', 'pending', 'unmatched'].includes(
                      String(editing.fields['status']),
                    ))
            }
            onCancel={
              /** Handles Resource Page update Editing state from the current control. */
              () => {
                setEditing(undefined);
              }
            }
            onSaved={
              /** Handles Resource Page update Editing state from the current control. */
              () => {
                setEditing(undefined);
                setRefresh(
                  /** Coordinates Resource Page within Resource Page, preserving the caller's validation and error handling. */
                  (value) => value + 1,
                );
              }
            }
          />
        </Modal>
      )}
      {selected && (
        <Modal
          title={workflowActions[config.resource]?.[action]?.label ?? 'Review action'}
          onClose={
            /** Handles Resource Page update Selected state from the current control. */
            () => {
              setSelected(undefined);
            }
          }
        >
          <p className="mb-4">
            The action and your identity will be recorded in the audit history.
          </p>
          <label className="field">
            {action === 'pay' ? 'Verified payment reference' : 'Decision / verification note'}
            <textarea
              value={note}
              onChange={
                /** Updates Resource Page update Note state from the current control. */
                (e) => {
                  setNote(e.target.value);
                }
              }
              required
              rows={3}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button-secondary"
              onClick={
                /** Handles Resource Page update Selected state from the current control. */
                () => {
                  setSelected(undefined);
                }
              }
            >
              Cancel
            </button>
            <button
              type="button"
              className="button-primary"
              disabled={busy || !note.trim()}
              onClick={
                /** Handles Resource Page advance state from the current control. */
                () => void advance()
              }
            >
              {busy ? 'Recording…' : 'Confirm action'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

import { requiredValue } from '@edutex/contracts';

import { errorMessage, scalarText } from '@edutex/contracts';
