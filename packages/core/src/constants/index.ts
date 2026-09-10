import { join } from 'node:path'

/** TestPilot 运行时目录与默认值约定 */
export const TESTPILOT_DIR = '.testpilot'
export const RUNS_DIR = `${TESTPILOT_DIR}/artifacts/runs`
export const RESULT_FILE = 'result.json'
export const DEFAULT_CASES_DIR = 'tests/e2e/cases'
export const DEFAULT_STEP_TIMEOUT_MS = 15_000

/** 微信开发者工具 cli 的常见安装位置(可用 WECHAT_DEVTOOLS_CLI 覆盖) */
export const WECHAT_DEVTOOLS_CLI_PATHS = [
  'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  'C:/Program Files/Tencent/微信web开发者工具/cli.bat',
  join(process.env.LOCALAPPDATA ?? '.', '微信web开发者工具', 'cli.bat'),
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
]
