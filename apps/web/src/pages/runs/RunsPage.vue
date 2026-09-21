<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api } from '../../api/client'
import type { Run } from '../../api/types'
import RunBars from '../../components/RunBars.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { formatDuration, formatTime, shortCommit } from '../../lib/format'
import { useProjectsStore } from '../../stores/projects'

const store = useProjectsStore()
const runs = ref<Run[]>([])
const filter = ref('')
const error = ref('')

function workspaceName(run: Run): string {
  if (!run.workspaceSnapshotJson) return '-'
  try {
    return (JSON.parse(run.workspaceSnapshotJson) as { name?: string }).name ?? '-'
  } catch {
    return '-'
  }
}

async function load(): Promise<void> {
  error.value = ''
  try {
    await store.ensure()
    runs.value = await api.runs(filter.value ? { status: filter.value } : {})
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(load)
watch(filter, load)
</script>

<template>
  <div class="page-head">
    <div class="page-head-row">
      <div>
        <h1 class="page-title">运行</h1>
        <p class="page-sub">执行历史:分支、提交、Workspace 快照与结果。</p>
      </div>
      <div v-if="runs.length">
        <div class="overline" style="margin-bottom: 6px">运行历史(最新在右)</div>
        <RunBars :statuses="runs.slice(0, 24).map((run) => run.status).reverse()" />
      </div>
    </div>
  </div>

  <div v-if="error" class="error-banner">{{ error }}</div>

  <div class="filters">
    <button :class="{ on: filter === '' }" @click="filter = ''">全部</button>
    <button
      v-for="status in ['running', 'passed', 'failed', 'skipped', 'cancelled']"
      :key="status"
      :class="{ on: filter === status }"
      @click="filter = status"
    >
      {{ status }}
    </button>
  </div>

  <div class="panel">
    <table v-if="runs.length">
      <thead>
        <tr><th>Run</th><th>项目</th><th>状态</th><th>分支 / 提交</th><th>Workspace</th><th>耗时</th><th>开始时间</th></tr>
      </thead>
      <tbody>
        <tr v-for="run in runs" :key="run.id">
          <td><RouterLink :to="`/runs/${run.id}`">{{ run.id }}</RouterLink></td>
          <td>{{ store.projectName(run.projectId) }}</td>
          <td><StatusBadge :status="run.status" /></td>
          <td class="mono">{{ run.branch ?? '-' }} · {{ shortCommit(run.commit) }}</td>
          <td>{{ workspaceName(run) }}</td>
          <td>{{ formatDuration(run.durationMs) }}</td>
          <td>{{ formatTime(run.startedAt) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">暂无运行记录</div>
  </div>
</template>
