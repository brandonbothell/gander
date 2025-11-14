// @ts-check

import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

import prettierRecommended from 'eslint-config-prettier/flat';

export default defineConfig([
  eslint.configs.recommended,
  tseslint.configs.recommended,
  prettierRecommended,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/compiled/**',
      '**/generated/**',
      '**/scripts/**',
      '**/android/**',
      '**/public/**',
      '**/.yarn/**',
      '**/web/**',
      '**/hls_*/**',
      '.pnp.cjs',
    ],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
        },
      ],
    },
  },
]);
