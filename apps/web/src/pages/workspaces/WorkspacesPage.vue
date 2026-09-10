<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api } from '../../api/client'
import type { WorkspaceWithBindings } from '../../api/types'
import { formatTime } from '../../lib/format'

const workspaces = ref<WorkspaceWithBindings[]>([])
const error = ref('')
const creating = ref(false)
const form = reactive({ name: '', description: '' })

async function load(): Promise<void> {
  error.value = ''
  try {
    workspaces.value = await api.workspaces()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function create(): Promise<void> {
  if (!form.name.trim() || creating.value) return
  creating.value = true
  try {
    await api.createWorkspace({ name: form.name.trim(), description: form.description.trim() || undefined })
    form.name = ''
    form.description = ''
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    creating.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">Workspace</h1>
    <p class="page-sub">多系统测试环境组合:Case 用 <span class="mono">workspace:</span> 声明,一次运行绑定多个 Project Environment。</p>
  </div>

  <div v-if="error" class="error-banner">{{ error }}</div>

  <div class="panel">
    <div class="overline">新建</div>
    <h3>创建 Workspace</h3>
    <p class="panel-desc">名称需与 Case DSL 中的 workspace 字段一致,运行时按名称解析。</p>
    <form class="form-row" @submit.prevent="create">
      <input v-model="form.name" placeholder="名称,如:冒烟-全链路" style="width: 240px" />
      <input v-model="form.description" placeholder="描述(可选)" style="width: 320px" />
      <button class="primary" type="submit" :disabled="creating || !form.name.trim()">
        {{ creating ? '创建中…' : '+ 新建 Workspace' }}
      </button>
    </form>
  </div>

  <div class="overline" style="margin-bottom: 10px">全部 Workspace({{ workspaces.length }})</div>
  <div v-if="workspaces.length" class="ws-cards">
    <div v-for="ws in workspaces" :key="ws.id" class="ws-card">
      <div class="ws-card-head">
        <RouterLink class="ws-name" :to="`/workspaces/${ws.id}`">{{ ws.name }}</RouterLink>
        <span class="badge">{{ ws.bindings.length }} 绑定</span>
      </div>
      <p class="muted" style="margin: 2px 0 10px; font-size: 13px">{{ ws.description ?? '—' }}</p>
      <div v-for="binding in ws.bindings" :key="binding.projectId" class="ws-binding">
        <span>{{ binding.projectName }}</span>
        <span class="arrow">→</span>
        <span class="badge ok">{{ binding.environmentName }}</span>
        <span class="mono muted">{{ binding.branch ?? '-' }}</span>
      </div>
      <div v-if="!ws.bindings.length" class="muted" style="font-size: 13px; padding: 10px 0 2px">未绑定环境</div>
      <div class="muted" style="font-size: 12px; margin-top: 10px">更新于 {{ formatTime(ws.updatedAt) }}</div>
    </div>
  </div>
  <div v-else class="panel empty">还没有 Workspace</div>
</template>
