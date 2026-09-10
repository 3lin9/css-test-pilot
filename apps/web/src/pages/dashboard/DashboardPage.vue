<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api } from '../../api/client'
import type { ProjectWithCount, Run } from '../../api/types'
import RunBars from '../../components/RunBars.vue'
import StatCard from '../../components/StatCard.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { formatTime, shortCommit } from '../../lib/format'
import { useProjectsStore } from '../../stores/projects'

const store = useProjectsStore()
const recentRuns = ref<Run[]>([])
const error = ref('')

onMounted(async () => {
  try {
    await store.ensure()
    recentRuns.value = (await api.runs()).slice(0, 20)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
})

const totalCases = (): number => store.state.projects.reduce((sum, p) => sum + p.caseCount, 0)

const greeting = computed(() => {
  const hour = new Date().getHours()
  if (hour < 5) return '晚上好'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
})

// 环形图:通过 / 失败 / 其他(进行中、已取消)
const outcomes = computed(() => {
  const passed = recentRuns.value.filter((run) => run.status === 'passed').length
  const failed = recentRuns.value.filter((run) => run.status === 'failed').length
  const other = recentRuns.value.length - passed - failed
  return { passed, failed, other, total: recentRuns.value.length }
})

const R = 54
const CIRC = 2 * Math.PI * R
const arc = (count: number): number => (outcomes.value.total > 0 ? (count / outcomes.value.total) * CIRC : 0)
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">{{ greeting }}</h1>
    <p class="page-sub">测试资产与执行概况总览。</p>
  </div>

  <div v-if="error" class="error-banner">{{ error }}(请确认 TestPilot Server 已启动)</div>

  <div class="cards">
    <StatCard :value="store.state.projects.length" label="项目总数" tone="purple" icon="folder" />
    <StatCard :value="totalCases()" label="Case(active)" tone="green" icon="cases" />
    <StatCard :value="outcomes.total" label="最近运行" tone="orange" icon="play" />
    <StatCard :value="outcomes.failed" label="最近运行 Failed" tone="red" icon="x" />
  </div>

  <div class="grid-2">
    <div class="panel">
      <div class="overline">Run 结果</div>
      <h3>最近 20 次运行</h3>
      <p class="panel-desc">按状态统计,最新在上。</p>
      <div class="donut-wrap">
        <div class="donut">
          <svg width="148" height="148" viewBox="0 0 148 148">
            <circle cx="74" cy="74" :r="R" fill="none" stroke="#e9ebf2" stroke-width="16" />
            <template v-if="outcomes.total > 0">
              <circle cx="74" cy="74" :r="R" fill="none" stroke="var(--ok)" stroke-width="16"
                :stroke-dasharray="`${arc(outcomes.passed)} ${CIRC - arc(outcomes.passed)}`" stroke-dashoffset="0" />
              <circle cx="74" cy="74" :r="R" fill="none" stroke="var(--fail)" stroke-width="16"
                :stroke-dasharray="`${arc(outcomes.failed)} ${CIRC - arc(outcomes.failed)}`"
                :stroke-dashoffset="-arc(outcomes.passed)" />
              <circle cx="74" cy="74" :r="R" fill="none" stroke="#d8dbe6" stroke-width="16"
                :stroke-dasharray="`${arc(outcomes.other)} ${CIRC - arc(outcomes.other)}`"
                :stroke-dashoffset="-(arc(outcomes.passed) + arc(outcomes.failed))" />
            </template>
          </svg>
          <div class="donut-center">
            <div class="num">{{ outcomes.total }}</div>
            <div class="label">Total Runs</div>
          </div>
        </div>
        <div class="donut-legend">
          <div class="row"><span class="swatch" style="background: var(--ok)"></span>通过<span class="value">{{ outcomes.passed }}</span></div>
          <div class="row"><span class="swatch" style="background: var(--fail)"></span>失败<span class="value">{{ outcomes.failed }}</span></div>
          <div class="row"><span class="swatch" style="background: #d8dbe6"></span>其他<span class="value">{{ outcomes.other }}</span></div>
        </div>
      </div>
      <div class="overline" style="margin: 18px 0 8px">运行历史</div>
      <RunBars :statuses="recentRuns.map((run) => run.status).reverse()" />
    </div>

    <div class="panel">
      <div class="overline">最近运行</div>
      <h3>执行记录</h3>
      <p class="panel-desc">点击 Run 查看步骤级结果、截图与 Trace。</p>
      <table v-if="recentRuns.length">
        <thead>
          <tr><th>Run</th><th>项目</th><th>状态</th><th>分支 / 提交</th><th>开始时间</th></tr>
        </thead>
        <tbody>
          <tr v-for="run in recentRuns" :key="run.id">
            <td><RouterLink :to="`/runs/${run.id}`">{{ run.id }}</RouterLink></td>
            <td>{{ store.projectName(run.projectId) }}</td>
            <td><StatusBadge :status="run.status" /></td>
            <td class="mono">{{ run.branch ?? '-' }} · {{ shortCommit(run.commit) }}</td>
            <td>{{ formatTime(run.startedAt) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty">暂无运行记录</div>
    </div>
  </div>

  <div class="panel">
    <div class="overline">项目</div>
    <h3>项目列表</h3>
    <p class="panel-desc">每个项目对应一个业务 Git 仓库,Case 以本地文件为 Source of Truth。</p>
    <table v-if="store.state.projects.length">
      <thead>
        <tr><th>项目</th><th class="num">Case 数</th><th>分支</th><th>最近同步 Commit</th><th>最近同步时间</th></tr>
      </thead>
      <tbody>
        <tr v-for="project in store.state.projects" :key="project.id">
          <td><RouterLink :to="`/projects/${project.id}`">{{ project.name }}</RouterLink></td>
          <td class="num">{{ project.caseCount }}</td>
          <td class="mono">{{ project.defaultBranch ?? '-' }}</td>
          <td class="mono">{{ shortCommit(project.lastSyncedCommit) }}</td>
          <td>{{ formatTime(project.lastSyncedAt) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else-if="!store.state.loading" class="empty">还没有项目,去「项目」页注册</div>
  </div>
</template>
