/**
 * @fileoverview Implements the Fastify backend application boundary, runtime configuration or shared server behavior consumed by Edutex API modules.
 *
 * @remarks
 * Direct links: `fastify`, `zod`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

/** Safe operational error whose message may be returned to an authenticated client. */
export class ApplicationError extends Error {
  /** Constructs `errors` and assembles the AWS/resource relationships defined in this class without exposing a public origin or broader credentials. It receives `statusCode`, `code`, `message`, `details`. Direct links: `super`. */ public constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

/** Converts internal errors into a stable response without leaking stack traces or SQL details. */
export function sendError(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof ApplicationError) {
    void reply.status(error.statusCode).send({
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      requestId: request.id,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }
  if (error instanceof ZodError) {
    void reply.status(400).send({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'The request did not match the required schema.',
      requestId: request.id,
      details: {
        fields: error.issues.map(
          /** Transforms each input item for `sendError` into the derived value or React element consumed by the surrounding collection. It receives `issue`. It uses only the local values shown in its body. */ (
            issue,
          ) => ({ path: issue.path, code: issue.code }),
        ),
      },
    });
    return;
  }

  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    ['23505', '23514', '23503', '42501', '40001', '40P01'].includes(error.code)
  ) {
    const forbidden = error.code === '42501';
    void reply.status(forbidden ? 403 : 409).send({
      statusCode: forbidden ? 403 : 409,
      code: forbidden ? 'PERMISSION_DENIED' : 'WORKFLOW_CONFLICT',
      message: forbidden
        ? 'Your current permissions do not allow this change.'
        : 'This change conflicts with linked records, an approval rule or another update. Refresh and check the record before trying again.',
      requestId: request.id,
    });
    return;
  }
  request.log.error({ err: error }, 'Unhandled request error');
  void reply.status(500).send({
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'The request could not be completed.',
    requestId: request.id,
  });
}
