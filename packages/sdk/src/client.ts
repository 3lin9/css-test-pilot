import { isAbsolute, join } from 'node:path'
import type { RunSummary, TestpilotConfig } from '@testpilot/core'
import type { AdapterFactory } from '@testpilot/adapter-core'
import type { CaseValidationResult } from '@testpilot/dsl'
import type { RunEvent, RunEventSubscriber } from '@testpilot/execution-engine'
import {
  collectCases,
  readCaseFile,
  writeCaseFile,
  type CaseInfo,
  type WriteCaseResult,
} from './cases'
import {
  inspectProject,
  loadProjectConfig,
  readProjectLink,
  resolveRoot,
  writeProjectLink,
  type ProjectInspection,
  type ProjectLink,
  type ProjectOptions,
} from './project'
import {
  generateReport,
  readReport,
  type GeneratedReport,
  type ReportPayload,
} from './reports'
import {
  getRun,
  getRunEvents,
  listRuns,
  runCases,
  type RunMeta,
  type RunOptions,
  type RunResult,
} from './runs'

/** 输入路径相对项目根目录展开,绝对路径原样保留 */
function resolveInput(root: string, input: string): string {
  return isAbsolute(input) ? input : join(root, input)
}

/**
 * TestPilot 统一编程接口:CLI / Server / Agent 都通过该客户端访问 TestPilot Core,
 * 不允许绕过 SDK 直连 execution-engine 或具体 adapter。
 *
 * ```text
 * CLI ──────┐
 * Server ───┼──→ @testpilot/sdk → TestPilot Core
 * Agent ────┘
 * ```
 */
export class TestPilotClient {
  /** 业务项目根目录(绝对路径) */
  readonly root: string

  constructor(options: ProjectOptions = {}) {
    this.root = resolveRoot(options.root)
  }

  // ---- project ----

  /** 读取项目配置(testpilot.yaml 不存在时返回默认配置) */
  getConfig(): Promise<TestpilotConfig> {
    return loadProjectConfig(this.root)
  }

  /** 项目自检:目录结构 / 配置 / Skill 安装状态 / 可用执行端 */
  inspect(): Promise<ProjectInspection> {
    return inspectProject(this.root)
  }

  /** 读取本地项目与 Server Project 的关联(.testpilot/project.json) */
  getProjectLink(): Promise<ProjectLink | undefined> {
    return readProjectLink(this.root)
  }

  /** 写入本地项目与 Server Project 的关联 */
  linkProject(link: ProjectLink): Promise<string> {
    return writeProjectLink(link, this.root)
  }

  // ---- cases ----

  /** 收集并校验用例;paths 相对本项目根目录,默认按配置的 casesDir */
  async listCases(paths?: readonly string[], tag?: string): Promise<CaseInfo[]> {
    const config = await this.getConfig()
    const inputs = paths && paths.length > 0 ? paths : [config.casesDir]
    const infos = await collectCases(inputs.map((input) => resolveInput(this.root, input)), {
      root: this.root,
    })
    return tag ? infos.filter((item) => item.case?.tags?.includes(tag)) : infos
  }

  /** 读取单个用例:source 原文 + 校验结果 */
  readCase(
    file: string,
  ): Promise<{ file: string; source: string; validation: CaseValidationResult }> {
    return readCaseFile(file, { root: this.root })
  }

  /** 写入用例(供 Agent 的 create_case 工具使用):先校验后落盘 */
  writeCase(
    file: string,
    source: string,
    options: { overwrite?: boolean } = {},
  ): Promise<WriteCaseResult> {
    return writeCaseFile(file, source, { root: this.root, ...options })
  }

  // ---- runs ----

  /** 执行一次运行 */
  runCases(options: Omit<RunOptions, 'root'> = {}): Promise<RunResult> {
    return runCases({ ...options, root: this.root })
  }

  /** 历史运行列表(最近的在前) */
  listRuns(): Promise<RunMeta[]> {
    return listRuns({ root: this.root })
  }

  /** 读取一次运行的汇总结果(result.json) */
  getRun(runId: string): Promise<RunSummary> {
    return getRun(runId, { root: this.root })
  }

  /** 读取一次运行的完整事件流(events.ndjson) */
  getRunEvents(runId: string): Promise<RunEvent[]> {
    return getRunEvents(runId, { root: this.root })
  }

  // ---- reports ----

  /** 生成报告(默认最近一次运行) */
  generateReport(runId?: string): Promise<GeneratedReport> {
    return generateReport(runId, { root: this.root })
  }

  /** 读取已生成的报告 */
  readReport(runId: string): Promise<ReportPayload | undefined> {
    return readReport(runId, { root: this.root })
  }
}

export function createTestPilotClient(options: ProjectOptions = {}): TestPilotClient {
  return new TestPilotClient(options)
}

/** 供自定义运行环境注入 adapter 的类型再导出 */
export type { AdapterFactory, RunEvent, RunEventSubscriber }
