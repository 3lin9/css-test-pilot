<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../../api/client'
import { formatTime } from '../../lib/format'
import { useProjectsStore } from '../../stores/projects'

const store = useProjectsStore()
const router = useRouter()
const error = ref('')
const form = reactive({ name: '', repositoryUrl: '', rootPath: '' })
const submitting = ref(false)

onMounted(() => {
  void store.refresh()
})

async function submit(): Promise<void> {
  if (!form.name.trim()) {
    error.value = '项目名称不能为空'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    const project = await api.createProject({
      name: form.name.trim(),
      repositoryUrl: form.repositoryUrl.trim() || undefined,
      rootPath: form.rootPath.trim() || undefined,
    })
    form.name = ''
    form.repositoryUrl = ''
    form.rootPath = ''
    await store.refresh()
    await router.push(`/projects/${project.id}`)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">项目</h1>
    <p class="page-sub">被测业务代码 / Git 项目;项目拥有测试环境,可组合进 Workspace。</p>
  </div>

  <div v-if="error" class="error-banner">{{ error }}</div>

  <div class="panel">
    <h3>注册项目</h3>
    <form class="toolbar" @submit.prevent="submit">
      <input v-model="form.name" placeholder="项目名称 *" />
      <input v-model="form.repositoryUrl" placeholder="Git 仓库地址" style="width: 280px" />
      <input v-model="form.rootPath" placeholder="本地根目录(可选,供本地执行)" style="width: 280px" />
      <button class="primary" type="submit" :disabled="submitting">注册</button>
    </form>
  </div>

  <div class="panel">
    <h3>项目列表</h3>
    <table v-if="store.state.projects.length">
      <thead>
        <tr>
          <th>项目</th><th>Git 仓库</th><th class="num">Case 数</th><th>分支</th><th>最近同步</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="project in store.state.projects" :key="project.id">
          <td><RouterLink :to="`/projects/${project.id}`">{{ project.name }}</RouterLink></td>
          <td class="mono">{{ project.repositoryUrl ?? '-' }}</td>
          <td class="num">{{ project.caseCount }}</td>
          <td class="mono">{{ project.defaultBranch ?? '-' }}</td>
          <td>{{ formatTime(project.lastSyncedAt) }}</td>
        </tr>
      </tbody>
    </table>
    <div v-else-if="!store.state.loading" class="empty">还没有项目</div>
  </div>
</template>
