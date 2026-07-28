import { builtinModules } from 'node:module';

import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const builtins = builtinModules.filter((name) => !name.startsWith('node:'));

export default defineConfig([
  globalIgnores(['node_modules/**', 'dist/**', 'coverage/**', 'tmp/**', 'temp/**', '.cache/**']),
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    extends: [eslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: {
      'no-console': 'warn',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-restricted-imports': ['error', { paths: builtins }],
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,mts,cts}'],
  })),
  {
    files: ['**/*.{ts,mts,cts}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
  {
    files: ['test/**/*.spec.ts'],
    languageOptions: {
      globals: globals.mocha,
    },
  },
  prettier,
]);
