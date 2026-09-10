import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'packages/**/src/**/*.test.ts',
      'apps/**/src/**/*.test.ts',
    ],
    passWithNoTests: true,
    // 内部包以源码形式发布(main 指向 src/index.ts),交给 Vite 转换而不是外部化;
    // miniprogram-automator 需要 inline 才能被 vi.mock 拦截
    server: {
      deps: {
        inline: [/@testpilot\//, /miniprogram-automator/],
      },
    },
  },
})
