import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/artifacts/**', '**/.tmp*/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['examples/mock-backend/**/*.js'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
  {
    files: ['**/build.mjs', 'docs/samples/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly' },
    },
  },
  {
    files: ['examples/miniapp-demo/**/*.js'],
    languageOptions: {
      globals: { App: 'readonly', Page: 'readonly', wx: 'readonly' },
    },
  },
)
