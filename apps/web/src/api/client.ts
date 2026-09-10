import type {
  ArtifactFile,
  CaseView,
  Environment,
  Project,
  ProjectWithCount,
  Run,
  RunEvent,
  RunSummary,
  SyncStatus,
  WorkspaceDetail,
  WorkspaceWithBindings,
} from './types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new Error(detail || `${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

/** Web 只通过 Control Plane API 访问数据;所有请求同源(开发态走 Vite 代理) */
export const api = {
  health: () => request<{ ok: boolean; project: { id: number; name: string } }>('/api/health'),

  // ---- projects ----
  projects: () => request<{ projects: ProjectWithCount[] }>('/api/projects').then((r) => r.projects),
  project: (id: number) => request<Project>(`/api/projects/${id}`),
  createProject: (body: { name: string; repositoryUrl?: string; rootPath?: string; defaultBranch?: string }) =>
    request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(body) }),
  syncStatus: (id: number) => request<SyncStatus>(`/api/projects/${id}/sync-status`),
  environments: (id: number) =>
    request<{ environments: Environment[] }>(`/api/projects/${id}/environments`).then((r) => r.environments),
  createEnvironment: (projectId: number, body: { name: string; branch?: string; baseUrl?: string }) =>
    request<Environment>(`/api/projects/${projectId}/environments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ---- cases ----
  cases: (projectId: number, status?: 'active' | 'deleted') =>
    request<{ cases: CaseView[] }>(
      `/api/projects/${projectId}/cases${status ? `?status=${status}` : ''}`,
    ).then((r) => r.cases),
  caseSource: (projectId: number, caseId: string) =>
    request<CaseView & { source: string }>(`/api/projects/${projectId}/cases/${caseId}/source`),
  syncCases: (projectId: number, payload: unknown) =>
    request<{ added: number; updated: number; deleted: number; activeTotal: number }>(
      `/api/projects/${projectId}/cases/sync`,
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  // ---- runs ----
  runs: (filter: { projectId?: number; status?: string } = {}) => {
    const params = new URLSearchParams()
    if (filter.projectId !== undefined) params.set('projectId', String(filter.projectId))
    if (filter.status) params.set('status', filter.status)
    const query = params.toString()
    return request<{ runs: Run[] }>(`/api/runs${query ? `?${query}` : ''}`).then((r) => r.runs)
  },
  run: (id: string) => request<Run>(`/api/runs/${id}`),
  runEvents: (id: string) =>
    request<{ events: RunEvent[] }>(`/api/runs/${id}/events`).then((r) => r.events),
  runSummary: (id: string) => request<RunSummary>(`/api/runs/${id}/summary`),
  runArtifacts: (id: string) =>
    request<{ files: ArtifactFile[] }>(`/api/runs/${id}/artifacts`).then((r) => r.files),
  cancelRun: (id: string) => request<Run>(`/api/runs/${id}/cancel`, { method: 'POST' }),
  createRun: (body: { projectId?: number; paths?: string[]; tag?: string }) =>
    request<Run>('/api/runs', { method: 'POST', body: JSON.stringify(body) }),
  report: (id: string) =>
    request<{ runId: string; jsonPath: string; htmlPath: string }>(`/api/runs/${id}/report`),

  // ---- artifacts ----
  artifactUrl: (runId: string, path: string) => `/api/runs/${runId}/artifacts/${path}`,

  // ---- workspaces ----
  workspaces: () =>
    request<{ workspaces: WorkspaceWithBindings[] }>('/api/workspaces').then((r) => r.workspaces),
  workspace: (id: number) => request<WorkspaceDetail>(`/api/workspaces/${id}`),
  createWorkspace: (body: { name: string; description?: string }) =>
    request<WorkspaceDetail>('/api/workspaces', { method: 'POST', body: JSON.stringify(body) }),
  createBinding: (workspaceId: number, body: { projectId: number; environmentId: number }) =>
    request<unknown>(`/api/workspaces/${workspaceId}/bindings`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
}
