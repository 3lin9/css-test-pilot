<script setup lang="ts">
/** 条形码式运行历史:每个小竖条代表一次运行,颜色即结果;titles 可选逐条悬停说明 */
interface Props {
  statuses: string[]
  titles?: string[]
}

const props = defineProps<Props>()
</script>

<template>
  <span class="run-bars">
    <span
      v-for="(status, index) in props.statuses"
      :key="index"
      class="bar"
      :class="status"
      :title="props.titles?.[index] ?? status"
    ></span>
  </span>
</template>
