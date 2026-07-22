<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const rootRef = ref<HTMLElement | null>(null)
const viewportRef = ref<HTMLElement | null>(null)
const barRef = ref<HTMLElement | null>(null)
const contentRef = ref<HTMLElement | null>(null)
const thumbHeight = ref(0)
const thumbTop = ref(0)
const scrollable = ref(false)
const dragging = ref(false)

let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null
let dragStartY = 0
let dragStartScrollTop = 0

function updateThumb() {
  const viewport = viewportRef.value
  if (!viewport) return

  const { clientHeight, scrollHeight, scrollTop } = viewport
  const trackHeight = barRef.value?.clientHeight ?? clientHeight
  scrollable.value = scrollHeight > clientHeight + 1

  if (!scrollable.value) {
    thumbHeight.value = 0
    thumbTop.value = 0
    return
  }

  const height = Math.max(32, trackHeight * clientHeight / scrollHeight)
  const maxThumbTop = trackHeight - height
  const maxScrollTop = scrollHeight - clientHeight

  thumbHeight.value = height
  thumbTop.value = maxScrollTop > 0 ? scrollTop / maxScrollTop * maxThumbTop : 0
}

function onThumbPointerDown(event: PointerEvent) {
  const viewport = viewportRef.value
  if (!viewport) return

  event.preventDefault()
  dragging.value = true
  dragStartY = event.clientY
  dragStartScrollTop = viewport.scrollTop
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stopDragging, { once: true })
}

function onPointerMove(event: PointerEvent) {
  const viewport = viewportRef.value
  if (!viewport) return

  const trackHeight = barRef.value?.clientHeight ?? viewport.clientHeight
  const maxThumbTop = trackHeight - thumbHeight.value
  const maxScrollTop = viewport.scrollHeight - viewport.clientHeight
  if (maxThumbTop <= 0) return

  viewport.scrollTop = dragStartScrollTop + (event.clientY - dragStartY) / maxThumbTop * maxScrollTop
}

function stopDragging() {
  dragging.value = false
  window.removeEventListener('pointermove', onPointerMove)
}

onMounted(async () => {
  await nextTick()
  resizeObserver = new ResizeObserver(updateThumb)
  if (rootRef.value) resizeObserver.observe(rootRef.value)
  if (viewportRef.value) resizeObserver.observe(viewportRef.value)
  if (contentRef.value) {
    resizeObserver.observe(contentRef.value)
    mutationObserver = new MutationObserver(updateThumb)
    mutationObserver.observe(contentRef.value, { childList: true, subtree: true })
  }
  updateThumb()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  stopDragging()
})
</script>

<template>
  <div ref="rootRef" class="overlay-scrollbar" :class="{ 'is-dragging': dragging }">
    <div ref="viewportRef" class="overlay-scrollbar__viewport" @scroll="updateThumb">
      <div ref="contentRef" class="overlay-scrollbar__content">
        <slot />
      </div>
    </div>
    <div ref="barRef" class="overlay-scrollbar__bar" :class="{ 'is-visible': scrollable }" aria-hidden="true">
      <div
        class="overlay-scrollbar__thumb"
        :style="{ height: `${thumbHeight}px`, transform: `translateY(${thumbTop}px)` }"
        @pointerdown="onThumbPointerDown"
      />
    </div>
  </div>
</template>

<style scoped>
.overlay-scrollbar {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.overlay-scrollbar__viewport {
  width: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
}

.overlay-scrollbar__viewport::-webkit-scrollbar {
  display: none;
}

.overlay-scrollbar__content {
  width: 100%;
  height: 100%;
}

.overlay-scrollbar__bar {
  position: absolute;
  top: 0.25rem;
  right: 0.1875rem;
  bottom: 0.25rem;
  width: 0.375rem;
  z-index: 20;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
}

.overlay-scrollbar:hover .overlay-scrollbar__bar.is-visible,
.overlay-scrollbar.is-dragging .overlay-scrollbar__bar.is-visible {
  opacity: 1;
}

.overlay-scrollbar__thumb {
  width: 100%;
  min-height: 2rem;
  border-radius: 999px;
  background: rgba(139, 92, 246, 0.45);
  cursor: pointer;
  pointer-events: auto;
  transition: background 0.15s ease;
  touch-action: none;
}

.overlay-scrollbar__thumb:hover,
.overlay-scrollbar.is-dragging .overlay-scrollbar__thumb {
  background: rgba(124, 58, 237, 0.72);
}
</style>
