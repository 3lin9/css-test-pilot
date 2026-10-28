<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from './api/client'

const serverOk = ref<boolean | null>(null)

onMounted(async () => {
  serverOk.value = await api
    .health()
    .then(() => true)
    .catch(() => false)
})
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <div class="logo-mark">TP</div>
      <div class="brand">Test<span>Pilot</span></div>
      <div class="topbar-divider"></div>
      <div class="topbar-context">测试控制台</div>
    </div>
    <div class="topbar-right">
      <span class="health">
        <span class="dot" :class="{ down: serverOk === false }"></span>
        {{ serverOk === false ? 'Server 未连接' : 'Server 已连接' }}
      </span>
      <div class="avatar" title="TestPilot">T</div>
    </div>
  </header>

  <div class="shell">
    <aside class="sidebar">
      <RouterLink class="nav-icon" to="/" title="仪表盘">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
      </RouterLink>
      <RouterLink class="nav-icon" to="/projects" title="项目">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>
      </RouterLink>
      <RouterLink class="nav-icon" to="/runs" title="运行">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><path d="M10 9l5 3-5 3V9z" fill="currentColor" stroke="none" /></svg>
      </RouterLink>
      <RouterLink class="nav-icon" to="/workspaces" title="Workspace">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /><path d="M3 17l9 5 9-5" /></svg>
      </RouterLink>
      <RouterLink class="nav-icon" to="/reports" title="报告">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h9l4 4v14H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h6" /></svg>
      </RouterLink>
      <div class="sidebar-spacer"></div>
      <div class="sidebar-user" title="TestPilot">T</div>
    </aside>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>
