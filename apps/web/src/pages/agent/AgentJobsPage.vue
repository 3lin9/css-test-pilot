<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../../api/client'
import type { AgentJob } from '../../api/types'
import StatusBadge from '../../components/StatusBadge.vue'
import { formatTime } from '../../lib/format'
import { useProjectsStore } from '../../stores/projects'

const route = useRoute()
const router = useRouter()
const store = useProjectsStore()
const jobs = ref<AgentJob[]>([])
const filter = ref('')
const error = ref('')
const submitting = ref(false)
const opening = ref(false)

const form = reactive({
  projectId: '',
  prompt: '',
  runAfterCreate: false,
  overwrite: false,
})

const localProjects = computed(() => store.state.projects.filter((project) => !!project.rootPath))
const selectedProject = computed(() =>
  localProjects.value.find((project) => String(project.id) === form.projectId),
)

async function load(): Promise<void> {
  error.value = ''
  try {
    await store.ensure()
    const projectFromQuery = route.query.project
    if (typeof projectFromQuery === 'string' && projectFromQuery && !form.projectId) {
      form.projectId = projectFromQuery
    }
    jobs.value = await api.agentJobs(filter.value ? { status: filter.value } : {})
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

onMounted(load)
watch(filter, load)

const visibleJobs = computed(() => {
  if (!form.projectId) return jobs.value
  return jobs.value.filter((job) => String(job.projectId) === form.projectId)
})

/** 调本机 Server 弹出系统选文件夹对话框,再登记为可写工作区 */
async function openSystemFolder(): Promise<void> {
  if (opening.value) return
  opening.value = true
  error.value = ''
  try {
    const picked = await api.pickFolder()
    if (picked.cancelled || !picked.path) return
    const project = await api.openProject(picked.path)
    await store.refresh()
    form.projectId = String(project.id)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    opening.value = false
  }
}

async function submit(): Promise<void> {
  if (!form.projectId || !form.prompt.trim() || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const job = await api.createAgentJob(Number(form.projectId), {
      prompt: form.prompt.trim(),
      runAfterCreate: form.runAfterCreate,
      overwrite: form.overwrite,
    })
    form.prompt = ''
    await router.push(`/agent/${job.id}`)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page-head">
    <div class="page-head-row">
      <div>
        <h1 class="page-title">TestPilot AI</h1>
        <p class="page-sub">Planner 规划并写入 Case，Analysis 解读运行结果。执行一律经 Skill → SDK → Engine。</p>
      </div>
    </div>
  </div>

  <div v-if="error" class="error-banner">{{ error }}</div>

  <div class="agent-arch">
    <div class="agent-arch-node accent">TestPilot AI</div>
    <div class="agent-arch-split">
      <div class="agent-arch-node">Planner<br /><span>规划测试任务</span></div>
      <div class="agent-arch-node">Analysis<br /><span>分析测试结果</span></div>
    </div>
    <div class="agent-arch-flow">Skill → SDK → Execution Engine</div>
  </div>

  <div class="panel">
    <h3>新建任务</h3>
    <p class="panel-desc">
      用系统自带对话框打开本机文件夹。Agent 把 YAML 写进该目录的 <code>tests/e2e/cases/</code>。
    </p>
    <form @submit.prevent="submit">
      <div class="form-row">
        <select v-model="form.projectId">
          <option value="">选择已打开的工作区</option>
          <option v-for="project in localProjects" :key="project.id" :value="String(project.id)">
            {{ project.name }} — {{ project.rootPath }}
          </option>
        </select>
        <button type="button" :disabled="opening" @click="openSystemFolder">
          {{ opening ? '等待系统对话框…' : '打开文件夹…' }}
        </button>
      </div>
      <p v-if="selectedProject?.rootPath" class="mono muted" style="margin: 6px 0 10px">
        将写入: {{ selectedProject.rootPath }}
      </p>
      <textarea
        v-model="form.prompt"
        class="agent-prompt"
        rows="7"
        placeholder="自然语言需求，或粘贴 ```yaml ... ``` 完整用例。&#10;例：为用户创建订单生成跨端冒烟草稿"
      />
      <div class="form-row" style="margin-top: 10px">
        <label class="check">
          <input v-model="form.runAfterCreate" type="checkbox" />
          写入后立即 run（草稿占位 locator 通常会失败，供 Analysis 归因）
        </label>
        <label class="check">
          <input v-model="form.overwrite" type="checkbox" />
          允许覆盖已存在文件
        </label>
        <button class="primary" type="submit" :disabled="submitting || !form.projectId || !form.prompt.trim()">
          {{ submitting ? '提交中…' : '启动 Planner' }}
        </button>
      </div>
    </form>
  </div>

  <div class="filters">
    <button :class="{ on: filter === '' }" @click="filter = ''">全部</button>
    <button
      v-for="status in ['queued', 'running', 'passed', 'failed', 'cancelled']"
      :key="status"
      :class="{ on: filter === status }"
      @click="filter = status"
    >
      {{ status }}
    </button>
  </div>

  <div class="panel">
    <div class="panel-head">
      <h3>任务列表</h3>
    </div>
    <table v-if="visibleJobs.length">
      <thead>
        <tr>
          <th>Job</th>
          <th>项目</th>
          <th>状态</th>
          <th>Case</th>
          <th>Run</th>
          <th>开始时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="job in visibleJobs" :key="job.id">
          <td><RouterLink :to="`/agent/${job.id}`">{{ job.id }}</RouterLink></td>
          <td>
            <RouterLink :to="`/projects/${job.projectId}`">{{ store.projectName(job.projectId) }}</RouterLink>
          </td>
          <td><StatusBadge :status="job.status" /></td>
          <td class="mono">{{ job.caseId ?? '-' }}</td>
          <td>
            <RouterLink v-if="job.runId" :to="`/runs/${job.runId}`">{{ job.runId }}</RouterLink>
            <span v-else class="muted">-</span>
          </td>
          <td>{{ formatTime(job.startedAt) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">暂无 Agent 任务</div>
  </div>
</template>
