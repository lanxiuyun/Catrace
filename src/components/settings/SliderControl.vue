<script setup lang="ts">
import { NSlider } from 'naive-ui'

withDefaults(defineProps<{
  modelValue: number
  min: number
  max: number
  step: number
  disabled?: boolean
  suffix?: string
}>(), {
  disabled: false,
  suffix: '',
})

defineEmits<{
  (e: 'update:modelValue', value: number): void
}>()
</script>

<template>
  <div class="slider-control">
    <n-slider
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      @update:value="$emit('update:modelValue', $event)"
    />
    <span class="setting-value">{{ modelValue }}{{ suffix }}</span>
  </div>
</template>

<style scoped>
.slider-control {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 7.5rem;
}

.slider-control :deep(.n-slider) {
  flex: 1;
}

.setting-value {
  font-size: 0.875rem;
  font-weight: 700;
  color: #7C3AED;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 3.5rem;
  text-align: right;
}
</style>
