/**
 * shot-name.mjs 的类型声明:运行器钩子与 ingest 必须共用同一命名规则,
 * TS 侧经包入口具名导入,实际实现在同目录的 shot-name.mjs。
 */
export function createShotNamer(): (scriptFile: string, rowId: string | number) => string
