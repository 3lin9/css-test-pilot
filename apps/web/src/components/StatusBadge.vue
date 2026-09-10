<script setup lang="ts">
interface Props {
  status?: string | null
}
const props = defineProps<Props>()
const label = props.status ?? 'unknown'
</script>

<template>
  <span class="badge" :class="label">{{ label }}</span>
</template>
