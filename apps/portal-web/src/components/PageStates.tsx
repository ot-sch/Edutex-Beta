/**
 * @fileoverview Implements the reusable protected-portal PageStates component used by one or more authenticated pages.
 *
 * @remarks
 * Direct links: `lucide-react`.
 * Security: Browser trust boundary; no database/AWS credentials or protected server decisions may enter this bundle.
 */

import { AlertCircle, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';

/** Keeps page-level loading feedback visually consistent and accessible. */
export function PageLoading(): React.JSX.Element {
  return (
    <div className="page-state" role="status">
      <LoaderCircle className="animate-spin text-brand-600" size={28} />
      <p>Loading current data…</p>
    </div>
  );
}

/** Displays a bounded error and offers an explicit retry action. */
export function PageError(props: {
  readonly message: string;
  readonly retry?: () => void;
}): React.JSX.Element {
  return (
    <div className="page-state" role="alert">
      <span className="state-icon state-icon-error">
        <AlertCircle size={24} />
      </span>
      <h2>Something needs attention</h2>
      <p>{props.message}</p>
      {props.retry ? (
        <button className="button-secondary mt-2" type="button" onClick={props.retry}>
          <RefreshCw size={16} /> Try again
        </button>
      ) : null}
    </div>
  );
}

/** Displays a friendly empty result without implying an application fault. */
export function EmptyState(props: {
  readonly title: string;
  readonly detail: string;
  readonly action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="page-state">
      <span className="state-icon">
        <Inbox size={24} />
      </span>
      <h2>{props.title}</h2>
      <p>{props.detail}</p>
      {props.action}
    </div>
  );
}
