/** @fileoverview Personal and group insight dashboards with bounded, permission-filtered visual and timeline builders. */
import { newRecordId } from '../core/record-id.js';
import { useEffect, useState } from 'react';
import { Plus, Save, Copy, ArrowUp, ArrowDown } from 'lucide-react';
import {
  dashboardDefinitionSchema,
  type DashboardDefinition,
  type InsightTile,
} from '@edutex/contracts';
import { apiRequest, jsonBody } from '../core/api.js';
import { useSession } from '../core/session.js';
import { Modal } from '../components/Modal.js';
import { RecordFields } from '../components/RecordFields.js';
interface SavedDashboard {
  id: string;
  owner_user_id: string;
  share_group_id: string | null;
  definition: DashboardDefinition;
  row_version: number;
}
interface MetricResult {
  id: string;
  currencyCode?: string | null;
  title?: string;
  total?: number;
  points?: { date: string; value: number }[];
  error?: string;
  window?: { start: string; end: string };
}
const scopes = [
  'daily',
  'weekly',
  'fortnightly',
  'monthly',
  'quarterly',
  'termly',
  'yearly',
] as const;
const emptyDefinition: DashboardDefinition = {
  title: 'My school dashboard',
  timeline: 'monthly',
  tiles: [],
  search: '',
};

/** Renders a small accurate SVG chart with text values available in its companion table. */
function TileVisual({
  tile,
  result,
}: {
  tile: InsightTile;
  result?: MetricResult | undefined;
}): React.JSX.Element {
  if (result?.error)
    return (
      <p className="form-error" role="status">
        {result.error}
      </p>
    );
  if (!result) return <p className="field-help">Choose Refresh insights to load values.</p>;
  const points = result.points ?? [];
  const upper = Math.max(
    0,
    ...points.map(
      /** Transforms points entries into the Insights Page output representation. */
      (point) => point.value,
    ),
  );
  const lower = Math.min(
    0,
    ...points.map(
      /** Transforms points entries into the Insights Page output representation. */
      (point) => point.value,
    ),
  );
  const range = Math.max(1, upper - lower);
  const baseline = 15 + (upper / range) * 140;
  return (
    <>
      {tile.visual === 'kpi' ? (
        <strong className="insight-number">
          {result.total?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}
        </strong>
      ) : tile.visual === 'table' ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {points.map(
                /** Renders points entries with their stable identifiers and visible labels. */
                (point) => (
                  <tr key={point.date}>
                    <td>{point.date}</td>
                    <td>{point.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <svg
            viewBox="0 0 420 190"
            role="img"
            aria-label={`${tile.title}: ${points
              .map(
                /** Transforms points entries into the Insights Page output representation. */
                (point) => point.date + ' ' + String(point.value),
              )
              .join('; ')}`}
          >
            <line x1="0" y1={baseline} x2="420" y2={baseline} stroke="currentColor" opacity="0.2" />
            {points.map(
              /** Renders points entries with their stable identifiers and visible labels. */
              (point, index) => {
                const width = 400 / Math.max(1, points.length);
                const height = (Math.abs(point.value) / range) * 140;
                return (
                  <g key={point.date}>
                    <rect
                      x={10 + index * width}
                      y={point.value >= 0 ? baseline - height : baseline}
                      width={Math.max(2, width - 4)}
                      height={height}
                      fill="currentColor"
                      opacity="0.8"
                    />
                    <title>
                      {point.date}: {point.value}
                    </title>
                    {(points.length < 9 || index % Math.ceil(points.length / 7) === 0) && (
                      <text x={10 + index * width} y="181" fontSize="10" fill="currentColor">
                        {point.date.slice(5)}
                      </text>
                    )}
                  </g>
                );
              },
            )}
          </svg>
          <details>
            <summary>View data table</summary>
            <div className="table-scroll">
              <table>
                <tbody>
                  {points.map(
                    /** Renders points entries with their stable identifiers and visible labels. */
                    (point) => (
                      <tr key={point.date}>
                        <td>{point.date}</td>
                        <td>{point.value}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      {!points.length && tile.visual !== 'kpi' && (
        <p className="field-help">No permitted records in this period.</p>
      )}
      <small className="field-help">
        {result.currencyCode ? result.currencyCode + ' · ' : ''}
        {result.window?.start} to {result.window?.end} (end exclusive)
      </small>
    </>
  );
}

/** Builds and saves dashboards on the account, with read-only group distribution and per-source reauthorization. */
export function InsightsPage(): React.JSX.Element {
  const { session, hasPermission } = useSession();
  const [saved, setSaved] = useState<SavedDashboard[]>([]);
  const [currentId, setCurrentId] = useState<string>(newRecordId());
  const [rowVersion, setRowVersion] = useState(0);
  const [owner, setOwner] = useState(session.user.id);
  const [definition, setDefinition] = useState<DashboardDefinition>(emptyDefinition);
  const [share, setShare] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<{ source: string; fields: string[] }[]>([]);
  const [results, setResults] = useState<MetricResult[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<InsightTile>();
  const canEdit =
    owner === session.user.id &&
    (hasPermission('insights:edit') ||
      hasPermission('insights:create') ||
      hasPermission('insights:manage'));
  useEffect(
    /** Synchronises Insights Page with its dependencies and cleans up pending work when the view changes. */
    () => {
      const abort = new AbortController();
      void Promise.all([
        apiRequest<{ items: SavedDashboard[] }>('/api/v1/insights/dashboards', {}, abort.signal),
        apiRequest<{ sources: typeof catalogue }>('/api/v1/insights/catalogue', {}, abort.signal),
      ])
        .then(
          /** Applies the completed Insights Page result to the next step or current view state. */
          ([dashboards, sources]) => {
            setSaved(dashboards.items);
            setCatalogue(sources.sources);
            const first = dashboards.items[0];
            if (first) {
              setCurrentId(first.id);
              setRowVersion(first.row_version);
              setOwner(first.owner_user_id);
              setShare(first.share_group_id);
              setDefinition(dashboardDefinitionSchema.parse(first.definition));
            }
          },
        )
        .catch(
          /** Reports Insights Page failures only while the request still belongs to the mounted view. */
          (reason: unknown) => {
            if (!abort.signal.aborted)
              setError(
                reason instanceof Error ? errorMessage(reason) : 'Insights could not be loaded.',
              );
          },
        );
      return /** Cancels the Insights Page request when dependencies change or the view unmounts. */ () => {
        abort.abort();
      };
    },
    [],
  );
  /** Coordinates evaluate within Insights Page, preserving the caller's validation and error handling. */
  const evaluate = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const data = await apiRequest<{ items: MetricResult[] }>('/api/v1/insights/evaluate', {
        method: 'POST',
        ...jsonBody({
          tiles: definition.tiles.map(
            /** Transforms definition.tiles entries into the Insights Page output representation. */
            (tile) => ({ ...tile, search: definition.search || tile.search }),
          ),
          timeline: definition.timeline,
        }),
      });
      setResults(data.items);
    } catch (reason) {
      setError(reason instanceof Error ? errorMessage(reason) : 'Insights could not be refreshed.');
    } finally {
      setBusy(false);
    }
  };
  /** Coordinates save within Insights Page, preserving the caller's validation and error handling. */
  const save = async (): Promise<void> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const parsed = dashboardDefinitionSchema.parse(definition);
      const response = await apiRequest<{ rowVersion: number }>(
        `/api/v1/insights/dashboards/${currentId}`,
        { method: 'PUT', ...jsonBody({ definition: parsed, shareGroupId: share, rowVersion }) },
      );
      setRowVersion(response.rowVersion);
      setSaved(
        /** Coordinates Insights Page within Insights Page, preserving the caller's validation and error handling. */
        (items) => [
          {
            id: currentId,
            row_version: response.rowVersion,
            owner_user_id: session.user.id,
            share_group_id: share,
            definition: parsed,
          },
          ...items.filter(
            /** Selects items entries using the explicit item.id current Id condition. */
            (item) => item.id !== currentId,
          ),
        ],
      );
      setNotice('Dashboard saved to your account.');
    } catch (reason) {
      setError(
        reason instanceof Error ? errorMessage(reason) : 'The dashboard could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  };
  /** Coordinates add within Insights Page, preserving the caller's validation and error handling. */
  const add = (): void => {
    const source = catalogue[0];
    if (source)
      setEditing({
        id: newRecordId(),
        title: 'New insight',
        currencyCode: 'AUD',
        visual: 'kpi',
        colour: 'blue',
        timeline: 'interchangeable',
        terms: [
          {
            source: source.source as InsightTile['terms'][number]['source'],
            field: requiredValue(source.fields[0]),
          },
        ],
        status: [],
        search: '',
      });
  };
  /** Coordinates move within Insights Page, preserving the caller's validation and error handling. */
  const move = (id: string, delta: number): void => {
    setDefinition(
      /** Coordinates required Value within Insights Page, preserving the caller's validation and error handling. */
      (value) => {
        const tiles = [...value.tiles];
        const index = tiles.findIndex(
          /** Coordinates Insights Page within Insights Page, preserving the caller's validation and error handling. */
          (tile) => tile.id === id,
        );
        const next = index + delta;
        if (next < 0 || next >= tiles.length) return value;
        [tiles[index], tiles[next]] = [requiredValue(tiles[next]), requiredValue(tiles[index])];
        return { ...value, tiles };
      },
    );
  };
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Insights</p>
          <h1>{definition.title}</h1>
          <p>Build a view from the school data your role can access.</p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="button-secondary"
            onClick={
              /** Handles Insights Page update Current Id state from the current control. */
              () => {
                setCurrentId(newRecordId());
                setOwner(session.user.id);
                setRowVersion(0);
                setShare(null);
                setDefinition({ ...definition, title: definition.title + ' (copy)' });
                setNotice('New personal copy. Save when ready.');
              }
            }
          >
            <Copy size={16} />
            Personal copy
          </button>
          {canEdit && (
            <button
              className="button-primary"
              type="button"
              disabled={busy}
              onClick={
                /** Handles Insights Page save state from the current control. */
                () => void save()
              }
            >
              <Save size={16} />
              Save dashboard
            </button>
          )}
        </div>
      </div>
      <article className="panel">
        <div className="inline-fields">
          <label className="field">
            Saved dashboard
            <select
              value={
                saved.some(
                  /** Selects saved entries using the explicit item.id current Id condition. */
                  (item) => item.id === currentId,
                )
                  ? currentId
                  : ''
              }
              onChange={
                /** Updates Insights Page update Current Id state from the current control. */
                (e) => {
                  const item = saved.find(
                    /** Selects saved entries using the explicit d.id e.target.value condition. */
                    (d) => d.id === e.target.value,
                  );
                  if (item) {
                    setCurrentId(item.id);
                    setOwner(item.owner_user_id);
                    setRowVersion(item.row_version);
                    setShare(item.share_group_id);
                    setDefinition(item.definition);
                    setResults([]);
                  }
                }
              }
            >
              <option value="">Unsaved dashboard</option>
              {saved.map(
                /** Renders saved entries with their stable identifiers and visible labels. */
                (item) => (
                  <option value={item.id} key={item.id}>
                    {item.definition.title}
                    {item.owner_user_id !== session.user.id ? ' · Shared' : ''}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="field">
            Interchangeable timeline
            <select
              value={definition.timeline}
              onChange={
                /** Updates Insights Page update Definition state from the current control. */
                (e) => {
                  setDefinition(
                    /** Coordinates Insights Page within Insights Page, preserving the caller's validation and error handling. */
                    (value) => ({
                      ...value,
                      timeline: e.target.value as DashboardDefinition['timeline'],
                    }),
                  );
                }
              }
            >
              {scopes.map(
                /** Renders scopes entries with their stable identifiers and visible labels. */
                (scope) => (
                  <option key={scope} value={scope}>
                    {scope}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="field">
            Smart search
            <input
              value={definition.search}
              placeholder="Filter permitted source labels…"
              onChange={
                /** Updates Insights Page update Definition state from the current control. */
                (e) => {
                  setDefinition(
                    /** Coordinates Insights Page within Insights Page, preserving the caller's validation and error handling. */
                    (value) => ({ ...value, search: e.target.value }),
                  );
                }
              }
            />
          </label>
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={
              /** Handles Insights Page evaluate state from the current control. */
              () => void evaluate()
            }
          >
            {busy ? 'Working…' : 'Refresh insights'}
          </button>
        </div>
        {canEdit && (
          <details className="mt-5">
            <summary>Dashboard name & group distribution</summary>
            <div className="mt-4">
              <RecordFields
                fields={[
                  { key: 'title', label: 'Dashboard name', required: true },
                  {
                    key: 'share',
                    label: 'Publish to a group you manage',
                    type: 'reference',
                    reference: 'school-groups',
                  },
                ]}
                values={{ title: definition.title, share }}
                onChange={
                  /** Updates Insights Page update Definition state from the current control. */
                  (key, value) => {
                    if (key === 'title')
                      setDefinition(
                        /** Coordinates scalar Text within Insights Page, preserving the caller's validation and error handling. */
                        (current) => ({ ...current, title: scalarText(value) }),
                      );
                    else setShare(value ? scalarText(value) : null);
                  }
                }
              />
            </div>
          </details>
        )}
      </article>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="field-help">
          {notice}
        </p>
      )}
      <div className="workflow-grid">
        {definition.tiles.map(
          /** Renders definition.tiles entries with their stable identifiers and visible labels. */
          (tile) => (
            <article className={'builder-card tile-' + tile.colour} key={tile.id}>
              <div className="panel-heading">
                <h2>{tile.title}</h2>
                {canEdit && (
                  <button
                    type="button"
                    className="text-action"
                    onClick={
                      /** Handles Insights Page update Editing state from the current control. */
                      () => {
                        setEditing(tile);
                      }
                    }
                  >
                    Edit tile
                  </button>
                )}
              </div>
              <TileVisual
                tile={tile}
                result={results.find(
                  /** Selects results entries using the explicit result.id tile.id condition. */
                  (result) => result.id === tile.id,
                )}
              />
              {canEdit && (
                <div className="heading-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={'Move ' + tile.title + ' earlier'}
                    onClick={
                      /** Handles Insights Page move state from the current control. */
                      () => {
                        move(tile.id, -1);
                      }
                    }
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={'Move ' + tile.title + ' later'}
                    onClick={
                      /** Handles Insights Page move state from the current control. */
                      () => {
                        move(tile.id, 1);
                      }
                    }
                  >
                    <ArrowDown size={16} />
                  </button>
                </div>
              )}
            </article>
          ),
        )}
        {canEdit && (
          <button
            type="button"
            className="builder-card"
            disabled={!catalogue.length || definition.tiles.length >= 30}
            onClick={add}
          >
            <Plus size={22} />
            <strong>Add an insight</strong>
            <span className="field-help">KPI, bar chart or data table</span>
          </button>
        )}
      </div>
      {editing && (
        <Modal
          title="Configure insight"
          onClose={
            /** Handles Insights Page update Editing state from the current control. */
            () => {
              setEditing(undefined);
            }
          }
        >
          <RecordFields
            fields={[
              { key: 'title', label: 'Tile title', required: true },
              { key: 'visual', label: 'Visual', type: 'select', options: ['kpi', 'bar', 'table'] },
              {
                key: 'currencyCode',
                label: 'Currency for financial metrics (ISO code)',
                required: true,
              },
              {
                key: 'colour',
                label: 'Colour',
                type: 'select',
                options: ['blue', 'green', 'purple', 'amber', 'red'],
              },
              {
                key: 'timeline',
                label: 'Timeline',
                type: 'select',
                options: ['interchangeable', ...scopes],
              },
              { key: 'status', label: 'Include statuses (empty means all)', type: 'tags' },
              { key: 'search', label: 'Tile search' },
            ]}
            values={editing}
            onChange={
              /** Updates Insights Page update Editing state from the current control. */
              (key, value) => {
                setEditing({ ...editing, [key]: value });
              }
            }
          />
          <h3 className="mt-5 mb-3 font-semibold">Combine permitted metrics</h3>
          <div className="smart-flow">
            {editing.terms.map(
              /** Renders editing.terms entries with their stable identifiers and visible labels. */
              (term, index) => (
                <div className="inline-fields" key={index}>
                  <label className="field">
                    Dataset
                    <select
                      value={term.source}
                      onChange={
                        /** Updates Insights Page required Value state from the current control. */
                        (e) => {
                          const source = requiredValue(
                            catalogue.find(
                              /** Selects catalogue entries using the explicit item.source e.target.value condition. */
                              (item) => item.source === e.target.value,
                            ),
                          );
                          setEditing({
                            ...editing,
                            terms: editing.terms.map(
                              /** Transforms editing.terms entries into the Insights Page output representation. */
                              (item, i) =>
                                i === index
                                  ? {
                                      source: source.source as typeof term.source,
                                      field: requiredValue(source.fields[0]),
                                    }
                                  : item,
                            ),
                          });
                        }
                      }
                    >
                      {catalogue.map(
                        /** Renders catalogue entries with their stable identifiers and visible labels. */
                        (source) => (
                          <option key={source.source} value={source.source}>
                            {source.source}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label className="field">
                    Field
                    <select
                      value={term.field}
                      onChange={
                        /** Updates Insights Page update Editing state from the current control. */
                        (e) => {
                          setEditing({
                            ...editing,
                            terms: editing.terms.map(
                              /** Transforms editing.terms entries into the Insights Page output representation. */
                              (item, i) =>
                                i === index ? { ...item, field: e.target.value } : item,
                            ),
                          });
                        }
                      }
                    >
                      {catalogue
                        .find(
                          /** Selects catalogue entries using the explicit source.source term.source condition. */
                          (source) => source.source === term.source,
                        )
                        ?.fields.map(
                          /** Renders catalogue.find source source.source term.source .fields entries with their stable identifiers and visible labels. */
                          (field) => (
                            <option key={field} value={field}>
                              {field}
                            </option>
                          ),
                        )}
                    </select>
                  </label>
                  {editing.terms.length > 1 && (
                    <button
                      type="button"
                      className="text-action"
                      onClick={
                        /** Handles Insights Page update Editing state from the current control. */
                        () => {
                          setEditing({
                            ...editing,
                            terms: editing.terms.filter(
                              /** Selects editing.terms entries using the explicit i index condition. */
                              (_, i) => i !== index,
                            ),
                          });
                        }
                      }
                    >
                      Remove metric
                    </button>
                  )}
                </div>
              ),
            )}
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="text-action"
              onClick={
                /** Handles Insights Page update Definition state from the current control. */
                () => {
                  setDefinition(
                    /** Coordinates Insights Page within Insights Page, preserving the caller's validation and error handling. */
                    (value) => ({
                      ...value,
                      tiles: value.tiles.filter(
                        /** Selects value.tiles entries using the explicit tile.id editing.id condition. */
                        (tile) => tile.id !== editing.id,
                      ),
                    }),
                  );
                  setEditing(undefined);
                }
              }
            >
              Remove tile
            </button>
            <button
              type="button"
              className="button-secondary"
              disabled={editing.terms.length >= 8}
              onClick={
                /** Handles Insights Page update Editing state from the current control. */
                () => {
                  setEditing({
                    ...editing,
                    terms: [...editing.terms, { ...requiredValue(editing.terms[0]) }],
                  });
                }
              }
            >
              Add another metric
            </button>
            <button
              type="button"
              className="button-primary"
              onClick={
                /** Handles Insights Page update Definition state from the current control. */
                () => {
                  setDefinition(
                    /** Coordinates Insights Page within Insights Page, preserving the caller's validation and error handling. */
                    (value) => ({
                      ...value,
                      tiles: value.tiles.some(
                        /** Selects value.tiles entries using the explicit tile.id editing.id condition. */
                        (tile) => tile.id === editing.id,
                      )
                        ? value.tiles.map(
                            /** Transforms value.tiles entries into the Insights Page output representation. */
                            (tile) => (tile.id === editing.id ? editing : tile),
                          )
                        : [...value.tiles, editing],
                    }),
                  );
                  setEditing(undefined);
                }
              }
            >
              Apply tile
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

import { requiredValue } from '@edutex/contracts';

import { errorMessage, scalarText } from '@edutex/contracts';
