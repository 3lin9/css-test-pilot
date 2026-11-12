<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api/client'
import type { Environment, SecretKeyEntry, WorkspaceBinding, WorkspaceDetail } from '../../api/types'
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

/** 当前展开凭据管理的绑定(一次一个;值只写不回显,列表仅回 key) */
const secretEnv = ref<{ projectId: number; environmentId: number; projectName: string; environmentName: string } | null>(null)
const secrets = ref<SecretKeyEntry[]>([])
const secretsLoading = ref(false)
const secretForm = reactive({ key: '', value: '' })
const secretBusy = ref(false)

function toggleSecrets(b: WorkspaceBinding): void {
  if (secretEnv.value?.projectId === b.projectId) {
    secretEnv.value = null
    secrets.value = []
    return
  }
  secretEnv.value = {
    projectId: b.projectId,
    environmentId: b.environmentId,
    projectName: b.projectName,
    environmentName: b.environmentName,
  }
  void reloadSecrets()
}

async function reloadSecrets(): Promise<void> {
  const env = secretEnv.value
  if (!env) return
  secretsLoading.value = true
  try {
    secrets.value = await api.environmentSecrets(env.projectId, env.environmentId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    secretsLoading.value = false
  }
}

async function saveSecret(): Promise<void> {
  const env = secretEnv.value
  if (!env || !secretForm.key.trim() || !secretForm.value || secretBusy.value) return
  secretBusy.value = true
  try {
    await api.upsertEnvironmentSecret(env.projectId, env.environmentId, {
      key: secretForm.key.trim(),
      value: secretForm.value,
    })
    secretForm.key = ''
    secretForm.value = ''
    await reloadSecrets()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    secretBusy.value = false
  }
}

async function removeSecret(key: string): Promise<void> {
  const env = secretEnv.value
  if (!env) return
  try {
    await api.deleteEnvironmentSecret(env.projectId, env.environmentId, key)
    await reloadSecrets()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}
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
        <tr><th>项目</th><th>环境</th><th>分支</th><th>Base URL</th><th>凭据</th></tr>
      </thead>
      <tbody>
        <tr v-for="b in workspace.bindings" :key="b.projectId">
          <td><RouterLink :to="`/projects/${b.projectId}`">{{ b.projectName }}</RouterLink></td>
          <td><span class="badge ok">{{ b.environmentName }}</span></td>
          <td class="mono">{{ b.branch ?? '-' }}</td>
          <td class="mono">{{ b.baseUrl ?? '-' }}</td>
          <td>
            <button @click="toggleSecrets(b)">
              {{ secretEnv?.projectId === b.projectId ? '收起' : '管理' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="empty">尚未绑定环境</div>

    <div v-if="secretEnv" style="margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(128, 128, 128, 0.25)">
      <h3>环境凭据 — {{ secretEnv.projectName }} / {{ secretEnv.environmentName }}</h3>
      <p class="panel-desc">运行时注入为用例进程的环境变量(secretKey 即变量名,约定 TESTPILOT_ACCOUNT_*;另有 Base URL → TESTPILOT_BASE_URL)。值只写不回显。</p>
      <form class="form-row" style="margin: 8px 0" @submit.prevent="saveSecret">
        <input v-model="secretForm.key" placeholder="变量名,如: TESTPILOT_ACCOUNT_BUYER" style="width: 280px" />
        <input v-model="secretForm.value" type="password" placeholder="值(保存后不可回显)" style="width: 260px" autocomplete="new-password" />
        <button class="primary" type="submit" :disabled="secretBusy || !secretForm.key.trim() || !secretForm.value">
          {{ secretBusy ? '保存中…' : '保存' }}
        </button>
      </form>
      <table v-if="secrets.length">
        <thead><tr><th>变量名</th><th>更新时间</th><th></th></tr></thead>
        <tbody>
          <tr v-for="s in secrets" :key="s.secretKey">
            <td class="mono">{{ s.secretKey }}</td>
            <td class="muted">{{ formatTime(s.updatedAt) }}</td>
            <td><button @click="removeSecret(s.secretKey)">删除</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!secretsLoading" class="muted" style="margin: 8px 0 0">尚未配置凭据</p>
    </div>
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
