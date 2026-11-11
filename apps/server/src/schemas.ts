import { z } from 'zod'

/**
 * 路由请求体的 zod schema。
 * 此前路由一律 `(body ?? {}) as T` 直转:多传/错型的字段会静默落到服务层,
 * 引发难排查的 500 或脏数据;这里统一在边界上把形状校验做掉,坏请求早失败(400)。
 */

/** 解析并校验请求体;不合法时抛 400(信息带首个出错字段) */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {})
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue && issue.path.length > 0 ? issue.path.map(String).join('.') : 'body'
    throw Object.assign(new Error(`请求体不合法:${where} ${issue?.message ?? ''}`.trim()), {
      statusCode: 400,
    })
  }
  return result.data
}

// ---- runs ----

export const createRunSchema = z.object({
  projectId: z.number().int().positive().optional(),
  paths: z.array(z.string()).optional(),
  tag: z.string().optional(),
  branch: z.string().optional(),
  commit: z.string().optional(),
  workspaceId: z.number().int().positive().optional(),
})

// ---- projects ----

export const openProjectSchema = z.object({
  rootPath: z.string().min(1),
})

export const createProjectSchema = z.object({
  name: z.string().default(''),
  rootPath: z.string().optional(),
  repositoryUrl: z.string().optional(),
  defaultBranch: z.string().optional(),
})

// ---- case sync ----

export const caseSyncSchema = z.object({
  repository: z.string().optional(),
  branch: z.string().min(1),
  commit: z.string().min(1),
  cases: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().optional(),
        file: z.string().min(1),
        tags: z.array(z.string()).optional(),
      }),
    )
    .max(2000),
})

// ---- workspaces / environments / secrets / bindings ----

export const secretUpsertSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
})

export const environmentSchema = z.object({
  name: z.string().min(1),
  branch: z.string().nullish(),
  baseUrl: z.string().nullish(),
})

export const workspaceSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
})

export const bindingSchema = z.object({
  projectId: z.number().int().positive(),
  environmentId: z.number().int().positive(),
})
