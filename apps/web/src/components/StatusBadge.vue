<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  status?: string | null
}
const props = defineProps<Props>()
const label = props.status ?? 'unknown'

/** 三桶语义提示:blocked/inconclusive 不是产品回归,鼠标悬停可读 */
const hint = computed(() => {
  if (props.status === 'blocked') return '环境/前置受阻 — 非产品回归,优先排查环境与数据前置'
  if (props.status === 'inconclusive') return '未验证 — 规则没测到,不能视为通过'
  return undefined
})
</script>

<template>
  <span class="badge" :class="label" :title="hint">{{ label }}</span>
</template>
