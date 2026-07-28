<script setup lang="ts">
import { ref, watch } from 'vue'
import { NSlider } from 'naive-ui'

const props = withDefaults(defineProps<{
  modelValue: number
  min: number
  max: number
  step: number
  disabled?: boolean
  suffix?: string
  /** 允许点击数值直接输入 */
  editable?: boolean
}>(), {
  disabled: false,
  suffix: '',
  editable: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void
}>()

const draft = ref(String(props.modelValue))

watch(() => props.modelValue, (v) => {
  draft.value = String(v)
})

function clamp(n: number): number {
  let v = Math.round(n / props.step) * props.step
  if (v < props.min) v = props.min
  if (v > props.max) v = props.max
  return v
}

function commit() {
  const raw = draft.value.trim()
  const n = Number(raw)
  if (!Number.isFinite(n) || raw === '') {
    draft.value = String(props.modelValue)
    return
  }
  const next = clamp(n)
  draft.value = String(next)
  if (next !== props.modelValue) {
    emit('update:modelValue', next)
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    ;(e.target as HTMLInputElement).blur()
  } else if (e.key === 'Escape') {
    draft.value = String(props.modelValue)
    ;(e.target as HTMLInputElement).blur()
  }
}
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
    <label v-if="editable" class="setting-value setting-value-edit" :class="{ disabled }">
      <input
        class="setting-value-input"
        type="text"
        inputmode="numeric"
        :value="draft"
        :disabled="disabled"
        @input="draft = ($event.target as HTMLInputElement).value"
        @blur="commit"
        @keydown="onKeydown"
      />
      <span v-if="suffix" class="setting-value-suffix">{{ suffix }}</span>
    </label>
    <span v-else class="setting-value">{{ modelValue }}{{ suffix }}</span>
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

.setting-value-edit {
  display: inline-flex;
  align-items: center;
  gap: 0.125rem;
  min-width: 3.5rem;
  justify-content: flex-end;
  cursor: text;
}

.setting-value-edit.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.setting-value-input {
  width: 2.25rem;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  background: transparent;
  padding: 0.125rem 0.25rem;
  font-size: 0.875rem;
  font-weight: 700;
  color: inherit;
  font-variant-numeric: tabular-nums;
  text-align: right;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.setting-value-input:hover:not(:disabled) {
  border-color: currentColor;
  background: rgba(0, 0, 0, 0.03);
}

.setting-value-input:focus {
  border-color: currentColor;
  background: #fff;
  box-shadow: 0 0 0 0.125rem color-mix(in srgb, currentColor 20%, transparent);
}

.setting-value-input:disabled {
  cursor: not-allowed;
}

.setting-value-suffix {
  font-size: 0.875rem;
  font-weight: 700;
  color: inherit;
  white-space: nowrap;
}
</style>
