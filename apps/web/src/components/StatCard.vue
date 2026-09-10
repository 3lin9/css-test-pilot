<script setup lang="ts">
export type Tone = 'indigo' | 'green' | 'orange' | 'red' | 'purple'

interface Props {
  value: number | string
  label: string
  tone?: Tone
  icon?: 'folder' | 'cases' | 'play' | 'check' | 'x' | 'clock'
}

const props = withDefaults(defineProps<Props>(), { tone: 'indigo', icon: 'cases' })

const paths: Record<string, string> = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  cases: 'M4 6h2m-2 6h2m-2 6h2M10 6h10M10 12h10M10 18h10',
  play: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 9l5 3-5 3V9z',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 3',
}
const path = paths[props.icon] ?? paths.cases
</script>

<template>
  <div class="stat-card" :class="`tone-${props.tone}`">
    <div>
      <div class="num">{{ props.value }}</div>
      <div class="label">{{ props.label }}</div>
    </div>
    <div class="stat-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path :d="path" />
      </svg>
    </div>
  </div>
</template>
