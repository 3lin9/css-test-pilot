/** V0.1 顺序调度器:按顺序逐个执行,不做并发与重试 */
export async function runSequential<T, R>(
  items: readonly T[],
  handler: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  for (const [index, item] of items.entries()) {
    results.push(await handler(item, index))
  }
  return results
}
