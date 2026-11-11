import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/artifacts/**', '**/.tmp*/**', 'docs/slides-src/**'] },
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
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
  {
    files: ['examples/miniapp-demo/**/*.js'],
    languageOptions: {
      globals: { App: 'readonly', Page: 'readonly', wx: 'readonly' },
    },
  },
  {
    // 注入各运行时的截图钩子(Playwright 页面上下文 / node:test loader):
    // process / URL 在目标运行时存在;文件名清洗正则刻意剥控制字符
    files: ['packages/native/src/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly', URL: 'readonly', console: 'readonly' },
    },
    rules: { 'no-control-regex': 'off' },
  },
)
