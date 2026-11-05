import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.external']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // The codebase marks intentionally unused parameters by prefixing them
      // with an underscore (interface-mirroring signatures, sound helpers that
      // ignore the count they are handed). Honour that convention.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Browser globals that read like local names. A resize listener meant
      // to close a menu was handed the bare `close` -- window.close -- and
      // closed the app's tab instead.
      'no-restricted-globals': [
        'error',
        { name: 'close', message: 'This is window.close; use a local function.' },
        { name: 'event', message: 'Use the handler parameter, not window.event.' },
        { name: 'name', message: 'This is window.name.' },
        { name: 'status', message: 'This is window.status.' },
      ],
    },
  },
])
