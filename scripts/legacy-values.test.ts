/**
 * @fileoverview Regression evidence for legacy-values; it verifies the production behavior owned by the adjacent source module.
 *
 * @remarks
 * Direct links: `vitest`, `./legacy-values.js`.
 * Security: Privileged operator boundary; fail closed, keep secrets out of arguments/files/logs and retain approved evidence.
 */

import { describe, expect, it } from 'vitest';

import { booleanValue, choiceValue, positiveIntegerValue } from './legacy-values.js';

describe('legacy value normalisation', /** Defines the `legacy value normalisation` regression-test suite and groups evidence for the adjacent production module. Direct links: `it`. */ () => {
  it('does not coerce the string false to true', /** Verifies the `does not coerce the string false to true` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect(booleanValue({ value: 'false' }, ['val`, `expect`, `booleanValue`, `expect(booleanValue({ value: 'yes' }, ['value`, `expect(() => booleanValue({ value: 'sometimes`. */ () => {
    expect(booleanValue({ value: 'false' }, ['value'])).toBe(false);
    expect(booleanValue({ value: 'yes' }, ['value'])).toBe(true);
    expect(
      /** Performs the local `expect` operation inside `legacy-values.test` and returns control to the surrounding feature only after this body completes. Direct links: `booleanValue`. */ () =>
        booleanValue({ value: 'sometimes' }, ['value']),
    ).toThrow();
  });

  it('accepts only positive whole-number capacities', /** Verifies the `accepts only positive whole-number capacities` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect(positiveIntegerValue({ capacity: '' },`, `expect`, `positiveIntegerValue`, `expect(positiveIntegerValue({ capacity: '25' `, `expect(() => positiveIntegerValue({ capacity:`. */ () => {
    expect(positiveIntegerValue({ capacity: '' }, ['capacity'])).toBeNull();
    expect(positiveIntegerValue({ capacity: '25' }, ['capacity'])).toBe(25);
    expect(
      /** Performs the local `expect` operation inside `legacy-values.test` and returns control to the surrounding feature only after this body completes. Direct links: `positiveIntegerValue`. */ () =>
        positiveIntegerValue({ capacity: 0 }, ['capacity']),
    ).toThrow();
  });

  it('maps approved aliases and rejects unknown enum values before SQL', /** Verifies the `maps approved aliases and rejects unknown enum values before SQL` case and fails the quality gate when the expected security/functional invariant changes. Direct links: `expect( choiceValue( { employmentType: 'perma`, `expect`, `choiceValue`, `expect(() => choiceValue( { employmentType: '`. */ () => {
    expect(
      choiceValue(
        { employmentType: 'permanent' },
        ['employmentType'],
        ['ongoing', 'fixed_term'] as const,
        'ongoing',
        { permanent: 'ongoing' },
      ),
    ).toBe('ongoing');
    expect(
      /** Performs the local `expect` operation inside `legacy-values.test` and returns control to the surrounding feature only after this body completes. Direct links: `choiceValue`. */ () =>
        choiceValue(
          { employmentType: 'volunteer' },
          ['employmentType'],
          ['ongoing', 'fixed_term'] as const,
          'ongoing',
        ),
    ).toThrow();
  });
});
