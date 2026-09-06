/**
 * @fileoverview Defines the fail-closed authorization boundary for exceptional retries of RC5's
 * migration and school-bootstrap ECS tasks. It is kept independent from the executable deployment
 * entry point so its exact-ARN and bounded-history rules can be regression tested without AWS calls.
 */

export type RetryableTaskKind = 'migration' | 'bootstrap';

export interface DeploymentRetryRequest {
  readonly taskKind: RetryableTaskKind;
  readonly confirmedTaskArn: string;
}

interface RetryProgress {
  readonly completed: readonly string[];
  readonly migrationTaskArn?: string | undefined;
  readonly bootstrapTaskArn?: string | undefined;
  readonly failedTaskArns?: readonly string[] | undefined;
}

/**
 * Binds an exceptional retry approval to the exact incomplete task and exact ARN stored in the
 * owner-only progress record. A stale, mistyped, different-kind or completed retry fails before a
 * replacement ECS task can be launched.
 */
export function assertRetryRequestMatchesProgress(
  retry: DeploymentRetryRequest | undefined,
  progress: RetryProgress,
): void {
  if (!retry) return;
  const progressProperty = retry.taskKind === 'migration' ? 'migrationTaskArn' : 'bootstrapTaskArn';
  if (progress.completed.includes(retry.taskKind)) {
    throw new Error(`The ${retry.taskKind} stage is already complete and must not be retried.`);
  }
  const currentTaskArn = progress[progressProperty];
  const confirmsCurrentTask = currentTaskArn === retry.confirmedTaskArn;
  const resumesRecordedReplacement =
    currentTaskArn !== undefined && progress.failedTaskArns?.includes(retry.confirmedTaskArn);
  if (!confirmsCurrentTask && !resumesRecordedReplacement) {
    throw new Error(
      `The confirmed failed task ARN does not exactly match the recorded ${retry.taskKind} task.`,
    );
  }
}

/**
 * Appends one exact superseded ECS task ARN to a bounded audit history. Ten failed attempts is a
 * hard operational stop that requires an incident review instead of an unbounded retry loop.
 */
export function appendFailedTaskArn(failedTaskArns: readonly string[], taskArn: string): string[] {
  const next = failedTaskArns.includes(taskArn)
    ? [...failedTaskArns]
    : [...failedTaskArns, taskArn];
  if (next.length > 10) {
    throw new Error('Ten one-shot tasks have failed; stop and open a deployment incident.');
  }
  return next;
}
