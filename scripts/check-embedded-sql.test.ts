/**
 * @fileoverview Parses every static PostgreSQL template passed directly to `client.query` in the
 * maintained TypeScript source. This catches malformed bootstrap, migration and repository SQL
 * before an image can be deployed, while deliberately excluding queries assembled from reviewed
 * identifier allowlists that require their own module tests.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parse } from 'pgsql-ast-parser';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const filesWithEmbeddedSql = [
  'apps/api/src/app.ts',
  'apps/api/src/modules/admin/routes.ts',
  'apps/api/src/modules/attendance/routes.ts',
  'apps/api/src/modules/audit/routes.ts',
  'apps/api/src/modules/auth/identity-repository.ts',
  'apps/api/src/modules/crypto/key-service.ts',
  'apps/api/src/modules/crypto/routes.ts',
  'apps/api/src/modules/files/routes.ts',
  'apps/api/src/modules/dashboard/routes.ts',
  'apps/api/src/modules/resources/routes.ts',
  'packages/database/src/migrate.ts',
  'packages/database/src/pool.ts',
  'packages/database/src/transaction.ts',
  'scripts/bootstrap-school.ts',
  'scripts/migrate-legacy.ts',
] as const;

interface EmbeddedSql {
  readonly file: string;
  readonly line: number;
  readonly sql: string;
}

/**
 * Normalizes two PostgreSQL constructs unsupported by the release-gate parser: positional bind
 * markers and `IS DISTINCT FROM`. PostgreSQL executes the untouched, parameterized statement; this
 * copy exists only to parse the rest of each statement and catch malformed clauses/parentheses.
 */
function parserInput(sql: string): string {
  return sql.replaceAll(/\bis\s+distinct\s+from\b/gi, '<>').replaceAll(/\$\d+\b/g, 'null');
}

/** Returns true only for an invocation whose receiver is named `client` and method is `query`. */
function isClientQuery(call: ts.CallExpression): boolean {
  const expression = call.expression;
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'client' &&
    expression.name.text === 'query'
  );
}

/**
 * Extracts non-interpolated string/template arguments from direct `client.query(...)` calls and
 * records their source line for a precise release-gate error.
 */
function collectStaticQueries(sourceFile: ts.SourceFile, file: string): EmbeddedSql[] {
  const queries: EmbeddedSql[] = [];
  /** Walks the TypeScript AST and captures only complete static SQL literals. */
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isClientQuery(node)) {
      const argument = node.arguments[0];
      if (
        argument &&
        (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(argument.getStart(sourceFile));
        queries.push({ file, line: line + 1, sql: argument.text });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return queries;
}

/** Loads every maintained SQL-bearing TypeScript module and returns its static query literals. */
async function embeddedQueries(): Promise<EmbeddedSql[]> {
  const queries: EmbeddedSql[] = [];
  for (const file of filesWithEmbeddedSql) {
    const source = await readFile(resolve(repositoryRoot, file), 'utf8');
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    queries.push(...collectStaticQueries(sourceFile, file));
  }
  return queries;
}

describe('embedded PostgreSQL syntax', /** Groups the static SQL parser evidence that blocks malformed provisioning/query literals. Direct links: `it`. */ () => {
  it('parses every complete static client query before deployment', /** Parses each complete static PostgreSQL literal and reports its exact module/line when the grammar is invalid. Direct links: `embeddedQueries`, `parse`, `expect`. */ async () => {
    const queries = await embeddedQueries();
    const failures: string[] = [];
    for (const query of queries) {
      try {
        parse(parserInput(query.sql));
      } catch (error) {
        failures.push(`${query.file}:${query.line}: ${(error as Error).message}`);
      }
    }
    expect(queries.length).toBeGreaterThan(25);
    expect(failures).toEqual([]);
  });
});
