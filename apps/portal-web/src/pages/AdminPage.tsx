/**
 * @fileoverview Implements the protected AdminPage React feature, linking session-authorised UI state to same-origin Edutex API contracts.
 *
 * @remarks
 * Direct links: `@edutex/contracts`, `lucide-react`, `react`, `../components/PageStates.js`, `../components/Modal.js`, `../components/navigation.js`, `../core/api.js`, `../core/session.js`, `/api/v1/admin/authentication`, `/api/v1/admin/authentication/policy`, `/api/v1/admin/identity-providers`, `/api/v1/admin/modules`, `/api/v1/admin/directory-role-mappings`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import type { ModuleId } from '@edutex/contracts';
import {
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Network,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { PageError, PageLoading } from '../components/PageStates.js';
import { Modal } from '../components/Modal.js';
import { navigationItems } from '../components/navigation.js';
import { apiRequest, jsonBody } from '../core/api.js';
import { useSession } from '../core/session.js';

interface AuthenticationConfiguration {
  readonly policy: {
    passwordEnabled: boolean;
    passkeyEnabled: boolean;
    totpMode: 'disabled' | 'optional' | 'required_for_password';
    microsoftEnabled: boolean;
    googleEnabled: boolean;
    samlEnabled: boolean;
    sessionIdleMinutes: number;
    sessionAbsoluteHours: number;
    stepUpMinutes: number;
    rowVersion: number;
  };
  readonly providers: readonly {
    readonly id: string;
    readonly providerKey: string;
    readonly providerType: string;
    readonly displayName: string;
    readonly buttonLabel: string;
    readonly enabled: boolean;
    readonly rowVersion: number;
  }[];
  readonly roleMappings: readonly {
    readonly id: string;
    readonly identityProviderId: string;
    readonly claimName: string;
    readonly claimValue: string;
    readonly roleId: string;
    readonly userCategory:
      | 'student'
      | 'teacher'
      | 'corporate_staff'
      | 'it_staff'
      | 'executive_staff'
      | 'parent_guardian'
      | 'contractor';
    readonly priority: number;
  }[];
  readonly roles: readonly { readonly id: string; readonly name: string }[];
  readonly modules: readonly {
    readonly key: ModuleId;
    readonly enabled: boolean;
    readonly displayOrder: number;
    readonly rowVersion: number;
  }[];
}

interface ProviderDraft {
  readonly providerKey: string;
  readonly providerType: 'microsoft' | 'google' | 'oidc' | 'saml';
  readonly displayName: string;
  readonly buttonLabel: string;
  readonly issuerUrl: string;
  readonly metadataUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes: string;
  readonly attributeMapping: string;
}

const emptyProvider: ProviderDraft = {
  providerKey: 'microsoft',
  providerType: 'microsoft',
  displayName: 'Microsoft Entra ID',
  buttonLabel: 'Continue with Microsoft',
  issuerUrl: '',
  metadataUrl: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid email profile',
  attributeMapping: '{\n  "email": "email",\n  "name": "name"\n}',
};

/** Parses the administrator's mapping draft and rejects arrays/non-string claim destinations. */
function parseAttributeMapping(value: string): Record<string, string> {
  const parsed: unknown = JSON.parse(value);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every(
      /** Requires every input item to satisfy this validation condition before `parseAttributeMapping` can continue. It receives `entry`. It uses only the local values shown in its body. */ (
        entry,
      ) => typeof entry === 'string',
    )
  ) {
    throw new Error('Attribute mapping must be a JSON object containing string values.');
  }
  return parsed as Record<string, string>;
}

/** Renders a labelled, accessible policy switch with an explicit disabled state. */
function PolicyToggle(props: {
  readonly checked: boolean;
  readonly label: string;
  readonly detail: string;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
}): React.JSX.Element {
  return (
    <label className="policy-toggle">
      <span>
        <strong>{props.label}</strong>
        <small>{props.detail}</small>
      </span>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={
          /** Handles the React `onChange` event inside `PolicyToggle`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `props.onChange`. */ (
            event,
          ) => {
            props.onChange(event.target.checked);
          }
        }
      />
      <span className="toggle-track">
        <span />
      </span>
    </label>
  );
}

/** Exposes tenant-owned authentication choices while keeping IdP secrets server-side. */
export function AdminPage(): React.JSX.Element {
  const { hasPermission } = useSession();
  const [configuration, setConfiguration] = useState<AuthenticationConfiguration>();
  const [draft, setDraft] = useState<AuthenticationConfiguration['policy']>();
  const [moduleDraft, setModuleDraft] = useState<AuthenticationConfiguration['modules']>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(emptyProvider);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingDraft, setMappingDraft] = useState({
    identityProviderId: '',
    claimName: 'groups',
    claimValue: '',
    roleId: '',
    userCategory: 'student',
    priority: 100,
  });
  const [version, setVersion] = useState(0);
  const load = useCallback(
    /** Keeps the `AdminPage` callback identity stable for React effects/children while still using the declared dependencies. It receives `signal`. Direct links: `setError`, `apiRequest<AuthenticationConfiguration>('/api`, `apiRequest`. */ (
      signal: AbortSignal,
    ) => {
      setError(undefined);
      void apiRequest<AuthenticationConfiguration>('/api/v1/admin/authentication', {}, signal)
        .then(
          /** Performs the local `apiRequest<AuthenticationConfiguration>('/api/v1/admin/authe` operation inside `AdminPage` and returns control to the surrounding feature only after this body completes. It receives `value`. Direct links: `setConfiguration`, `setDraft`, `setModuleDraft`. */ (
            value,
          ) => {
            setConfiguration(value);
            setDraft(value.policy);
            setModuleDraft(value.modules);
          },
        )
        .catch(
          /** Performs the local `apiRequest<AuthenticationConfiguration>('/api/v1/admin/authe` operation inside `AdminPage` and returns control to the surrounding feature only after this body completes. It receives `reason`. Direct links: `setError`. */ (
            reason: unknown,
          ) => {
            if (!signal.aborted)
              setError(
                reason instanceof Error ? errorMessage(reason) : 'Settings could not be loaded.',
              );
          },
        );
    },
    [],
  );
  useEffect(
    /** Synchronises `AdminPage` with browser/API state after the declared React dependencies change and returns any required cleanup. Direct links: `load`. */ () => {
      const controller = new AbortController();
      load(controller.signal);
      return /** Performs the local `callback` operation inside `AdminPage` and returns control to the surrounding feature only after this body completes. Direct links: `controller.abort`. */ () => {
        controller.abort();
      };
    },
    [load, version],
  );

  /** Persists the versioned authentication policy; the API applies Cognito policy before database state. */
  const save = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await apiRequest<{ rowVersion: number }>(
        '/api/v1/admin/authentication/policy',
        { method: 'PUT', ...jsonBody(draft) },
      );
      setDraft({ ...draft, rowVersion: result.rowVersion });
      setMessage('Authentication policy saved. New sign-in attempts use this policy immediately.');
    } catch (reason) {
      setError(reason instanceof Error ? errorMessage(reason) : 'The policy could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  /** Submits a validated federation provider while allowing the API to vault any client secret. */
  const createProvider = async (): Promise<void> => {
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await apiRequest('/api/v1/admin/identity-providers', {
        method: 'POST',
        ...jsonBody({
          ...providerDraft,
          issuerUrl: providerDraft.issuerUrl || undefined,
          metadataUrl: providerDraft.metadataUrl || undefined,
          clientId: providerDraft.clientId || undefined,
          clientSecret: providerDraft.clientSecret || undefined,
          scopes: providerDraft.scopes.split(/\s+/).filter(Boolean),
          attributeMapping: parseAttributeMapping(providerDraft.attributeMapping),
        }),
      });
      setProviderOpen(false);
      setProviderDraft(emptyProvider);
      setMessage(
        'Identity provider staged as disabled. Add an approved mapping and complete testing before enabling it.',
      );
      setVersion(
        /** Derives the next immutable React state for `createProvider` from the previous value supplied by the state setter. It receives `value`. It uses only the local values shown in its body. */ (
          value,
        ) => value + 1,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? errorMessage(reason) : 'The provider could not be configured.',
      );
    } finally {
      setSaving(false);
    }
  };

  /** Explicitly publishes or withdraws a staged provider with optimistic concurrency control. */
  const setProviderEnabled = async (
    provider: AuthenticationConfiguration['providers'][number],
    enabled: boolean,
  ): Promise<void> => {
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await apiRequest(`/api/v1/admin/identity-providers/${provider.id}/status`, {
        method: 'PUT',
        ...jsonBody({ enabled, rowVersion: provider.rowVersion }),
      });
      setMessage(
        enabled
          ? 'Identity provider enabled. Its approved sign-in option is now available.'
          : 'Identity provider disabled. New sign-in attempts can no longer use it.',
      );
      setVersion(
        /** Derives the next immutable React state for `setProviderEnabled` from the previous value supplied by the state setter. It receives `value`. It uses only the local values shown in its body. */ (
          value,
        ) => value + 1,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? errorMessage(reason) : 'Provider status could not be changed.',
      );
    } finally {
      setSaving(false);
    }
  };

  /** Saves tenant home-screen module visibility; server permissions remain authoritative. */
  const saveModules = async (): Promise<void> => {
    if (!moduleDraft) return;
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await apiRequest('/api/v1/admin/modules', {
        method: 'PUT',
        ...jsonBody({ modules: moduleDraft }),
      });
      setMessage('Home-screen modules saved. Active sessions refresh this setting automatically.');
      setVersion(
        /** Derives the next immutable React state for `saveModules` from the previous value supplied by the state setter. It receives `value`. It uses only the local values shown in its body. */ (
          value,
        ) => value + 1,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? errorMessage(reason) : 'Module visibility could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  /** Creates one provider-scoped directory-claim mapping that takes effect on the next sign-in. */
  const createMapping = async (): Promise<void> => {
    setSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await apiRequest('/api/v1/admin/directory-role-mappings', {
        method: 'POST',
        ...jsonBody(mappingDraft),
      });
      setMappingOpen(false);
      setMessage('Directory claim mapping added. It applies on the user’s next sign-in.');
      setVersion(
        /** Derives the next immutable React state for `createMapping` from the previous value supplied by the state setter. It receives `value`. It uses only the local values shown in its body. */ (
          value,
        ) => value + 1,
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? errorMessage(reason) : 'The mapping could not be created.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (error && !draft)
    return (
      <PageError
        message={error}
        retry={
          /** Handles the React `retry` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setVersion`. */ () => {
            setVersion(
              /** Derives the next immutable React state for `AdminPage` from the previous value supplied by the state setter. It receives `value`. It uses only the local values shown in its body. */ (
                value,
              ) => value + 1,
            );
          }
        }
      />
    );
  if (!configuration || !draft || !moduleDraft) return <PageLoading />;
  const canManage = hasPermission('admin:manage');
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Governance</p>
          <h1>Administration</h1>
          <p>School-controlled sign-in, directory mapping and session security.</p>
        </div>
        {canManage ? (
          <button
            className="button-primary"
            type="button"
            onClick={
              /** Handles the React `onClick` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `save`. */ () =>
                void save()
            }
            disabled={saving}
          >
            <Save size={16} /> {saving ? 'Saving…' : 'Save policy'}
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="success-message" role="status">
          <CheckCircle2 size={17} /> {message}
        </div>
      ) : null}
      <div className="admin-grid">
        <article className="panel admin-section">
          <div className="panel-heading">
            <div>
              <p className="panel-eyebrow">Authentication</p>
              <h2>Allowed sign-in methods</h2>
              <p>Only selected choices appear on your school sign-in page.</p>
            </div>
            <Fingerprint className="text-brand-600" size={23} />
          </div>
          <div className="policy-list">
            <PolicyToggle
              checked={draft.passkeyEnabled}
              onChange={
                /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `checked`. Direct links: `setDraft`. */ (
                  checked,
                ) => {
                  setDraft({ ...draft, passkeyEnabled: checked });
                }
              }
              label="Passkeys"
              detail="Phishing-resistant WebAuthn credentials"
            />
            <PolicyToggle
              checked={draft.passwordEnabled}
              onChange={
                /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `checked`. Direct links: `setDraft`. */ (
                  checked,
                ) => {
                  setDraft({
                    ...draft,
                    passwordEnabled: checked,
                    ...(checked ? { totpMode: 'required_for_password' } : {}),
                  });
                }
              }
              label="Username and password"
              detail="Cognito-managed credentials and recovery"
            />
            <PolicyToggle
              checked={draft.microsoftEnabled}
              onChange={
                /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `checked`. Direct links: `setDraft`. */ (
                  checked,
                ) => {
                  setDraft({ ...draft, microsoftEnabled: checked });
                }
              }
              label="Microsoft Entra ID"
              detail="School directory federation"
            />
            <PolicyToggle
              checked={draft.googleEnabled}
              onChange={
                /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `checked`. Direct links: `setDraft`. */ (
                  checked,
                ) => {
                  setDraft({ ...draft, googleEnabled: checked });
                }
              }
              label="Google Workspace"
              detail="Managed Google identities"
            />
            <PolicyToggle
              checked={draft.samlEnabled}
              onChange={
                /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `checked`. Direct links: `setDraft`. */ (
                  checked,
                ) => {
                  setDraft({ ...draft, samlEnabled: checked });
                }
              }
              label="SAML 2.0"
              detail="Compatible enterprise identity providers"
            />
          </div>
          <label className="field mt-5">
            <span>Authenticator policy</span>
            <select
              value={draft.totpMode}
              disabled={draft.passwordEnabled}
              onChange={
                /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setDraft`. */ (
                  event,
                ) => {
                  setDraft({
                    ...draft,
                    totpMode: event.target
                      .value as AuthenticationConfiguration['policy']['totpMode'],
                  });
                }
              }
            >
              <option value="required_for_password">Required for password sign-in</option>
              <option value="optional">Optional when password is disabled</option>
              <option value="disabled">Disabled when password is disabled</option>
            </select>
          </label>
        </article>

        <article className="panel admin-section">
          <div className="panel-heading">
            <div>
              <p className="panel-eyebrow">Sessions</p>
              <h2>Device security</h2>
              <p>Balance assurance with the rhythm of the school day.</p>
            </div>
            <ShieldCheck className="text-emerald-600" size={23} />
          </div>
          <div className="form-grid one-column">
            <label className="field">
              <span>
                Idle timeout <em>minutes</em>
              </span>
              <input
                type="number"
                min={5}
                max={240}
                value={draft.sessionIdleMinutes}
                onChange={
                  /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setDraft`, `Number`. */ (
                    event,
                  ) => {
                    setDraft({ ...draft, sessionIdleMinutes: Number(event.target.value) });
                  }
                }
              />
            </label>
            <label className="field">
              <span>
                Absolute lifetime <em>hours</em>
              </span>
              <input
                type="number"
                min={1}
                max={72}
                value={draft.sessionAbsoluteHours}
                onChange={
                  /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setDraft`, `Number`. */ (
                    event,
                  ) => {
                    setDraft({ ...draft, sessionAbsoluteHours: Number(event.target.value) });
                  }
                }
              />
            </label>
            <label className="field">
              <span>
                Recent MFA window <em>minutes</em>
              </span>
              <input
                type="number"
                min={1}
                max={60}
                value={draft.stepUpMinutes}
                onChange={
                  /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setDraft`, `Number`. */ (
                    event,
                  ) => {
                    setDraft({ ...draft, stepUpMinutes: Number(event.target.value) });
                  }
                }
              />
            </label>
          </div>
          <div className="security-explainer">
            <KeyRound size={18} />
            <p>
              <strong>Every browser has a separate opaque session.</strong>
              <span>
                Signing out here revokes this device without sharing tokens or state with another
                client.
              </span>
            </p>
          </div>
        </article>
      </div>

      <article className="panel admin-section">
        <div className="panel-heading">
          <div>
            <p className="panel-eyebrow">Home screen</p>
            <h2>Visible modules</h2>
            <p>Choose which permitted modules appear across desktop, mobile and search.</p>
          </div>
          {canManage ? (
            <button
              className="button-secondary"
              type="button"
              disabled={saving}
              onClick={
                /** Handles the React `onClick` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `saveModules`. */ () =>
                  void saveModules()
              }
            >
              <Save size={16} /> Save modules
            </button>
          ) : null}
        </div>
        <div className="module-toggle-grid">
          {moduleDraft.map(
            /** Transforms each input item for `AdminPage` into the derived value or React element consumed by the surrounding collection. It receives `module`. Direct links: `navigationItems.find`, `module.key.replaceAll`. */ (
              module,
            ) => {
              const navigation = navigationItems.find(
                /** Selects the first input item matching this lookup condition for `AdminPage`; no match deliberately returns undefined. It receives `item`. It uses only the local values shown in its body. */ (
                  item,
                ) => item.path === module.key,
              );
              const required = module.key === 'dashboard' || module.key === 'admin';
              return (
                <PolicyToggle
                  key={module.key}
                  checked={module.enabled}
                  disabled={required || !canManage}
                  label={navigation?.label ?? module.key.replaceAll('-', ' ')}
                  detail={required ? 'Required platform module' : 'Available to permitted roles'}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `enabled`. Direct links: `setModuleDraft`, `moduleDraft.map`. */ (
                      enabled,
                    ) => {
                      setModuleDraft(
                        moduleDraft.map(
                          /** Transforms each input item for `AdminPage` into the derived value or React element consumed by the surrounding collection. It receives `item`. It uses only the local values shown in its body. */ (
                            item,
                          ) => (item.key === module.key ? { ...item, enabled } : item),
                        ),
                      );
                    }
                  }
                />
              );
            },
          )}
        </div>
      </article>

      <article className="panel admin-section">
        <div className="panel-heading">
          <div>
            <p className="panel-eyebrow">Federation</p>
            <h2>Connected identity providers</h2>
            <p>Secrets are retained in AWS Secrets Manager and are never returned here.</p>
          </div>
          {canManage ? (
            <button
              className="button-secondary"
              type="button"
              onClick={
                /** Handles the React `onClick` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setProviderOpen`. */ () => {
                  setProviderOpen(true);
                }
              }
            >
              <Network size={16} /> Add provider
            </button>
          ) : null}
        </div>
        {configuration.providers.length === 0 ? (
          <div className="provider-empty">
            <Network size={23} />
            <div>
              <strong>No external providers configured</strong>
              <p>
                Add Microsoft Entra ID, Google Workspace, OIDC or SAML through the controlled
                onboarding workflow.
              </p>
            </div>
          </div>
        ) : (
          <div className="provider-list">
            {configuration.providers.map(
              /** Transforms each input item for `AdminPage` into the derived value or React element consumed by the surrounding collection. It receives `provider`. Direct links: `provider.providerType.toUpperCase`. */ (
                provider,
              ) => (
                <div className="provider-row" key={provider.id}>
                  <span className="provider-icon">
                    <Network size={18} />
                  </span>
                  <div>
                    <strong>{provider.displayName}</strong>
                    <small>
                      {provider.providerType.toUpperCase()} · {provider.providerKey}
                    </small>
                  </div>
                  <span
                    className={
                      provider.enabled ? 'status-pill status-active' : 'status-pill status-disabled'
                    }
                  >
                    {provider.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  {canManage ? (
                    <button
                      className="button-secondary"
                      type="button"
                      disabled={saving}
                      onClick={
                        /** Handles the React `onClick` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setProviderEnabled`. */ () =>
                          void setProviderEnabled(provider, !provider.enabled)
                      }
                    >
                      {provider.enabled ? 'Disable' : 'Enable'}
                    </button>
                  ) : null}
                </div>
              ),
            )}
          </div>
        )}
        <button
          className="refresh-link"
          type="button"
          onClick={
            /** Handles the React `onClick` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setVersion`. */ () => {
              setVersion(
                /** Derives the next immutable React state for `AdminPage` from the previous value supplied by the state setter. It receives `value`. It uses only the local values shown in its body. */ (
                  value,
                ) => value + 1,
              );
            }
          }
        >
          <RefreshCw size={14} /> Refresh provider status
        </button>
      </article>

      <article className="panel admin-section">
        <div className="panel-heading">
          <div>
            <p className="panel-eyebrow">Directory authorisation</p>
            <h2>Claim-to-role mappings</h2>
            <p>Map verified directory claims to an Edutex role and staff or student category.</p>
          </div>
          {canManage ? (
            <button
              className="button-secondary"
              type="button"
              disabled={configuration.providers.length === 0 || configuration.roles.length === 0}
              onClick={
                /** Handles the React `onClick` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setMappingDraft`, `setMappingOpen`. */ () => {
                  setMappingDraft({
                    ...mappingDraft,
                    identityProviderId: configuration.providers[0]?.id ?? '',
                    roleId: configuration.roles[0]?.id ?? '',
                  });
                  setMappingOpen(true);
                }
              }
            >
              <Network size={16} /> Add mapping
            </button>
          ) : null}
        </div>
        {configuration.roleMappings.length === 0 ? (
          <div className="provider-empty">
            <ShieldCheck size={23} />
            <div>
              <strong>No directory mappings configured</strong>
              <p>Users remain least-privileged until a verified claim matches an approved rule.</p>
            </div>
          </div>
        ) : (
          <div className="provider-list">
            {configuration.roleMappings.map(
              /** Transforms each input item for `AdminPage` into the derived value or React element consumed by the surrounding collection. It receives `mapping`. Direct links: `configuration.roles.find`, `mapping.userCategory.replaceAll`. */ (
                mapping,
              ) => (
                <div className="provider-row" key={mapping.id}>
                  <span className="provider-icon">
                    <ShieldCheck size={18} />
                  </span>
                  <div>
                    <strong>
                      {mapping.claimName} = {mapping.claimValue}
                    </strong>
                    <small>
                      {configuration.roles.find(
                        /** Selects the first input item matching this lookup condition for `AdminPage`; no match deliberately returns undefined. It receives `role`. It uses only the local values shown in its body. */ (
                          role,
                        ) => role.id === mapping.roleId,
                      )?.name ?? 'Unknown role'}{' '}
                      · {mapping.userCategory.replaceAll('_', ' ')} · priority {mapping.priority}
                    </small>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </article>

      {providerOpen ? (
        <Modal
          title="Add identity provider"
          description="Credentials go directly to AWS and are never returned to the browser."
          onClose={
            /** Handles the React `onClose` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setProviderOpen`. */ () => {
              setProviderOpen(false);
            }
          }
        >
          <form
            onSubmit={
              /** Handles the React `onSubmit` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `event.preventDefault`, `createProvider`. */ (
                event,
              ) => {
                event.preventDefault();
                void createProvider();
              }
            }
          >
            <div className="form-grid">
              <label className="field">
                <span>Provider type</span>
                <select
                  value={providerDraft.providerType}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setProviderDraft`. */ (
                      event,
                    ) => {
                      setProviderDraft({
                        ...providerDraft,
                        providerType: event.target.value as ProviderDraft['providerType'],
                      });
                    }
                  }
                >
                  <option value="microsoft">Microsoft Entra ID</option>
                  <option value="google">Google Workspace</option>
                  <option value="oidc">OpenID Connect</option>
                  <option value="saml">SAML 2.0</option>
                </select>
              </label>
              <label className="field">
                <span>Provider key</span>
                <input
                  required
                  pattern="[a-z][a-z0-9-]{1,40}"
                  value={providerDraft.providerKey}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setProviderDraft`. */ (
                      event,
                    ) => {
                      setProviderDraft({ ...providerDraft, providerKey: event.target.value });
                    }
                  }
                />
              </label>
              <label className="field">
                <span>Display name</span>
                <input
                  required
                  value={providerDraft.displayName}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setProviderDraft`. */ (
                      event,
                    ) => {
                      setProviderDraft({ ...providerDraft, displayName: event.target.value });
                    }
                  }
                />
              </label>
              <label className="field">
                <span>Sign-in button label</span>
                <input
                  required
                  value={providerDraft.buttonLabel}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setProviderDraft`. */ (
                      event,
                    ) => {
                      setProviderDraft({ ...providerDraft, buttonLabel: event.target.value });
                    }
                  }
                />
              </label>
              {providerDraft.providerType === 'microsoft' ||
              providerDraft.providerType === 'oidc' ? (
                <label className="field field-wide">
                  <span>OIDC issuer URL</span>
                  <input
                    required
                    type="url"
                    placeholder="https://login.microsoftonline.com/tenant-id/v2.0"
                    value={providerDraft.issuerUrl}
                    onChange={
                      /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setProviderDraft`. */ (
                        event,
                      ) => {
                        setProviderDraft({ ...providerDraft, issuerUrl: event.target.value });
                      }
                    }
                  />
                </label>
              ) : null}
              {providerDraft.providerType === 'saml' ? (
                <label className="field field-wide">
                  <span>SAML metadata URL</span>
                  <input
                    required
                    type="url"
                    value={providerDraft.metadataUrl}
                    onChange={
                      /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setProviderDraft`. */ (
                        event,
                      ) => {
                        setProviderDraft({ ...providerDraft, metadataUrl: event.target.value });
                      }
                    }
                  />
                </label>
              ) : (
                <>
                  <label className="field">
                    <span>Client ID</span>
                    <input
                      required
                      autoComplete="off"
                      value={providerDraft.clientId}
                      onChange={
                        /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setProviderDraft`. */ (
                          event,
                        ) => {
                          setProviderDraft({ ...providerDraft, clientId: event.target.value });
                        }
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Client secret</span>
                    <input
                      required
                      type="password"
                      autoComplete="new-password"
                      value={providerDraft.clientSecret}
                      onChange={
                        /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setProviderDraft`. */ (
                          event,
                        ) => {
                          setProviderDraft({ ...providerDraft, clientSecret: event.target.value });
                        }
                      }
                    />
                  </label>
                </>
              )}
              <label className="field field-wide">
                <span>Scopes</span>
                <input
                  required
                  value={providerDraft.scopes}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setProviderDraft`. */ (
                      event,
                    ) => {
                      setProviderDraft({ ...providerDraft, scopes: event.target.value });
                    }
                  }
                />
              </label>
              <label className="field field-wide">
                <span>Attribute mapping</span>
                <textarea
                  required
                  spellCheck={false}
                  value={providerDraft.attributeMapping}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setProviderDraft`. */ (
                      event,
                    ) => {
                      setProviderDraft({ ...providerDraft, attributeMapping: event.target.value });
                    }
                  }
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={
                  /** Handles the React `onClick` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setProviderOpen`. */ () => {
                    setProviderOpen(false);
                  }
                }
              >
                Cancel
              </button>
              <button type="submit" className="button-primary" disabled={saving}>
                {saving ? 'Configuring…' : 'Configure provider'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {mappingOpen ? (
        <Modal
          title="Add directory mapping"
          description="Only verified claims from the selected provider are evaluated."
          onClose={
            /** Handles the React `onClose` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setMappingOpen`. */ () => {
              setMappingOpen(false);
            }
          }
        >
          <form
            onSubmit={
              /** Handles the React `onSubmit` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `event.preventDefault`, `createMapping`. */ (
                event,
              ) => {
                event.preventDefault();
                void createMapping();
              }
            }
          >
            <div className="form-grid">
              <label className="field field-wide">
                <span>Identity provider</span>
                <select
                  required
                  value={mappingDraft.identityProviderId}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setMappingDraft`. */ (
                      event,
                    ) => {
                      setMappingDraft({
                        ...mappingDraft,
                        identityProviderId: event.target.value,
                      });
                    }
                  }
                >
                  {configuration.providers.map(
                    /** Transforms each input item for `AdminPage` into the derived value or React element consumed by the surrounding collection. It receives `provider`. It uses only the local values shown in its body. */ (
                      provider,
                    ) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.displayName}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="field">
                <span>Claim name</span>
                <input
                  required
                  value={mappingDraft.claimName}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setMappingDraft`. */ (
                      event,
                    ) => {
                      setMappingDraft({ ...mappingDraft, claimName: event.target.value });
                    }
                  }
                />
              </label>
              <label className="field">
                <span>Exact claim value</span>
                <input
                  required
                  value={mappingDraft.claimValue}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setMappingDraft`. */ (
                      event,
                    ) => {
                      setMappingDraft({ ...mappingDraft, claimValue: event.target.value });
                    }
                  }
                />
              </label>
              <label className="field">
                <span>Edutex role</span>
                <select
                  required
                  value={mappingDraft.roleId}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setMappingDraft`. */ (
                      event,
                    ) => {
                      setMappingDraft({ ...mappingDraft, roleId: event.target.value });
                    }
                  }
                >
                  {configuration.roles.map(
                    /** Transforms each input item for `AdminPage` into the derived value or React element consumed by the surrounding collection. It receives `role`. It uses only the local values shown in its body. */ (
                      role,
                    ) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="field">
                <span>User category</span>
                <select
                  value={mappingDraft.userCategory}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setMappingDraft`. */ (
                      event,
                    ) => {
                      setMappingDraft({ ...mappingDraft, userCategory: event.target.value });
                    }
                  }
                >
                  <option value="student">Student</option>
                  <option value="teacher">Teacher</option>
                  <option value="corporate_staff">Corporate staff</option>
                  <option value="it_staff">IT staff</option>
                  <option value="executive_staff">Executive staff</option>
                  <option value="parent_guardian">Parent or guardian</option>
                  <option value="contractor">Contractor</option>
                </select>
              </label>
              <label className="field">
                <span>Priority</span>
                <input
                  required
                  type="number"
                  min={1}
                  max={10_000}
                  value={mappingDraft.priority}
                  onChange={
                    /** Handles the React `onChange` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. It receives `event`. Direct links: `setMappingDraft`, `Number`. */ (
                      event,
                    ) => {
                      setMappingDraft({ ...mappingDraft, priority: Number(event.target.value) });
                    }
                  }
                />
              </label>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={
                  /** Handles the React `onClick` event inside `AdminPage`, linking the rendered control to its validated page state and same-origin API workflow. Direct links: `setMappingOpen`. */ () => {
                    setMappingOpen(false);
                  }
                }
              >
                Cancel
              </button>
              <button type="submit" className="button-primary" disabled={saving}>
                {saving ? 'Adding…' : 'Add mapping'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}

import { errorMessage } from '@edutex/contracts';
