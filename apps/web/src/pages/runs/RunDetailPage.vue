<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api/client'
import type { ArtifactFile, Run, RunEvent, RunSummary } from '../../api/types'
import StatusBadge from '../../components/StatusBadge.vue'
import { formatDuration, formatSize, formatTime, shortCommit } from '../../lib/format'
import { useProjectsStore } from '../../stores/projects'

const route = useRoute()
const store = useProjectsStore()
const run = ref<Run>()
const summary = ref<RunSummary>()
const events = ref<RunEvent[]>()
const artifacts = ref<ArtifactFile[]>()
const showEvents = ref(false)
const activeScreenshot = ref<string>()
const error = ref('')

const runId = computed(() => String(route.params.id))

async function load(): Promise<void> {
  error.value = ''
  try {
    await store.ensure()
    run.value = await api.run(runId.value)
    // summary / artifacts 仅本地项目可读;远端索引项目不阻塞页面
    summary.value = await api.runSummary(runId.value).catch(() => undefined)
    events.value = await api.runEvents(runId.value).catch(() => undefined)
    artifacts.value = await api.runArtifacts(runId.value).catch(() => undefined)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(load)
watch(runId, load)

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
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

const isRunning = (): boolean => run.value?.status === 'running'

function baseName(file: string): string {
  return file.split(/[\\/]/).at(-1) ?? file
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
          <button v-if="isRunning()" @click="cancel">取消运行</button>
          <button v-else class="primary" @click="openReport">查看报告</button>
        </td>
      </tr>
    </table>
    <p v-if="run.message" class="muted">{{ run.message }}</p>
  </div>

  <div v-if="summary" class="panel">
    <h3>
      用例结果
      用例 ✓{{ summary.totals.passed }} ✗{{ summary.totals.failed }} · 步骤
      ✓{{ summary.totals.stepsPassed }} ✗{{ summary.totals.stepsFailed }} ↷{{ summary.totals.stepsSkipped }}
    </h3>
    <div v-for="item in summary.cases" :key="item.caseId" style="margin-bottom: 16px">
      <p style="margin: 0 0 6px">
        <StatusBadge :status="item.status" />
        <strong>{{ item.caseId }}</strong> · {{ item.caseName }}
        <span class="muted mono">{{ baseName(item.file) }}</span>
      </p>
      <p v-if="item.error" class="error-text">{{ item.error }}</p>
      <ul class="steps">
        <li v-for="step in item.steps" :key="step.index">
          <span class="mark" :class="step.status">{{ step.status === 'passed' ? '✓' : step.status === 'failed' ? '✗' : '↷' }}</span>
          <span class="mono">{{ step.target }}/{{ step.action }}</span>
          <span class="muted">{{ step.durationMs }}ms</span>
          <span v-if="step.error" class="error-text">{{ step.error }}</span>
          <a
            v-if="step.screenshot"
            href="#"
            @click.prevent="activeScreenshot = step.screenshot"
          >[截图]</a>
        </li>
      </ul>
    </div>
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

  <div v-if="events && events.length" class="panel">
    <h3>
      事件流(NDJSON)
      <button style="margin-left: 8px" @click="showEvents = !showEvents">{{ showEvents ? '收起' : '展开' }}</button>
    </h3>
    <pre v-if="showEvents">{{ events.map((item) => `${item.seq} ${item.event.type} ${item.ts}`).join('\n') }}</pre>
  </div>

  <div v-if="!run && !error" class="empty">加载中...</div>
</template>
