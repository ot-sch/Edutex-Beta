/**
 * @fileoverview Defines repository formatting policy consumed by the local and CI quality gates.
 *
 * @remarks
 * Direct links: its owning workspace entry point and adjacent typed modules.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

/** @type {import('prettier').Config} */
export default {
  arrowParens: 'always',
  bracketSpacing: true,
  printWidth: 100,
  proseWrap: 'always',
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'all',
};
