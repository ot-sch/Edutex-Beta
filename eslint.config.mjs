/**
 * @fileoverview Defines repository lint policy, strict typed rules and generated-file exclusions used by the quality gate.
 *
 * @remarks
 * Direct links: `@eslint/js`, `typescript-eslint`.
 * Security: Maintained source boundary; changes require strict type, test, lint, format and security review.
 */

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/cdk.out/**',
      '**/node_modules/**',
      '*.config.mjs',
      'output/**',
      'tmp/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 16,
          allowDefaultProject: [
            '*.config.mjs',
            'apps/api/src/*.test.ts',
            'apps/api/src/modules/*/*.test.ts',
            'infra/aws/lib/*.test.ts',
            'packages/database/src/*.test.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowConciseArrowFunctionExpressionsStartingWithVoid: true },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'scripts/**/*.ts', 'infra/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': 'off',
    },
  },
);
