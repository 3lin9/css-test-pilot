<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api/client'
import type { Environment, Project, Run, SyncStatus } from '../../api/types'
import RunBars from '../../components/RunBars.vue'
import StatCard from '../../components/StatCard.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import { formatDuration, formatTime, shortCommit } from '../../lib/format'
import { useProjectsStore } from '../../stores/projects'

const route = useRoute()
const store = useProjectsStore()
const project = ref<Project>()
const sync = ref<SyncStatus>()
const environments = ref<Environment[]>([])
const runs = ref<Run[]>([])
const error = ref('')
const creatingRun = ref(false)

const id = computed(() => Number(route.params.id))

async function load(): Promise<void> {
  error.value = ''
  try {
    await store.ensure()
    project.value = await api.project(id.value)
    sync.value = await api.syncStatus(id.value).catch(() => undefined)
    environments.value = await api.environments(id.value).catch(() => [])
    runs.value = (await api.runs({ projectId: id.value })).slice(0, 10)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(load)
watch(id, load)

const passedRuns = (): number => runs.value.filter((run) => run.status === 'passed').length
const failedRuns = (): number => runs.value.filter((run) => run.status === 'failed').length

const envForm = reactive({ name: '', branch: '', baseUrl: '' })
const creatingEnv = ref(false)

async function createEnvironment(): Promise<void> {
  if (!envForm.name.trim() || creatingEnv.value) return
  creatingEnv.value = true
  try {
    await api.createEnvironment(id.value, {
      name: envForm.name.trim(),
      branch: envForm.branch.trim() || undefined,
      baseUrl: envForm.baseUrl.trim() || undefined,
    })
    envForm.name = ''
    envForm.branch = ''
    envForm.baseUrl = ''
    environments.value = await api.environments(id.value).catch(() => [])
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    creatingEnv.value = false
  }
}

async function newRun(): Promise<void> {
  creatingRun.value = true
  try {
    await api.createRun({ projectId: id.value })
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    creatingRun.value = false
  }
}

/** 分支 -> 环境名(分支即测试环境) */
const envByBranch = computed(() => {
  const map = new Map<string, string>()
  for (const env of environments.value) {
    if (env.branch) map.set(env.branch, env.name)
  }
  return map
})
</script>

<template>
  <div class="page-head">
    <div class="page-head-row">
      <div>
        <h1 class="page-title">{{ project?.name ?? '...' }}</h1>
        <p class="page-sub mono">{{ project?.repositoryUrl ?? '' }}</p>
      </div>
      <button class="primary" :disabled="creatingRun" @click="newRun">
        {{ creatingRun ? '启动中…' : '+ NEW RUN' }}
      </button>
    </div>
  </div>

  <div v-if="error" class="error-banner">{{ error }}</div>

  <div class="cards">
    <StatCard :value="sync?.caseCount ?? '-'" label="Case(active)" tone="indigo" icon="cases" />
    <StatCard :value="sync?.branches?.length ?? '-'" label="测试分支" tone="purple" icon="folder" />
    <StatCard :value="passedRuns()" label="最近运行 Passed" tone="green" icon="check" />
    <StatCard :value="failedRuns()" label="最近运行 Failed" tone="red" icon="x" />
  </div>

  <div class="panel">
    <div class="panel-head">
      <div>
        <h3>Git 同步状态(按分支)</h3>
        <p class="panel-desc">分支即测试环境:每个分支的 Case 快照独立同步,互不影响。</p>
      </div>
    </div>
    <table v-if="sync?.branches?.length">
      <thead>
        <tr>
          <th>分支</th>
          <th>测试环境</th>
          <th class="num">Case 数</th>
          <th>Commit</th>
          <th>最近同步</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="info in sync.branches" :key="info.branch">
          <td class="mono">{{ info.branch }}</td>
          <td>
            <span v-if="envByBranch.get(info.branch)" class="badge ok">{{ envByBranch.get(info.branch) }}</span>
            <span v-else class="muted">未绑定</span>
          </td>
          <td class="num">{{ info.caseCount }}</td>
          <td class="mono">{{ shortCommit(info.commit) }}</td>
          <td>{{ formatTime(info.lastSyncedAt) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">尚未同步(CI 中运行 npx csspilot sync-metadata)</div>
  </div>

  <div class="panel">
    <h3>测试环境(Project Environment)</h3>
    <p class="panel-desc">环境绑定 Git 分支:分支即测试环境;每个环境一个 Base URL。多系统组合见 <RouterLink to="/workspaces">Workspace</RouterLink>。</p>
    <form class="form-row" style="margin-top: 12px" @submit.prevent="createEnvironment">
      <input v-model="envForm.name" placeholder="环境名,如:TEST" style="width: 160px" />
      <input v-model="envForm.branch" placeholder="分支,如:main" style="width: 150px" />
      <input v-model="envForm.baseUrl" placeholder="Base URL,如:https://test.shop.example.com" style="width: 320px" />
      <button class="primary" type="submit" :disabled="creatingEnv || !envForm.name.trim()">
        {{ creatingEnv ? '创建中…' : '+ 新建环境' }}
      </button>
    </form>
    <table v-if="environments.length" style="margin-top: 8px">
      <thead><tr><th>环境</th><th>分支</th><th>Base URL</th></tr></thead>
      <tbody>
        <tr v-for="env in environments" :key="env.id">
          <td>{{ env.name }}</td>
          <td class="mono">{{ env.branch ?? '-' }}</td>
          <td class="mono">{{ env.baseUrl ?? '-' }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">未配置环境</div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <div>
        <h3>最近运行</h3>
        <p class="panel-desc">展示最近 10 次;全部运行见「运行」页。</p>
      </div>
      <div v-if="runs.length">
        <div class="overline" style="margin-bottom: 6px">运行历史</div>
        <RunBars :statuses="runs.map((run) => run.status).reverse()" />
      </div>
    </div>
    <table v-if="runs.length">
      <thead><tr><th>Run</th><th>状态</th><th>分支 / 提交</th><th>耗时</th><th>开始时间</th></tr></thead>
      <tbody>
        <tr v-for="run in runs" :key="run.id">
          <td><RouterLink :to="`/runs/${run.id}`">{{ run.id }}</RouterLink></td>
          <td><StatusBadge :status="run.status" /></td>
          <td class="mono">{{ run.branch ?? '-' }} · {{ shortCommit(run.commit) }}</td>
          <td>{{ formatDuration(run.durationMs) }}</td>
          <td>{{ formatTime(run.startedAt) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">暂无运行记录</div>
  </div>
</template>
