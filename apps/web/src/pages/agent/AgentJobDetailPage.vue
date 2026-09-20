<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api/client'
import type { AgentJob, AgentJobEvent } from '../../api/types'
import StatusBadge from '../../components/StatusBadge.vue'
import { formatTime } from '../../lib/format'
import { useProjectsStore } from '../../stores/projects'

const route = useRoute()
const store = useProjectsStore()
const job = ref<AgentJob>()
const events = ref<AgentJobEvent[]>([])
const error = ref('')
const cancelling = ref(false)
let pollTimer: ReturnType<typeof setInterval> | undefined

const jobId = computed(() => String(route.params.id))

function eventAgent(item: AgentJobEvent): 'planner' | 'analysis' | 'system' {
  const agent = item.event.data?.agent
  if (agent === 'planner') return 'planner'
  if (agent === 'analysis') return 'analysis'
  if (item.type === 'job-started' || item.type === 'job-finished' || item.type === 'error') return 'system'
  if (item.type === 'run-started' || item.type === 'run-finished' || item.type === 'case-written' || item.type === 'validation') {
    return 'planner'
  }
  if (typeof item.event.message === 'string' && item.event.message.includes('Analysis')) return 'analysis'
  return 'system'
}

const plannerEvents = computed(() => events.value.filter((item) => eventAgent(item) === 'planner'))
const analysisEvents = computed(() => events.value.filter((item) => eventAgent(item) === 'analysis'))
const systemEvents = computed(() => events.value.filter((item) => eventAgent(item) === 'system'))

const verdict = computed(() => {
  const finished = [...events.value].reverse().find((item) => item.type === 'job-finished')
  const value = finished?.event.data?.verdict
  return typeof value === 'string' ? value : undefined
})

const live = computed(() => job.value?.status === 'queued' || job.value?.status === 'running')

async function load(): Promise<void> {
  error.value = ''
  try {
    await store.ensure()
    job.value = await api.agentJob(jobId.value)
    events.value = await api.agentJobEvents(jobId.value)
    if (live.value) startPolling()
    else stopPolling()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function startPolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    void load().catch(() => undefined)
  }, 1000)
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
}

onMounted(load)
onUnmounted(stopPolling)
watch(jobId, () => {
  stopPolling()
  void load()
})

async function cancel(): Promise<void> {
  if (!job.value || cancelling.value) return
  cancelling.value = true
  try {
    job.value = await api.cancelAgentJob(job.value.id)
    events.value = await api.agentJobEvents(job.value.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    cancelling.value = false
  }
}

function eventLabel(item: AgentJobEvent): string {
  return item.event.message || item.type
}
</script>

<template>
  <div class="page-head">
    <div class="page-head-row">
      <div>
        <p class="overline"><RouterLink to="/agent">TestPilot AI</RouterLink></p>
        <h1 class="page-title mono">{{ job?.id ?? jobId }}</h1>
        <p class="page-sub">
          项目
          <RouterLink v-if="job" :to="`/projects/${job.projectId}`">{{ store.projectName(job.projectId) }}</RouterLink>
        </p>
      </div>
      <div class="form-row">
        <StatusBadge v-if="job" :status="job.status" />
        <button v-if="live" class="ghost" :disabled="cancelling" @click="cancel">
          {{ cancelling ? '取消中…' : '取消任务' }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="error" class="error-banner">{{ error }}</div>

  <div class="cards">
    <div class="stat-card tone-indigo">
      <div>
        <div class="label">Case</div>
        <div class="num" style="font-size: 18px">{{ job?.caseId ?? '-' }}</div>
        <div class="muted mono">{{ job?.caseFile ?? '尚未写入' }}</div>
      </div>
    </div>
    <div class="stat-card tone-purple">
      <div>
        <div class="label">Analysis 判定</div>
        <div class="num" style="font-size: 18px">{{ verdict ?? (job?.runId ? '分析中' : 'not-run') }}</div>
      </div>
    </div>
    <div class="stat-card tone-orange">
      <div>
        <div class="label">Run</div>
        <div class="num" style="font-size: 18px">
          <RouterLink v-if="job?.runId" :to="`/runs/${job.runId}`">{{ job.runId }}</RouterLink>
          <span v-else>-</span>
        </div>
      </div>
    </div>
  </div>

  <div class="panel">
    <h3>需求 / Prompt</h3>
    <pre>{{ job?.prompt ?? '' }}</pre>
    <p v-if="job?.message" style="margin-top: 12px">{{ job.message }}</p>
  </div>

  <div class="agent-lanes">
    <div class="panel">
      <div class="overline">Planner Agent</div>
      <h3>规划测试任务</h3>
      <p class="panel-desc">发现项目 → 写 Case → validate → 可选 run</p>
      <ul class="steps">
        <li v-for="item in plannerEvents" :key="item.seq">
          <span class="mark passed">{{ item.seq }}</span>
          <div>
            <div>{{ eventLabel(item) }}</div>
            <div class="muted mono">{{ item.type }} · {{ formatTime(item.ts) }}</div>
          </div>
        </li>
      </ul>
      <div v-if="!plannerEvents.length" class="empty">等待 Planner 事件…</div>
    </div>

    <div class="panel">
      <div class="overline">Analysis Agent</div>
      <h3>分析测试结果</h3>
      <p class="panel-desc">读 run / report，归因失败，不盲目改 Case</p>
      <ul class="steps">
        <li v-for="item in analysisEvents" :key="item.seq">
          <span class="mark passed">{{ item.seq }}</span>
          <div>
            <div>{{ eventLabel(item) }}</div>
            <div class="muted mono">{{ item.type }} · {{ formatTime(item.ts) }}</div>
          </div>
        </li>
      </ul>
      <div v-if="!analysisEvents.length" class="empty">
        {{ job?.runId ? '等待 Analysis 事件…' : '未执行 run，Analysis 仅给出后续建议。' }}
      </div>
    </div>
  </div>

  <div class="panel">
    <h3>编排事件</h3>
    <ul class="steps">
      <li v-for="item in systemEvents" :key="item.seq">
        <span class="mark" :class="item.type === 'error' ? 'failed' : 'skipped'">{{ item.seq }}</span>
        <div>
          <div>{{ eventLabel(item) }}</div>
          <div class="muted mono">{{ item.type }} · {{ formatTime(item.ts) }}</div>
        </div>
      </li>
    </ul>
    <div v-if="!systemEvents.length" class="empty">暂无编排事件</div>
  </div>

  <div v-if="job?.nextSteps?.length" class="panel">
    <h3>下一步</h3>
    <ol class="next-steps">
      <li v-for="(step, index) in job.nextSteps" :key="index">{{ step }}</li>
    </ol>
  </div>
</template>
