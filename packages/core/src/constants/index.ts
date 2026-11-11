import { join } from 'node:path'

/** csspilot 运行时目录与默认值约定 */
export const TESTPILOT_DIR = '.testpilot'
export const RUNS_DIR = `${TESTPILOT_DIR}/artifacts/runs`
/** 成功/失败用例的截图,按 runId 分子目录 */
export const SHOTS_DIR = `${TESTPILOT_DIR}/artifacts/shots`
export const ARTIFACTS_DIR = `${TESTPILOT_DIR}/artifacts`
/** init 写入的项目关联文件(相对项目根) */
export const PROJECT_LINK_FILE = `${TESTPILOT_DIR}/project.json`
export const RESULT_FILE = 'result.json'
export const DEFAULT_CASES_DIR = 'tests/e2e/cases'
export const DEFAULT_STEP_TIMEOUT_MS = 15_000

/**
 * runId 形态(yyyymmdd-NNN,序号超 999 进位到四位)。
 * 列 runs 目录、报告按 runId 取历史时共用同一判定,形态变化只改这里。
 */
export const RUN_ID_PATTERN = /^\d{8}-\d{3,4}$/

/** 微信开发者工具 cli 的常见安装位置(可用 WECHAT_DEVTOOLS_CLI 覆盖) */
export const WECHAT_DEVTOOLS_CLI_PATHS = [
  'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
  'C:/Program Files/Tencent/微信web开发者工具/cli.bat',
  join(process.env.LOCALAPPDATA ?? '.', '微信web开发者工具', 'cli.bat'),
  '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
]
