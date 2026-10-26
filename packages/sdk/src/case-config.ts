import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse, parseDocument } from 'yaml'
import { ENV_TESTING_FILE } from '@testpilot/core'
import type { StepTarget, TestCase } from '@testpilot/dsl'

export interface EnsureCaseConfigurationInput {
  root: string
  caseSource: string
  /** 只识别明确的 ENV_NAME=value 行；不会从自然语言猜测凭据。 */
  prompt?: string
}

export interface EnsuredCaseConfiguration {
  systems: string[]
  variables: string[]
  accounts: string[]
  environmentVariables: string[]
}

/**
 * Case 落盘前补齐其显式依赖的配置。
 * testpilot.yaml 只保存环境变量引用；实际值/账号凭据只写入被忽略的 .env.testing。
 */
export async function ensureCaseConfiguration(
  input: EnsureCaseConfigurationInput,
): Promise<EnsuredCaseConfiguration> {
  const data = parse(input.caseSource) as Partial<TestCase> | undefined
  const systems = collectSystems(data)
  const variables = collectVariableNames(input.caseSource)
  const accounts = data?.accountRef ? [data.accountRef] : []
  const yamlFile = join(input.root, 'testpilot.yaml')
  const yamlSource = await readOptional(yamlFile, 'version: 1\n')
  const document = parseDocument(yamlSource)
  if (document.errors.length > 0) {
    throw new Error(`testpilot.yaml 配置不合法:${document.errors.map((item) => item.message).join('; ')}`)
  }
  const current = (document.toJS() ?? {}) as Record<string, unknown>
  const environmentVariables = new Set<string>()

  for (const [name, target] of systems) {
    const existing = nestedRecord(current, 'systems', name)
    const existingType = typeof existing?.type === 'string' ? existing.type : undefined
    if (existingType && existingType !== target) {
      throw new Error(`系统 "${name}" 已声明为 ${existingType}，Case 却使用 target:${target}`)
    }
    document.setIn(['systems', name, 'type'], target)
    const prefix = envName(name)
    if (target === 'miniapp') {
      ensureYamlRef(document, current, ['systems', name, 'projectPath'], `${prefix}_PROJECT_PATH`)
      ensureYamlRef(document, current, ['systems', name, 'cliPath'], `${prefix}_CLI_PATH`)
      environmentVariables.add(`${prefix}_PROJECT_PATH`)
      environmentVariables.add(`${prefix}_CLI_PATH`)
    } else {
      ensureYamlRef(document, current, ['systems', name, 'baseUrl'], `${prefix}_BASE_URL`)
      environmentVariables.add(`${prefix}_BASE_URL`)
    }
  }

  for (const name of variables) {
    const environmentName = variableEnvName(name)
    ensureYamlRef(document, current, ['variables', name], environmentName)
    environmentVariables.add(environmentName)
  }

  if (systems.size > 0 || variables.length > 0) {
    for (const key of ['systems', 'variables']) {
      const node = document.get(key, true) as { flow?: boolean } | undefined
      if (node) node.flow = false
    }
    await writeFile(yamlFile, String(document), 'utf8')
  }

  const explicitValues = parseExplicitEnvironment(input.prompt ?? '')
  const envFile = join(input.root, ENV_TESTING_FILE)
  let envSource = await readOptional(envFile, '')
  const existingEnvironment = envKeys(envSource)
  const additions: string[] = []
  for (const name of [...environmentVariables].sort()) {
    if (!existingEnvironment.has(name)) additions.push(`${name}=${explicitValues.get(name) ?? ''}`)
  }
  for (const account of accounts) {
    const name = `TESTPILOT_ACCOUNT_${envName(account)}`
    environmentVariables.add(name)
    if (!existingEnvironment.has(name)) {
      additions.push(
        `${name}=${explicitValues.get(name) ?? '{"username":"","password":""}'}`,
      )
    }
  }
  if (additions.length > 0) {
    const separator = envSource === '' || envSource.endsWith('\n') ? '' : '\n'
    envSource = `${envSource}${separator}\n# TestPilot Case 自动补齐（请填写后再 Rehearse）\n${additions.join('\n')}\n`
    await writeFile(envFile, envSource, 'utf8')
  }

  return {
    systems: [...systems.keys()].sort(),
    variables: variables.sort(),
    accounts: accounts.sort(),
    environmentVariables: [...environmentVariables].sort(),
  }
}

function collectSystems(data: Partial<TestCase> | undefined): Map<string, Extract<StepTarget, 'web' | 'miniapp' | 'api'>> {
  const systems = new Map<string, Extract<StepTarget, 'web' | 'miniapp' | 'api'>>()
  for (const step of [...(data?.setup ?? []), ...(data?.steps ?? []), ...(data?.teardown ?? [])]) {
    if (!step.system) continue
    const target = step.target
    const existing = systems.get(step.system)
    if (existing && existing !== target) {
      throw new Error(`系统 "${step.system}" 在同一 Case 中同时用于 ${existing} 和 ${target}`)
    }
    systems.set(step.system, target)
  }
  return systems
}

function collectVariableNames(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(/\$\{variable\.([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(
        (match) => match[1]!,
      ),
    ),
  ]
}

function ensureYamlRef(
  document: ReturnType<typeof parseDocument>,
  current: Record<string, unknown>,
  path: string[],
  environmentName: string,
): void {
  if (nestedValue(current, path) === undefined) {
    document.setIn(path, `\${${environmentName}}`)
  }
}

function nestedRecord(
  value: Record<string, unknown>,
  first: string,
  second: string,
): Record<string, unknown> | undefined {
  const parent = value[first]
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return undefined
  const child = (parent as Record<string, unknown>)[second]
  return child && typeof child === 'object' && !Array.isArray(child)
    ? (child as Record<string, unknown>)
    : undefined
}

function nestedValue(value: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function envName(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()
}

function variableEnvName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase()
}

function parseExplicitEnvironment(prompt: string): Map<string, string> {
  return new Map(
    [...prompt.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/gm)].map((match) => [
      match[1]!,
      match[2]!.trim(),
    ]),
  )
}

function envKeys(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map(
      (match) => match[1]!,
    ),
  )
}

async function readOptional(file: string, fallback: string): Promise<string> {
  try {
    return await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw err
  }
}
