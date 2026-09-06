/**
 * @fileoverview Implements the protected OperationsPage React feature, linking session-authorised UI state to same-origin Edutex API contracts.
 *
 * @remarks
 * Direct links: `lucide-react`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { ArrowRight, Database, Download, FileLock2, ShieldCheck, Upload } from 'lucide-react';

/** Explains the governed import/export workflow exposed to authorised operators. */
export function ImportExportPage(): React.JSX.Element {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Governance</p>
          <h1>Import & export</h1>
          <p>Controlled data movement with validation, expiry and an immutable audit trail.</p>
        </div>
        <span className="secure-badge large">
          <FileLock2 size={16} /> Approval controlled
        </span>
      </div>
      <div className="operations-grid">
        <article className="operation-card">
          <span className="operation-icon bg-blue-50 text-blue-700">
            <Upload size={24} />
          </span>
          <div>
            <p className="panel-eyebrow">Inbound</p>
            <h2>Validated data import</h2>
            <p>
              Stage CSV data, review field mappings and validation results, then approve the
              transaction.
            </p>
          </div>
          <button className="button-secondary" type="button" disabled>
            Start import <ArrowRight size={16} />
          </button>
        </article>
        <article className="operation-card">
          <span className="operation-icon bg-emerald-50 text-emerald-700">
            <Download size={24} />
          </span>
          <div>
            <p className="panel-eyebrow">Outbound</p>
            <h2>Time-limited export</h2>
            <p>
              Create a tenant-scoped export job. Sensitive exports require recent MFA and expire
              automatically.
            </p>
          </div>
          <button className="button-secondary" type="button" disabled>
            Request export <ArrowRight size={16} />
          </button>
        </article>
      </div>
      <article className="panel admin-section">
        <div className="panel-heading">
          <div>
            <p className="panel-eyebrow">Data protection</p>
            <h2>How transfers are protected</h2>
          </div>
          <Database size={22} className="text-brand-600" />
        </div>
        <div className="control-grid">
          <div>
            <ShieldCheck size={18} />
            <span>
              <strong>Property allowlists</strong>
              <small>Unexpected columns and formulas are rejected.</small>
            </span>
          </div>
          <div>
            <FileLock2 size={18} />
            <span>
              <strong>Encrypted objects</strong>
              <small>Files use tenant-scoped S3 paths and KMS keys.</small>
            </span>
          </div>
          <div>
            <Download size={18} />
            <span>
              <strong>Short retention</strong>
              <small>Exports expire and access is audited.</small>
            </span>
          </div>
        </div>
      </article>
    </section>
  );
}

/** Provides a focused placeholder for modules whose workflows require school setup data. */
export function ModuleOverviewPage(props: {
  readonly title: string;
  readonly description: string;
}): React.JSX.Element {
  return (
    <section className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-eyebrow">Edutex module</p>
          <h1>{props.title}</h1>
          <p>{props.description}</p>
        </div>
      </div>
      <div className="panel module-overview">
        <span className="operation-icon bg-blue-50 text-blue-700">
          <Database size={25} />
        </span>
        <h2>{props.title} is ready for school configuration</h2>
        <p>
          This module uses the same tenant isolation, permission checks, encryption and audit
          controls as the rest of Edutex. Configure its school-specific workflow and reference data
          during onboarding.
        </p>
        <div className="secure-badge large">
          <ShieldCheck size={16} /> Protected by default
        </div>
      </div>
    </section>
  );
}
