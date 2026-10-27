import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'server/.wrangler', 'server/node_modules', 'android/**/build/**'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Architecture guard: game rules must never depend on the presentation layer.
    files: ['src/game/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react/*'], message: 'Domain must not import React.' },
            { group: ['pixi.js', '@pixi/*'], message: 'Domain must not import Pixi.' },
            { group: ['zustand', 'zustand/*'], message: 'Domain must not import UI state.' },
            { group: ['**/presentation/**'], message: 'Domain must not import presentation.' },
          ],
        },
      ],
    },
  },
);
