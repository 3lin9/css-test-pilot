<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api/client'
import type { ArtifactFile, CaseResult, Run, RunSummary } from '../../api/types'
import StatusBadge from '../../components/StatusBadge.vue'
import { formatDuration, formatSize, formatTime, shortCommit } from '../../lib/format'
import { usePolling } from '../../lib/usePolling'
import { useProjectsStore } from '../../stores/projects'

const route = useRoute()
const store = useProjectsStore()
const run = ref<Run>()
const summary = ref<RunSummary>()
const artifacts = ref<ArtifactFile[]>()
const activeScreenshot = ref<string>()
const error = ref('')

/** 用例级筛选:全部 / 仅失败 / 环境受阻 / 未验证;配合文本搜索 */
const caseFilter = ref<'all' | 'failed' | 'blocked' | 'inconclusive'>('all')
const search = ref('')

const runId = computed(() => String(route.params.id))
const isRunning = computed(() => run.value?.status === 'running')

async function load(): Promise<void> {
  error.value = ''
  try {
    await store.ensure()
    run.value = await api.run(runId.value)
    // summary / artifacts 仅本地项目可读;远端索引项目不阻塞页面
    summary.value = await api.runSummary(runId.value).catch(() => undefined)
    artifacts.value = await api.runArtifacts(runId.value).catch(() => undefined)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(load)
watch(runId, load)
// 运行中自动刷新(用例逐步落库);结束后停止
usePolling(isRunning, load)

const filteredCases = computed<CaseResult[]>(() => {
  const cases = summary.value?.cases ?? []
  const keyword = search.value.trim().toLowerCase()
  return cases.filter((item) => {
    if (caseFilter.value === 'failed' && item.status !== 'failed') return false
    if (caseFilter.value !== 'all' && caseFilter.value !== 'failed' && item.status !== caseFilter.value) return false
    if (!keyword) return true
    return `${item.caseId} ${item.caseName} ${item.file}`.toLowerCase().includes(keyword)
  })
})

const filterCounts = computed(() => {
  const cases = summary.value?.cases ?? []
  return {
    all: cases.length,
    failed: cases.filter((item) => item.status === 'failed').length,
    blocked: cases.filter((item) => item.status === 'blocked').length,
    inconclusive: cases.filter((item) => item.status === 'inconclusive').length,
  }
})

function workspaceName(): string {
  const json = run.value?.workspaceSnapshotJson
  if (!json) return '-'
  try {
    return (JSON.parse(json) as { name?: string }).name ?? '-'
  } catch {
    return '-'
  }
}

function workspaceBindings(): Array<{ projectId: number; environmentName: string }> {
  const json = run.value?.workspaceSnapshotJson
  if (!json) return []
  try {
    return (JSON.parse(json) as { bindings?: Array<{ projectId: number; environmentName: string }> }).bindings ?? []
  } catch {
    return []
  }
}

/** 三桶语义提示:让 blocked/inconclusive 不被误读为产品回归 */
function statusHint(status: CaseResult['status']): string {
  if (status === 'blocked') return '环境/前置受阻 — 非产品回归'
  if (status === 'inconclusive') return '本轮未验证(前置缺失等) — 不能视为已通过'
  return ''
}

function isImage(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path)
}

async function openReport(): Promise<void> {
  try {
    await api.report(runId.value) // 按需生成
    window.open(api.artifactUrl(runId.value, 'report.html'), '_blank')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function cancel(): Promise<void> {
  if (!run.value) return
  try {
    await api.cancelRun(runId.value)
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function baseName(file: string): string {
  return file.split(/[\\/]/).at(-1) ?? file
}

/** 去除终端 ANSI 转义(Playwright 等错误信息自带颜色码,网页上显示为乱码) */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}
</script>

<template>
  <h1 class="page-title">
    Run {{ runId }}
    <StatusBadge v-if="run" :status="run.status" />
  </h1>

  <div v-if="error" class="error-banner">{{ error }}</div>

  <div v-if="run" class="panel">
    <table>
      <tr>
        <td>项目</td>
        <td><RouterLink v-if="run.projectId" :to="`/projects/${run.projectId}`">{{ store.projectName(run.projectId) }}</RouterLink></td>
        <td>分支 / 提交</td>
        <td class="mono">{{ run.branch ?? '-' }} · {{ shortCommit(run.commit) }}</td>
      </tr>
      <tr>
        <td>Workspace</td>
        <td>
          <RouterLink v-if="run.workspaceId" :to="`/workspaces/${run.workspaceId}`">{{ workspaceName() }}</RouterLink>
          <template v-else>{{ workspaceName() }}</template>
          <span class="muted" style="font-size: 12px">运行时快照(链接指向当前配置)</span>
          <span v-for="binding in workspaceBindings()" :key="binding.projectId" class="muted" style="margin-right: 8px">
            {{ store.projectName(binding.projectId) }}→{{ binding.environmentName }}
          </span>
        </td>
        <td>开始 / 结束</td>
        <td>{{ formatTime(run.startedAt) }} ~ {{ formatTime(run.finishedAt) }}</td>
      </tr>
      <tr>
        <td>耗时</td>
        <td>{{ formatDuration(run.durationMs) }}</td>
        <td>操作</td>
        <td>
          <button v-if="isRunning" @click="cancel">取消运行</button>
          <button v-else class="primary" @click="openReport">查看报告</button>
        </td>
      </tr>
    </table>
    <p v-if="run.message" class="muted">{{ run.message }}</p>
  </div>

  <div v-if="summary" class="panel">
    <h3>
      用例结果
      模板 {{ summary.totals.templates ?? summary.totals.cases }} · 数据行
      ✓{{ summary.totals.passed }} ✗{{ summary.totals.failed }} ↷{{ summary.totals.skipped ?? 0 }}
      ⚠{{ summary.totals.warnings ?? 0 }} · 步骤 ✓{{ summary.totals.stepsPassed }}
      ✗{{ summary.totals.stepsFailed }} ↷{{ summary.totals.stepsSkipped }} ⚠{{ summary.totals.stepsWarning ?? 0 }}
    </h3>

    <div class="filters" style="margin-bottom: 12px">
      <button :class="{ on: caseFilter === 'all' }" @click="caseFilter = 'all'">全部({{ filterCounts.all }})</button>
      <button :class="{ on: caseFilter === 'failed' }" @click="caseFilter = 'failed'">仅失败({{ filterCounts.failed }})</button>
      <button :class="{ on: caseFilter === 'blocked' }" @click="caseFilter = 'blocked'">受阻({{ filterCounts.blocked }})</button>
      <button :class="{ on: caseFilter === 'inconclusive' }" @click="caseFilter = 'inconclusive'">未验证({{ filterCounts.inconclusive }})</button>
      <input
        v-model="search"
        placeholder="搜索用例 ID / 名称 / 文件…"
        style="margin-left: auto; width: 240px"
      />
    </div>

    <div v-for="item in filteredCases" :key="`${item.caseId}#${item.rowId ?? 'default'}`" style="margin-bottom: 16px">
      <p style="margin: 0 0 6px">
        <StatusBadge :status="item.status" />
        <strong>{{ item.caseId }}#{{ item.rowId ?? 'default' }}</strong> · {{ item.caseName }}
        <span class="muted mono">{{ baseName(item.file) }}</span>
        <span v-if="statusHint(item.status)" class="muted" style="font-size: 12px">— {{ statusHint(item.status) }}</span>
        <a
          v-if="item.trace && run"
          :href="api.artifactUrl(runId, item.trace)"
          target="_blank"
          style="margin-left: 8px"
          title="下载 trace.zip;本地可用 npx csspilot report --trace 回放(时间线 + DOM 快照逐帧 + 网络 + 控制台)"
        >[Trace 回放]</a>
        <a
          v-if="item.video && run"
          :href="api.artifactUrl(runId, item.video)"
          target="_blank"
          style="margin-left: 4px"
        >[视频]</a>
      </p>
      <p v-if="item.error" class="error-text">{{ stripAnsi(item.error) }}</p>
      <p v-if="item.skipReason" class="muted">{{ item.skipReason }}: {{ item.missingDependencies?.join(', ') }}</p>
      <p v-for="warning in item.warnings ?? []" :key="warning" class="error-text">⚠ {{ warning }}</p>
      <ul class="steps">
        <li v-for="step in item.steps" :key="`${step.phase ?? 'steps'}-${step.index}`">
          <span class="mark" :class="step.status">{{ step.status === 'passed' ? '✓' : step.status === 'failed' ? '✗' : step.status === 'warning' ? '⚠' : '↷' }}</span>
          <span class="mono">{{ step.phase ?? 'steps' }} · {{ step.target }}{{ step.system ? `@${step.system}` : '' }}/{{ step.action }}</span>
          <span v-if="step.http" class="mono muted">{{ step.http.method }} {{ step.http.url }} → {{ step.http.status }}</span>
          <span class="muted">{{ step.durationMs }}ms</span>
          <span v-if="step.error" class="error-text">{{ stripAnsi(step.error) }}</span>
          <a
            v-if="step.screenshot"
            href="#"
            @click.prevent="activeScreenshot = step.screenshot"
          >[截图]</a>
          <img
            v-if="step.screenshot && run"
            class="screenshot"
            :src="api.artifactUrl(run.id, step.screenshot)"
            alt="截图"
          />
        </li>
      </ul>
      <details v-if="item.consoleLog?.length" style="margin-top: 6px">
        <summary class="muted" style="cursor: pointer">控制台输出({{ item.consoleLog.length }})</summary>
        <table style="margin-top: 6px">
          <tbody>
            <tr v-for="(entry, index) in item.consoleLog" :key="index">
              <td class="mono muted" style="width: 70px">{{ entry.level }}</td>
              <td class="mono" style="white-space: pre-wrap; word-break: break-all">{{ stripAnsi(entry.text) }}</td>
            </tr>
          </tbody>
        </table>
      </details>
      <details v-if="item.networkLog?.length" style="margin-top: 6px">
        <summary class="muted" style="cursor: pointer">网络请求({{ item.networkLog.length }})</summary>
        <table style="margin-top: 6px">
          <thead><tr><th>方法</th><th>URL</th><th class="num">状态</th><th class="num">耗时</th></tr></thead>
          <tbody>
            <tr v-for="(entry, index) in item.networkLog" :key="index">
              <td class="mono">{{ entry.method }}</td>
              <td class="mono" style="word-break: break-all">{{ entry.url }}</td>
              <td class="num" :class="{ 'error-text': entry.status >= 400 }">{{ entry.status }}</td>
              <td class="num muted">{{ entry.durationMs !== undefined ? `${entry.durationMs}ms` : '-' }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>
    <div v-if="!filteredCases.length" class="empty">没有符合筛选条件的用例</div>
  </div>

  <div v-if="activeScreenshot && run" class="panel">
    <h3>截图 {{ activeScreenshot }}</h3>
    <img class="screenshot" :src="api.artifactUrl(run.id, activeScreenshot)" alt="screenshot" />
  </div>

  <div v-if="artifacts && artifacts.length" class="panel">
    <h3>取证产物</h3>
    <table>
      <thead><tr><th>文件</th><th class="num">大小</th></tr></thead>
      <tbody>
        <tr v-for="file in artifacts" :key="file.path">
          <td>
            <a v-if="isImage(file.path)" href="#" @click.prevent="activeScreenshot = file.path">{{ file.path }}</a>
            <a v-else :href="api.artifactUrl(runId, file.path)" target="_blank">{{ file.path }}</a>
          </td>
          <td class="num">{{ formatSize(file.size) }}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="!run && !error" class="empty">加载中...</div>
</template>
