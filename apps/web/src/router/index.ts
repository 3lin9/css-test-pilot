import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('../pages/dashboard/DashboardPage.vue') },
    { path: '/projects', name: 'projects', component: () => import('../pages/projects/ProjectsPage.vue') },
    {
      path: '/projects/:id',
      name: 'project-detail',
      component: () => import('../pages/projects/ProjectDetailPage.vue'),
    },
    {
      path: '/projects/:id/cases',
      name: 'cases',
      component: () => import('../pages/cases/CasesPage.vue'),
    },
    { path: '/runs', name: 'runs', component: () => import('../pages/runs/RunsPage.vue') },
    {
      path: '/runs/:id',
      name: 'run-detail',
      component: () => import('../pages/runs/RunDetailPage.vue'),
    },
    {
      path: '/workspaces',
      name: 'workspaces',
      component: () => import('../pages/workspaces/WorkspacesPage.vue'),
    },
    {
      path: '/workspaces/:id',
      name: 'workspace-detail',
      component: () => import('../pages/workspaces/WorkspaceDetailPage.vue'),
    },
    { path: '/agent', name: 'agent', component: () => import('../pages/agent/AgentJobsPage.vue') },
    {
      path: '/agent/:id',
      name: 'agent-job',
      component: () => import('../pages/agent/AgentJobDetailPage.vue'),
    },
    { path: '/reports', name: 'reports', component: () => import('../pages/reports/ReportsPage.vue') },
  ],
})
