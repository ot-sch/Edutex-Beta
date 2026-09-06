/** @fileoverview Keeps unexpected page failures recoverable without exposing internal errors or losing the entire browser interface. */
import { Component, type ReactNode } from 'react';
/** Replaces a failed view with a readable recovery action while preserving the server session boundary. */
export class FailureBoundary extends Component<
  { readonly children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  /** Switches to the recovery screen when a descendant fails during rendering. */
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  /** Displays a safe recovery screen or the original application content. */
  override render(): ReactNode {
    return this.state.failed ? (
      <main className="technician-main page-stack">
        <h1>This page could not be displayed</h1>
        <p>
          Your session remains protected. Reload the page and try again. If the problem continues,
          contact the school's support team.
        </p>
        <button
          type="button"
          className="button-primary"
          onClick={
            /** Handles Failure Boundary interaction state from the current control. */
            () => {
              window.location.reload();
            }
          }
        >
          Reload Edutex
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
