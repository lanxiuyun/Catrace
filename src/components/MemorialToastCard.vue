<script setup lang="ts">
export type MemorialCategory = 'history' | 'life'

interface Props {
  title: string
  body: string
  tag: string
  icon: string
  category: MemorialCategory
}

defineProps<Props>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const THEMES: Record<MemorialCategory, {
  tagBg: string
  tagFg: string
  title: string
  body: string
  divider: string
  iconBg: string
  close: string
  closeHoverBg: string
  bg: string
  border: string
  shadow: string
}> = {
  history: {
    tagBg: 'rgba(42, 43, 46, 0.08)',
    tagFg: '#4B4D52',
    title: '#2A2B2E',
    body: '#4B4D52',
    divider: 'linear-gradient(90deg, rgba(42,43,46,0.28), rgba(42,43,46,0.06) 80%, transparent)',
    iconBg: 'rgba(42, 43, 46, 0.08)',
    close: '#6B7280',
    closeHoverBg: 'rgba(42, 43, 46, 0.08)',
    bg: 'linear-gradient(135deg, #F7F7F8 0%, #F2F3F5 60%, #ECECED 100%)',
    border: 'rgba(42, 43, 46, 0.12)',
    shadow: 'rgba(42, 43, 46, 0.10)',
  },
  life: {
    tagBg: 'rgba(0, 82, 217, 0.08)',
    tagFg: '#0052D9',
    title: '#003CA8',
    body: '#0043B8',
    divider: 'linear-gradient(90deg, rgba(0,82,217,0.30), rgba(0,82,217,0.06) 80%, transparent)',
    iconBg: 'rgba(0, 82, 217, 0.08)',
    close: '#4B70A6',
    closeHoverBg: 'rgba(0, 82, 217, 0.08)',
    bg: 'linear-gradient(135deg, #F0F7FF 0%, #E8F2FF 60%, #E0ECFF 100%)',
    border: 'rgba(0, 82, 217, 0.14)',
    shadow: 'rgba(0, 82, 217, 0.12)',
  },
}

function themeFor(category: MemorialCategory) {
  return THEMES[category]
}
</script>

<template>
  <div
    class="memorial-toast"
    :style="{
      background: themeFor(category).bg,
      borderColor: themeFor(category).border,
      boxShadow: `0 0.5rem 1.5rem ${themeFor(category).shadow}, 0 0.125rem 0.375rem rgba(0,0,0,0.04)`,
    }"
  >
    <div class="memorial-header">
      <div class="memorial-title-row">
        <span
          class="memorial-icon"
          :style="{ background: themeFor(category).iconBg }"
          aria-hidden="true"
        >{{ icon }}</span>
        <div class="memorial-titles">
          <h2 class="title" :style="{ color: themeFor(category).title }">{{ title }}</h2>
          <span
            class="memorial-tag"
            :style="{ background: themeFor(category).tagBg, color: themeFor(category).tagFg }"
          >{{ tag }}</span>
        </div>
      </div>
      <button
        class="close-btn"
        :style="{ color: themeFor(category).close }"
        @click="emit('close')"
        aria-label="关闭"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div
      class="memorial-divider"
      :style="{ background: themeFor(category).divider }"
    />

    <p class="body-text" :style="{ color: themeFor(category).body }">{{ body }}</p>
  </div>
</template>

<style scoped>
.memorial-toast {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 0;
  border-radius: 0.5rem;
  padding: 0.75rem;
  box-sizing: border-box;
  border: 0.0625rem solid;
  transition: transform 0.2s ease;
}

.memorial-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
}

.memorial-title-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  min-width: 0;
}

.memorial-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 0.375rem;
  font-size: 1rem;
  line-height: 1;
  flex-shrink: 0;
}

.memorial-titles {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.memorial-tag {
  align-self: flex-start;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  letter-spacing: 0.04em;
}

.title {
  font-size: 0.9375rem;
  font-weight: 700;
  margin: 0;
  line-height: 1.35;
  letter-spacing: 0.01em;
}

.close-btn {
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 0.375rem;
  padding: 0;
  flex-shrink: 0;
  opacity: 0.65;
  transition: all 0.2s ease;
}

.close-btn:hover {
  opacity: 1;
}

.close-btn:active {
  transform: scale(0.95);
}

.memorial-divider {
  height: 0.0625rem;
  margin: 0.625rem 0 0.5rem;
  border-radius: 0.03125rem;
}

.body-text {
  font-size: 0.875rem;
  line-height: 1.65;
  margin: 0;
  word-break: break-word;
  letter-spacing: 0.01em;
}
</style>
