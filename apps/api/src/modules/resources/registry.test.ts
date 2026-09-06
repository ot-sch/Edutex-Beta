/**
 * @fileoverview Regression evidence for registry; it verifies the production behavior owned by the adjacent source module.
 *
 * @remarks
 * Direct links: `vitest`, `./registry.js`.
 * Security: Tenant-data boundary; parameterisation, same-client transaction context, RLS and relational constraints must remain intact.
 */

import { describe, expect, it } from 'vitest';

import { resourceRegistry, validateMutationFields } from './registry.js';

describe('resource property allowlist', /** Defines the `resource property allowlist` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('rejects fields not declared by the trusted registry', /** Verifies the `rejects fields not declared by the trusted registry` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect(() => validateMutationFields( resource`, `expect`. */ () => {
    expect(
      /** Performs the local `expect` operation inside `registry.test` and returns control to the surrounding feature only after this body completes. Direct links: `validateMutationFields`. */ () =>
        validateMutationFields(
          resourceRegistry.students,
          { studentNumber: 'S-1', injected_sql_column: 'value' },
          false,
        ),
    ).toThrow();
  });

  it('rejects writes to server-maintained properties', /** Verifies the `rejects writes to server-maintained properties` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect(() => validateMutationFields( resource`, `expect`. */ () => {
    expect(
      /** Performs the local `expect` operation inside `registry.test` and returns control to the surrounding feature only after this body completes. Direct links: `validateMutationFields`, `new Date().toISOString`. */ () =>
        validateMutationFields(
          resourceRegistry.timetables,
          { publishedAt: new Date().toISOString() },
          false,
        ),
    ).toThrow();
  });

  it('requires the relational identity fields needed to create a student', /** Verifies the `requires the relational identity fields needed to create a student` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect(() => validateMutationFields(resourceR`, `expect`. */ () => {
    expect(
      /** Performs the local `expect` operation inside `registry.test` and returns control to the surrounding feature only after this body completes. Direct links: `validateMutationFields`. */ () =>
        validateMutationFields(resourceRegistry.students, { firstName: 'Ada' }, true),
    ).toThrow(/Missing required fields/);
  });
});
