/** @fileoverview Accessible school record controls, including relational selectors and encrypted clinical notes. */
import { useEffect, useState, useId } from 'react';
import { apiRequest } from '../core/api.js';
import type { ResourceFieldConfiguration } from '../pages/resource-config.js';

/** Resolves reference labels by searching the permission-filtered API rather than exposing UUID entry. */
function ReferenceInput(props: {
  field: ResourceFieldConfiguration;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<{ id: string; label: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(
    /** Synchronises Record Fields with its dependencies and cleans up pending work when the view changes. */
    () => {
      const abort = new AbortController();
      const timer = setTimeout(
        /** Expires the temporary Record Fields state at its configured deadline. */
        () => {
          void apiRequest<{ items: { id: string; label: string }[] }>(
            `/api/v1/lookups/${props.field.reference}?search=${encodeURIComponent(query)}`,
            {},
            abort.signal,
          )
            .then(
              /** Applies the completed Record Fields result to the next step or current view state. */
              async (result) => {
                const current = scalarText(props.value);
                if (
                  current &&
                  !result.items.some(
                    /** Selects result.items entries using the explicit item.id current condition. */
                    (item) => item.id === current,
                  )
                ) {
                  const selected = await apiRequest<{ items: { id: string; label: string }[] }>(
                    `/api/v1/lookups/${props.field.reference}?ids=${encodeURIComponent(current)}`,
                    {},
                    abort.signal,
                  );
                  setItems([...selected.items, ...result.items]);
                } else setItems(result.items);
              },
            )
            .catch(
              /** Reports Record Fields failures only while the request still belongs to the mounted view. */
              (reason: unknown) => {
                if (!abort.signal.aborted)
                  setError(
                    reason instanceof Error
                      ? errorMessage(reason)
                      : 'References could not be loaded.',
                  );
              },
            );
        },
        200,
      );
      return /** Cancels the Record Fields request when dependencies change or the view unmounts. */ () => {
        clearTimeout(timer);
        abort.abort();
      };
    },
    [props.field.reference, props.value, query],
  );
  const current = scalarText(props.value ?? '');
  return (
    <div className="reference-field">
      {!props.disabled && (
        <input
          aria-label={`Search ${props.field.label}`}
          placeholder="Search by name…"
          value={query}
          onChange={
            /** Updates Record Fields update Query state from the current control. */
            (e) => {
              setQuery(e.target.value);
            }
          }
        />
      )}
      <select
        id={props.field.key}
        required={props.field.required}
        disabled={props.disabled}
        value={current}
        onChange={
          /** Updates Record Fields interaction state from the current control. */
          (e) => {
            props.onChange(e.target.value || null);
          }
        }
      >
        <option value="">{props.field.required ? 'Choose a record…' : 'None selected'}</option>
        {current &&
          !items.some(
            /** Selects items entries using the explicit item.id current condition. */
            (item) => item.id === current,
          ) && <option value={current}>Current linked record</option>}
        {items.map(
          /** Renders items entries with their stable identifiers and visible labels. */
          (item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ),
        )}
      </select>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}

/** Retains a partially typed comma-separated value until focus leaves the tags editor. */
function TagsInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ResourceFieldConfiguration;
  value: unknown;
  disabled: boolean | undefined;
  onChange: (value: unknown) => void;
}): React.JSX.Element {
  const [text, setText] = useState(Array.isArray(value) ? value.join(', ') : '');
  return (
    <input
      id={field.key}
      disabled={disabled}
      value={text}
      placeholder="Separate values with commas"
      onChange={
        /** Updates Record Fields update Text state from the current control. */
        (event) => {
          setText(event.target.value);
          onChange(
            event.target.value
              .split(',')
              .map(
                /** Transforms event.target.value.split entries into the Record Fields output representation. */
                (item) => item.trim(),
              )
              .filter(Boolean),
          );
        }
      }
    />
  );
}

/** Renders strongly labelled fields with semantic controls and no technical IDs in ordinary user flows. */
export function RecordFields(props: {
  fields: readonly ResourceFieldConfiguration[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const prefix = useId();
  return (
    <div className="form-grid">
      {props.fields.map(
        /** Renders props.fields entries with their stable identifiers and visible labels. */
        (field) => {
          const value = props.values[field.key];
          const controlId =
            prefix +
            field.key; /** Coordinates change within Record Fields, preserving the caller's validation and error handling. */
          const change = (next: unknown): void => {
            props.onChange(field.key, next);
          };
          if (field.type === 'boolean')
            return (
              <label className="check-field" key={field.key}>
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  disabled={props.disabled}
                  onChange={
                    /** Updates Record Fields change state from the current control. */
                    (e) => {
                      change(e.target.checked);
                    }
                  }
                />
                <span>{field.label}</span>
              </label>
            );
          return (
            <div
              className={`field ${['textarea', 'encrypted', 'tags'].includes(field.type ?? '') ? 'field-wide' : ''}`}
              key={field.key}
            >
              <label htmlFor={controlId}>
                {field.label}
                {field.required && <em>Required</em>}
              </label>
              {field.type === 'reference' ? (
                <ReferenceInput
                  field={{ ...field, key: controlId }}
                  value={value}
                  onChange={change}
                  {...(props.disabled ? { disabled: true } : {})}
                />
              ) : field.type === 'select' ? (
                <select
                  id={controlId}
                  value={scalarText(value ?? '')}
                  disabled={props.disabled}
                  required={field.required}
                  onChange={
                    /** Updates Record Fields change state from the current control. */
                    (e) => {
                      change(e.target.value);
                    }
                  }
                >
                  {field.options?.map(
                    /** Renders field.options entries with their stable identifiers and visible labels. */
                    (option) => (
                      <option key={option} value={option}>
                        {option.replaceAll('_', ' ')}
                      </option>
                    ),
                  )}
                </select>
              ) : field.type === 'tags' && field.options ? (
                <div className="filter-chips">
                  {field.options.map(
                    /** Renders field.options entries with their stable identifiers and visible labels. */
                    (option) => (
                      <label key={option}>
                        <input
                          type="checkbox"
                          checked={Array.isArray(value) && value.includes(option)}
                          disabled={props.disabled}
                          onChange={
                            /** Updates Record Fields change state from the current control. */
                            (e) => {
                              change(
                                e.target.checked
                                  ? [...stringValues(value), option]
                                  : (Array.isArray(value) ? value : []).filter(
                                      /** Selects Array.is Array value value entries using the explicit item option condition. */
                                      (item) => item !== option,
                                    ),
                              );
                            }
                          }
                        />
                        {option}
                      </label>
                    ),
                  )}
                </div>
              ) : field.type === 'tags' ? (
                <TagsInput
                  field={{ ...field, key: controlId }}
                  value={value}
                  disabled={props.disabled}
                  onChange={change}
                />
              ) : ['textarea', 'encrypted'].includes(field.type ?? '') ? (
                <textarea
                  id={controlId}
                  required={field.required}
                  disabled={props.disabled}
                  value={typeof value === 'string' ? value : ''}
                  onChange={
                    /** Updates Record Fields change state from the current control. */
                    (e) => {
                      change(e.target.value);
                    }
                  }
                  rows={4}
                />
              ) : (
                <input
                  id={controlId}
                  required={field.required}
                  disabled={props.disabled}
                  min={field.min}
                  max={field.max}
                  step={field.type === 'number' ? 1 : undefined}
                  inputMode={field.type === 'money' ? 'decimal' : undefined}
                  type={
                    ['money', 'tags'].includes(field.type ?? '')
                      ? 'text'
                      : field.type === 'colour'
                        ? 'color'
                        : (field.type ?? 'text')
                  }
                  value={typeof value === 'string' || typeof value === 'number' ? value : ''}
                  placeholder={field.placeholder}
                  onChange={
                    /** Updates Record Fields change state from the current control. */
                    (e) => {
                      change(e.target.value);
                    }
                  }
                />
              )}
              {field.type === 'encrypted' && (
                <small className="field-help">
                  Encrypted in your browser. Access is restricted to authorised care staff.
                </small>
              )}
            </div>
          );
        },
      )}
    </div>
  );
}

import { errorMessage, scalarText } from '@edutex/contracts';

import { stringValues } from '@edutex/contracts';
