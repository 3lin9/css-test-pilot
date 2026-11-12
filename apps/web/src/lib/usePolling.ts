import { onUnmounted, watch, type Ref } from 'vue'

/**
 * 条件轮询:active 为 true 时按间隔执行 fn(运行页自动刷新),
 * 变 false 或组件卸载时停止。同一时刻至多一个计时器。
 */
export function usePolling(active: Ref<boolean>, fn: () => Promise<void>, intervalMs = 3000): void {
  let timer: ReturnType<typeof setInterval> | undefined
  const sync = (): void => {
    if (active.value && timer === undefined) {
      timer = setInterval(() => void fn(), intervalMs)
    } else if (!active.value && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
  watch(active, sync, { immediate: true })
  onUnmounted(() => {
    if (timer !== undefined) clearInterval(timer)
  })
}
