<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api/client'
import type { Environment, WorkspaceDetail } from '../../api/types'
import { formatTime } from '../../lib/format'
import { useProjectsStore } from '../../stores/projects'

const route = useRoute()
const store = useProjectsStore()
const workspace = ref<WorkspaceDetail>()
const error = ref('')
const binding = ref(false)
const selectedProjectId = ref<number | null>(null)
const selectedEnvironmentId = ref<number | null>(null)
const environments = ref<Environment[]>([])

const id = computed(() => Number(route.params.id))

async function load(): Promise<void> {
  error.value = ''
  try {
    await store.ensure()
    workspace.value = await api.workspace(id.value)
    // 默认选中第一个还没绑定的项目
    const bound = new Set(workspace.value.bindings.map((b) => b.projectId))
    selectedProjectId.value =
      store.state.projects.find((p) => !bound.has(p.id))?.id ?? null
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

watch(selectedProjectId, async (projectId) => {
  selectedEnvironmentId.value = null
  environments.value = []
  if (projectId === null) return
  environments.value = await api.environments(projectId).catch(() => [])
})

async function bind(): Promise<void> {
  if (selectedProjectId.value === null || selectedEnvironmentId.value === null || binding.value) return
  binding.value = true
  try {
    await api.createBinding(id.value, {
      projectId: selectedProjectId.value,
      environmentId: selectedEnvironmentId.value,
    })
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    binding.value = false
  }
}

onMounted(load)
watch(id, load)

/** 已绑定的项目不能再绑(一个 Workspace 内每个项目一个环境) */
const bindableProjects = computed(() => {
  const bound = new Set(workspace.value?.bindings.map((b) => b.projectId) ?? [])
  return store.state.projects.filter((p) => !bound.has(p.id))
})
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">{{ workspace?.name ?? '...' }}</h1>
    <p class="page-sub">{{ workspace?.description ?? '多系统测试环境组合' }}</p>
  </div>

  <div v-if="error" class="error-banner">{{ error }}</div>

  <div class="panel">
    <div class="overline">环境组合</div>
    <h3>绑定的 Project Environment</h3>
    <p class="panel-desc">每个项目绑定一个环境;Case 声明本 Workspace 后,运行即用这套组合,并把快照写进 Run。</p>
    <table v-if="workspace?.bindings?.length">
      <thead>
        <tr><th>项目</th><th>环境</th><th>分支</th><th>Base URL</th></tr>
      </thead>
      <tbody>
        <tr v-for="b in workspace.bindings" :key="b.projectId">
          <td><RouterLink :to="`/projects/${b.projectId}`">{{ b.projectName }}</RouterLink></td>
          <td><span class="badge ok">{{ b.environmentName }}</span></td>
          <td class="mono">{{ b.branch ?? '-' }}</td>
          <td class="mono">{{ b.baseUrl ?? '-' }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">尚未绑定环境</div>
  </div>

  <div class="panel">
    <h3>绑定环境</h3>
    <p class="panel-desc">选择项目,再选择该项目的一个环境;每个项目可绑定一个环境。</p>
    <form v-if="bindableProjects.length" class="form-row" @submit.prevent="bind">
      <select v-model.number="selectedProjectId">
        <option :value="null" disabled>选择项目</option>
        <option v-for="project in bindableProjects" :key="project.id" :value="project.id">{{ project.name }}</option>
      </select>
      <select v-model.number="selectedEnvironmentId" :disabled="!environments.length">
        <option :value="null" disabled>{{ environments.length ? '选择环境' : '该项目暂无环境' }}</option>
        <option v-for="env in environments" :key="env.id" :value="env.id">
          {{ env.name }}{{ env.branch ? ` (${env.branch})` : '' }}
        </option>
      </select>
      <button class="primary" type="submit" :disabled="selectedEnvironmentId === null || binding">
        {{ binding ? '绑定中…' : '绑定' }}
      </button>
    </form>
    <p v-else class="muted" style="margin: 0">
      所有项目都已绑定到此 Workspace;要绑定新项目,先去「项目」页注册。
    </p>
  </div>

  <p class="muted" style="font-size: 12px">创建于 {{ formatTime(workspace?.createdAt ?? '') }}</p>
</template>
