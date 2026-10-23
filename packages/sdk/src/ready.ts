import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { promisify } from 'node:util'
import type { TestpilotConfig } from '@testpilot/core'
import type { TestCase } from '@testpilot/dsl'
import {
  stableHash,
  type ReadyCertificate,
  type RehearsalEvidence,
} from '@testpilot/observation-core'

const execFile = promisify(execFileCallback)

export interface ReadyFingerprintInput {
  root: string
  file: string
  data: TestCase
  config: TestpilotConfig
  datasetRows: unknown[]
}

export interface BuildReadyCertificateInput extends ReadyFingerprintInput {
  evidence: RehearsalEvidence
}

interface ReadyFingerprint {
  commit: string
  environmentHash: string
  caseHash: string
  datasetHash: string
}

export async function buildReadyCertificate(
  input: BuildReadyCertificateInput,
): Promise<ReadyCertificate> {
  const fingerprint = await readyFingerprint(input)
  return {
    version: 1,
    caseId: input.data.id,
    caseFile: toPosix(
      isAbsolute(input.file) ? relative(input.root, input.file) : input.file,
    ),
    commit: fingerprint.commit,
    environment: input.data.environment,
    environmentHash: fingerprint.environmentHash,
    caseHash: fingerprint.caseHash,
    datasetHash: fingerprint.datasetHash,
    observedAt: new Date().toISOString(),
    pageStateHashes: input.evidence.pageStateHashes,
    verifiedLocators: input.evidence.verifiedLocators,
    status: 'ready',
  }
}

export async function writeReadyCertificate(
  root: string,
  certificate: ReadyCertificate,
): Promise<string> {
  const directory = join(root, '.testpilot', 'ready')
  const file = join(directory, `${certificate.caseId}.json`)
  await mkdir(directory, { recursive: true })
  await writeFile(file, `${JSON.stringify(certificate, null, 2)}\n`, 'utf8')
  return file
}

export async function readReadyCertificate(
  root: string,
  caseId: string,
): Promise<ReadyCertificate | undefined> {
  try {
    return JSON.parse(
      await readFile(join(root, '.testpilot', 'ready', `${caseId}.json`), 'utf8'),
    ) as ReadyCertificate
  } catch {
    return undefined
  }
}

export async function validateReadyCertificate(
  root: string,
  certificate: ReadyCertificate,
  input: Omit<ReadyFingerprintInput, 'root'>,
): Promise<string[]> {
  const current = await readyFingerprint({ ...input, root })
  const issues: string[] = []
  if (certificate.status !== 'ready' || certificate.version !== 1) issues.push('invalid-certificate')
  if (certificate.caseId !== input.data.id) issues.push('case-id-mismatch')
  if (certificate.caseHash !== current.caseHash) issues.push('case-hash-mismatch')
  if (certificate.datasetHash !== current.datasetHash) issues.push('dataset-hash-mismatch')
  if (certificate.environmentHash !== current.environmentHash) issues.push('environment-mismatch')
  if (certificate.commit !== current.commit) issues.push('code-version-mismatch')
  return issues
}

async function readyFingerprint(input: ReadyFingerprintInput): Promise<ReadyFingerprint> {
  return {
    commit: await gitFingerprint(input.root),
    caseHash: stableHash(input.data),
    datasetHash: stableHash(input.datasetRows),
    environmentHash: stableHash({
      environment: input.data.environment,
      workspace: input.data.workspace,
      web: input.config.web,
      miniapp: input.config.miniapp,
      api: input.config.api,
    }),
  }
}

async function gitFingerprint(root: string): Promise<string> {
  try {
    const [{ stdout: revision }, { stdout: status }] = await Promise.all([
      execFile('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }),
      execFile('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' }),
    ])
    const commit = revision.trim()
    const dirty = status
      .split(/\r?\n/)
      .filter(
        (line) =>
          line &&
          !/\.testpilot[\\/](?:ready|artifacts|cache)[\\/]/.test(line),
      )
      .join('\n')
      .trim()
    return dirty ? `${commit}-dirty-${stableHash(dirty).slice(0, 12)}` : commit
  } catch {
    return 'non-git'
  }
}

function toPosix(path: string): string {
  return path.split('\\').join('/')
}
