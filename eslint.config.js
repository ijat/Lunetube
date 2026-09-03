import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * The `no-restricted-imports` rule below mechanically enforces PRD §2's
 * single-adapter-seam requirement: `youtubei.js` may only be imported from
 * `packages/youtube/src/innertube/**`. Everywhere else it is a lint error.
 */
const youtubeiRestriction = {
  name: 'youtubei.js',
  message:
    'youtubei.js may only be imported inside packages/youtube/src/innertube/**. All other code must go through the YouTubeSource contract (packages/youtube/src/contract.ts).',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      'packages/design/src/themes/generated/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [youtubeiRestriction],
          patterns: [
            {
              group: ['youtubei.js', 'youtubei.js/**'],
              message: youtubeiRestriction.message,
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['packages/youtube/src/innertube/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.{jsx,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/*.config.{js,ts,mjs}', 'scripts/**', '**/scripts/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
