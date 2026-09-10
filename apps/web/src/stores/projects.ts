import { reactive } from 'vue'
import { api } from '../api/client'
import type { ProjectWithCount } from '../api/types'

/**
 * 项目列表的轻量共享状态:仪表盘与多个页面都会用到,
 * 避免每次路由切换都重新请求。
 */
const state = reactive<{
  projects: ProjectWithCount[]
  loading: boolean
  error: string
  loadedAt: string
}>({
  projects: [],
  loading: false,
  error: '',
  loadedAt: '',
})

export function useProjectsStore() {
  async function ensure(): Promise<void> {
    if (state.loadedAt || state.loading) return
    await refresh()
  }

  async function refresh(): Promise<void> {
    state.loading = true
    state.error = ''
    try {
      state.projects = await api.projects()
      state.loadedAt = new Date().toISOString()
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
    } finally {
      state.loading = false
    }
  }

  function projectName(id: number): string {
    return state.projects.find((project) => project.id === id)?.name ?? `#${id}`
  }

  return { state, ensure, refresh, projectName }
}
