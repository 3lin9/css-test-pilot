<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api/client'
import type { Environment, Project, ProjectOverview, Run, SyncStatus, WorkspaceWithBindings } from '../../api/types'
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
/** 跨 run 汇总(远端项目 422 时为空,健康 panel 隐藏) */
const overview = ref<ProjectOverview>()
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
    workspaces.value = await api.workspaces().catch(() => [])
    overview.value = await api.projectOverview(id.value).catch(() => undefined)
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

/** 行内编辑环境(分支 / Base URL 后续可能要改) */
const editingEnvId = ref<number | null>(null)
const envEditForm = reactive({ name: '', branch: '', baseUrl: '' })
const savingEnv = ref(false)

function startEditEnv(env: Environment): void {
  editingEnvId.value = env.id
  envEditForm.name = env.name
  envEditForm.branch = env.branch ?? ''
  envEditForm.baseUrl = env.baseUrl ?? ''
}

function cancelEditEnv(): void {
  editingEnvId.value = null
}

async function saveEnv(): Promise<void> {
  if (editingEnvId.value === null || !envEditForm.name.trim() || savingEnv.value) return
  savingEnv.value = true
  try {
    await api.updateEnvironment(id.value, editingEnvId.value, {
      name: envEditForm.name.trim(),
      branch: envEditForm.branch.trim() || null,
      baseUrl: envEditForm.baseUrl.trim() || null,
    })
    editingEnvId.value = null
    environments.value = await api.environments(id.value).catch(() => [])
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    savingEnv.value = false
  }
}

/** 运行参数化:paths/grep/workspace 全部可留空 = 全量运行 */
const workspaces = ref<WorkspaceWithBindings[]>([])
const runPanelOpen = ref(false)
const runForm = reactive({ paths: '', grep: '', workspaceId: null as number | null })

function parsePaths(): string[] | undefined {
  const list = runForm.paths.split(/[\s,]+/).filter(Boolean)
  return list.length ? list : undefined
}

async function newRun(): Promise<void> {
  creatingRun.value = true
  try {
    await api.createRun({
      projectId: id.value,
      paths: parsePaths(),
      grep: runForm.grep.trim() || undefined,
      workspaceId: runForm.workspaceId ?? undefined,
    })
    runPanelOpen.value = false
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
      <div class="form-row">
        <button :disabled="creatingRun" @click="runPanelOpen = !runPanelOpen">
          {{ runPanelOpen ? '收起参数' : '运行参数' }}
        </button>
        <button class="primary" :disabled="creatingRun" @click="newRun">
          {{ creatingRun ? '启动中…' : '+ NEW RUN' }}
        </button>
      </div>
    </div>
  </div>

  <div v-if="error" class="error-banner">{{ error }}</div>

  <div v-if="runPanelOpen" class="panel">
    <h3>运行参数(全部可留空 = 全量运行)</h3>
    <p class="panel-desc">paths 过滤用例文件;grep 过滤用例名;Workspace 决定多系统环境组合(不选则按项目默认环境解析,secret 注入见 Workspace 凭据)。</p>
    <form style="margin-top: 12px" @submit.prevent="newRun">
      <div class="form-row">
        <input v-model="runForm.paths" placeholder="用例文件过滤,逗号/空格分隔,如: checkout/refund.spec.yaml" style="flex: 1" />
      </div>
      <div class="form-row" style="margin-top: 8px">
        <input v-model="runForm.grep" placeholder="用例名过滤(grep 子串匹配),如: 登录" style="width: 320px" />
        <select v-model.number="runForm.workspaceId" style="width: 240px">
          <option :value="null">不使用 Workspace</option>
          <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">{{ ws.name }}({{ ws.bindings.length }} 绑定)</option>
        </select>
        <button class="primary" type="submit" :disabled="creatingRun">
          {{ creatingRun ? '启动中…' : '发起运行' }}
        </button>
      </div>
    </form>
  </div>

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
      <thead><tr><th>环境</th><th>分支</th><th>Base URL</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="env in environments" :key="env.id">
          <td>{{ env.name }}</td>
          <td class="mono">{{ env.branch ?? '-' }}</td>
          <td class="mono">{{ env.baseUrl ?? '-' }}</td>
          <td>
            <button v-if="editingEnvId !== env.id" @click="startEditEnv(env)">编辑</button>
            <span v-else class="muted">编辑中…</span>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">未配置环境</div>

    <form v-if="editingEnvId !== null" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(128, 128, 128, 0.25)" @submit.prevent="saveEnv">
      <div class="form-row">
        <input v-model="envEditForm.name" placeholder="环境名" style="width: 160px" />
        <input v-model="envEditForm.branch" placeholder="分支" style="width: 150px" />
        <input v-model="envEditForm.baseUrl" placeholder="Base URL" style="width: 320px" />
        <button class="primary" type="submit" :disabled="savingEnv || !envEditForm.name.trim()">
          {{ savingEnv ? '保存中…' : '保存' }}
        </button>
        <button type="button" :disabled="savingEnv" @click="cancelEditEnv">取消</button>
      </div>
    </form>
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

  <div v-if="overview" class="panel">
    <div class="panel-head">
      <div>
        <h3>用例健康(最近 {{ overview.runs.length }} 次运行)</h3>
        <p class="panel-desc">回归热点与清淤线索;用例级历史迷你条见 <RouterLink :to="`/projects/${id}/cases`">Case Index</RouterLink>。</p>
      </div>
    </div>
    <template v-if="overview.topFailures.length || overview.staleCases.length">
      <table v-if="overview.topFailures.length">
        <thead><tr><th>Case</th><th>文件</th><th class="num">近期失败次数</th></tr></thead>
        <tbody>
          <tr v-for="item in overview.topFailures" :key="item.caseId">
            <td class="mono">{{ item.caseId }} · {{ item.caseName }}</td>
            <td class="mono">{{ item.file }}</td>
            <td class="num error-text">{{ item.failCount }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="overview.staleCases.length" class="muted" style="margin: 12px 0 0">
        ⚠ {{ overview.staleCases.length }} 个 active 用例最近 14 天没跑过(含从未跑过)——
        去 <RouterLink :to="`/projects/${id}/cases`">Case Index</RouterLink> 用「最近 14 天没跑」筛选清淤。
      </p>
    </template>
    <div v-else class="empty">暂无失败热点与失常用例</div>
  </div>
</template>
