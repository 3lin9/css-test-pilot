import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.turbo/**', '**/artifacts/**', '**/.tmp*/**', 'docs/slides-src/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Vue SFC:模板规则(flat/recommended 自带 vue-eslint-parser,TS 由 typescript-eslint parser 处理)
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Server / SDK 是异步密集边界(编排、spawn、事务),漏 await 会在运行时静默丢错;
    // typed lint 交给各包 tsconfig(projectService),其他目录暂不启用
    files: ['apps/server/src/**/*.ts', 'packages/sdk/src/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    // Vue 模板的排版类规则对已有页面太吵(多属性换行/单行元素换行),
    // 正确性规则(flat/recommended 其余项)保留
    files: ['**/*.vue'],
    rules: {
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/attributes-order': 'off',
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
