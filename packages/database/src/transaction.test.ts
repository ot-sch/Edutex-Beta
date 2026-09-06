/**
 * @fileoverview Regression evidence for transaction; it verifies the production behavior owned by the adjacent source module.
 *
 * @remarks
 * Direct links: `vitest`.
 * Security: Tenant-data boundary; parameterisation, same-client transaction context, RLS and relational constraints must remain intact.
 */

import { describe, expect, it, vi } from 'vitest';

const query = vi.fn(
  /** Performs the local `vi.fn` operation inside `transaction.test` and returns control to the surrounding feature only after this body completes. Direct links: `Promise.resolve`. */ () =>
    Promise.resolve({ rows: [] }),
);
const release = vi.fn();
const connect = vi.fn(
  /** Performs the local `vi.fn` operation inside `transaction.test` and returns control to the surrounding feature only after this body completes. Direct links: `Promise.resolve`. */ () =>
    Promise.resolve({ query, release }),
);

vi.mock(
  './pool.js',
  /** Performs the local `vi.mock` operation inside `transaction.test` and returns control to the surrounding feature only after this body completes. It uses only the local values shown in its body. */ () => ({
    /** Implements `getDatabasePool` for regression evidence for transaction; it verifies the production behavior owned by the adjacent source module. It uses only the local values shown in its body. */ getDatabasePool:
      () => ({ connect }),
  }),
);

const { runInTenantTransaction } = await import('./transaction.js');

describe('tenant transaction isolation', /** Defines the `tenant transaction isolation` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('sets request-local RLS attributes before executing work', /** Verifies the `sets request-local RLS attributes before executing work` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `runInTenantTransaction`, `expect(calls[0]?.[0]).toBe`, `expect`, `expect(calls[1]?.[0]).toContain`, `expect(calls.at(-1)?.[0]).toBe`. */ async () => {
    await runInTenantTransaction(
      {
        tenantId: '7c9ebdb3-af5b-4e5d-8391-46376cd60d64',
        userId: 'a51f5097-784c-45da-8450-d9d72e57ae1c',
        permissions: ['students:view'],
        requestId: 'request-1',
      },
      /** Executes the `transaction.test` database work on the same PostgreSQL client after transaction-local tenant/user/permission context is set, preserving RLS isolation. Direct links: `Promise.resolve`. */ () =>
        Promise.resolve('ok'),
    );

    const calls = query.mock.calls as unknown as (readonly [string, ...unknown[]])[];
    expect(calls[0]?.[0]).toBe('begin');
    expect(calls[1]?.[0]).toContain("set_config('app.tenant_id'");
    expect(calls.at(-1)?.[0]).toBe('commit');
    expect(release).toHaveBeenCalledOnce();
  });
});
