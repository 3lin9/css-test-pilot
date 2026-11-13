<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api/client'
import type { CaseView, Environment, ProjectOverview, SyncStatus } from '../../api/types'
import RunBars from '../../components/RunBars.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { formatTime, shortCommit } from '../../lib/format'

const route = useRoute()
const cases = ref<CaseView[]>([])
const sync = ref<SyncStatus>()
const environments = ref<Environment[]>([])
/** 跨 run 汇总(远端项目 422 时为空,迷你条/清淤视图随之隐藏) */
const overview = ref<ProjectOverview>()
const staleOnly = ref(false)
const branchFilter = ref('')
const filter = ref<'all' | 'active' | 'deleted'>('all')
const error = ref('')
const selected = ref<CaseView & { source?: string }>()
const sourceLoading = ref(false)

const projectId = computed(() => Number(route.params.id))

/** 分支 -> 环境名(分支即测试环境;未配置映射时显示分支名) */
const envByBranch = computed(() => {
  const map = new Map<string, string>()
  for (const env of environments.value) {
    if (env.branch) map.set(env.branch, env.name)
  }
  return map
})

/** caseId -> 用例级历史(迷你条数据源) */
const trendByCase = computed(() => {
  const map = new Map<string, ProjectOverview['cases'][number]>()
  for (const item of overview.value?.cases ?? []) map.set(item.caseId, item)
  return map
})

const staleIds = computed(() => new Set((overview.value?.staleCases ?? []).map((item) => item.caseId)))

const branchOptions = computed(() => {
  const names = new Set<string>()
  for (const item of cases.value) {
    for (const branch of item.branches) names.add(branch)
  }
  for (const info of sync.value?.branches ?? []) names.add(info.branch)
  return [...names].sort()
})

const visibleCases = computed(() => {
  let list = cases.value
  if (branchFilter.value) list = list.filter((item) => item.branches.includes(branchFilter.value))
  if (staleOnly.value) list = list.filter((item) => staleIds.value.has(item.caseId))
  return list
})

async function load(): Promise<void> {
  error.value = ''
  selected.value = undefined
  try {
    cases.value = await api.cases(projectId.value, filter.value === 'all' ? undefined : filter.value)
    sync.value = await api.syncStatus(projectId.value).catch(() => undefined)
    environments.value = await api.environments(projectId.value).catch(() => [])
    overview.value = await api.projectOverview(projectId.value).catch(() => undefined)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function openDetail(item: CaseView): Promise<void> {
  selected.value = item
  sourceLoading.value = true
  try {
    selected.value = { ...item, source: (await api.caseSource(projectId.value, item.caseId)).source }
  } catch {
    // 远端项目(无本地根目录)无法读取源文件:仅展示元数据
    selected.value = { ...item }
  } finally {
    sourceLoading.value = false
  }
}

function envLabel(branch: string): string {
  return envByBranch.value.get(branch) ?? branch
}

onMounted(load)
watch([projectId, filter], load)
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">Case Index <span class="muted">(#{{ projectId }})</span></h1>
    <p class="page-sub">
      Git 是 Case 的 Source of Truth;分支即测试环境,同一 Case 可同时存在于多个分支。
    </p>
  </div>

  <div v-if="error" class="error-banner">{{ error }}</div>

  <div class="toolbar">
    <div class="filters" style="margin-bottom: 0">
      <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部</button>
      <button :class="{ on: filter === 'active' }" @click="filter = 'active'">Active</button>
      <button :class="{ on: filter === 'deleted' }" @click="filter = 'deleted'">Deleted</button>
      <button
        v-if="staleIds.size > 0"
        :class="{ on: staleOnly }"
        title="最近 14 天没在任何 run 里跑过的 active 用例(含从未跑过)——清淤时优先处理"
        @click="staleOnly = !staleOnly"
      >
        最近 14 天没跑({{ staleIds.size }})
      </button>
    </div>
    <select v-model="branchFilter">
      <option value="">全部分支({{ branchOptions.length }})</option>
      <option v-for="branch in branchOptions" :key="branch" :value="branch">
        {{ branch }}{{ envByBranch.get(branch) ? ` → ${envByBranch.get(branch)}` : '' }}
      </option>
    </select>
    <span class="muted">按测试环境(分支)筛选 Case</span>
  </div>

  <div class="panel">
    <table v-if="visibleCases.length">
      <thead>
        <tr>
          <th>Case ID</th><th>名称</th><th>文件</th><th>历史</th><th>标签</th><th>测试环境(分支)</th><th>状态</th><th>同步时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in visibleCases" :key="item.id" style="cursor: pointer" @click="openDetail(item)">
          <td class="mono">{{ item.caseId }}</td>
          <td>{{ item.name ?? '-' }}</td>
          <td class="mono">{{ item.filePath }}</td>
          <td>
            <RunBars
              v-if="trendByCase.get(item.caseId)?.history.length"
              :statuses="trendByCase.get(item.caseId)!.history.map((point) => point.status)"
              :titles="trendByCase.get(item.caseId)!.history.map((point) => `${point.runId} · ${point.status}`)"
            />
            <span v-else class="muted" title="最近 20 次 run 中未出现">未跑</span>
          </td>
          <td><span v-for="tag in item.tags" :key="tag" class="badge active" style="margin-right: 4px">{{ tag }}</span></td>
          <td>
            <span
              v-for="branch in item.branches"
              :key="branch"
              class="badge ok"
              style="margin-right: 4px"
              :title="branch"
            >{{ envLabel(branch) }}</span>
            <span v-if="item.branches.length === 0" class="muted">-</span>
          </td>
          <td><StatusBadge :status="item.status" /></td>
          <td>{{ formatTime(item.checkedAt) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">Case Index 为空(CI 中运行 npx csspilot sync-metadata 同步)</div>
  </div>

  <div v-if="selected" class="panel">
    <h3>{{ selected.caseId }} · {{ selected.name ?? '' }}</h3>
    <p class="panel-desc mono">
      {{ selected.filePath }}
      · 存在于:{{ selected.branches.map(envLabel).join(', ') || '-' }}
      · 最近同步 {{ shortCommit(selected.commit) }}
    </p>
    <div v-if="sourceLoading" class="muted">读取源文件中...</div>
    <pre v-else-if="selected.source">{{ selected.source }}</pre>
    <div v-else class="muted">该项目未配置本地根目录,无法读取 Case 源文件(仅展示元数据)</div>
  </div>
</template>
