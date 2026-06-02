<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  getReminderData,
  snoozeReminder,
  skipReminder,
  setFullscreenSettings,
  DEFAULT_ELEMENT_TRANSFORMS,
  type ElementTransform,
  type ElementTransforms,
} from '../api/tauri'

const { t } = useI18n()

const title = ref('')
const body = ref('')
const boundary = ref(0)
const breakMinutes = ref(5)
const bgImage = ref('')
const opacity = ref(80)
const fitMode = ref('contain')

// Element transforms
const elementTransforms = reactive<ElementTransforms>({
  title: { ...DEFAULT_ELEMENT_TRANSFORMS.title },
  body: { ...DEFAULT_ELEMENT_TRANSFORMS.body },
  countdown: { ...DEFAULT_ELEMENT_TRANSFORMS.countdown },
  actions: { ...DEFAULT_ELEMENT_TRANSFORMS.actions },
})

// Edit mode state
const isEditMode = ref(false)
const selectedElement = ref<string | null>(null)

// Drag state
const isDragging = ref(false)
const dragElement = ref<string | null>(null)
let dragStartX = 0
let dragStartY = 0
let dragStartElemX = 0
let dragStartElemY = 0

const remainingSeconds = ref(0)
let timerId: ReturnType<typeof setInterval> | null = null

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function getDefaultTransforms(): ElementTransforms {
  return {
    title: { ...DEFAULT_ELEMENT_TRANSFORMS.title },
    body: { ...DEFAULT_ELEMENT_TRANSFORMS.body },
    countdown: { ...DEFAULT_ELEMENT_TRANSFORMS.countdown },
    actions: { ...DEFAULT_ELEMENT_TRANSFORMS.actions },
  }
}

async function loadData() {
  try {
    const data = await getReminderData('reminder-fullscreen')
    if (data) {
      title.value = data.title
      body.value = data.body
      boundary.value = data.boundary
      breakMinutes.value = data.break_minutes || 5
      bgImage.value = data.fullscreen_bg ?? ''
      opacity.value = data.fullscreen_opacity ?? 80
      fitMode.value = data.fullscreen_fit_mode ?? 'contain'
      remainingSeconds.value = breakMinutes.value * 60

      // Parse element transforms
      if (data.fullscreen_element_transforms) {
        try {
          const parsed = JSON.parse(data.fullscreen_element_transforms) as ElementTransforms
          // Apply parsed values with defaults for missing fields
          Object.keys(DEFAULT_ELEMENT_TRANSFORMS).forEach((key) => {
            const k = key as keyof ElementTransforms
            if (parsed[k]) {
              elementTransforms[k] = { ...DEFAULT_ELEMENT_TRANSFORMS[k], ...parsed[k] }
            }
          })
        } catch (e) {
          console.error('[FS] Failed to parse element transforms:', e)
          Object.assign(elementTransforms, getDefaultTransforms())
        }
      } else {
        Object.assign(elementTransforms, getDefaultTransforms())
      }
    }
  } catch (e) {
    console.error('[FS] loadData error:', e)
  }
}

function onHashChange() {
  loadData()
}

onMounted(async () => {
  await loadData()

  remainingSeconds.value = breakMinutes.value * 60
  timerId = setInterval(() => {
    if (remainingSeconds.value > 0) {
      remainingSeconds.value -= 1
      if (remainingSeconds.value === 0) {
        clearInterval(timerId)
        handleSkip()
      }
    }
  }, 1000)

  // 窗口复用时，hash 变化会触发重新加载数据
  window.addEventListener('hashchange', onHashChange)
})

onUnmounted(() => {
  if (timerId) clearInterval(timerId)
  window.removeEventListener('hashchange', onHashChange)
})

async function handleSnooze(minutes: number) {
  if (isEditMode.value) return
  try {
    await snoozeReminder(minutes)
  } catch (e) {
    console.error(e)
  }
  await getCurrentWebviewWindow().close()
}

async function handleSkip() {
  if (isEditMode.value) return
  try {
    await skipReminder(boundary.value)
  } catch (e) {
    console.error(e)
  }
  await getCurrentWebviewWindow().close()
}

// Edit mode functions
function toggleEditMode() {
  isEditMode.value = !isEditMode.value
  if (!isEditMode.value) {
    selectedElement.value = null
    saveTransforms()
  }
}

function selectElement(name: string, e: MouseEvent) {
  if (!isEditMode.value) return
  e.stopPropagation()
  selectedElement.value = name
}

function deselectAll() {
  selectedElement.value = null
}

// Drag functions
function startDrag(name: string, e: MouseEvent) {
  if (!isEditMode.value) return
  e.stopPropagation()

  isDragging.value = true
  dragElement.value = name
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragStartElemX = elementTransforms[name as keyof ElementTransforms].x
  dragStartElemY = elementTransforms[name as keyof ElementTransforms].y
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value || !dragElement.value) return

  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY

  // Convert pixel delta to percentage
  const deltaXPercent = (dx / window.innerWidth) * 100
  const deltaYPercent = (dy / window.innerHeight) * 100

  const newX = Math.min(90, Math.max(10, dragStartElemX + deltaXPercent))
  const newY = Math.min(90, Math.max(10, dragStartElemY + deltaYPercent))

  const key = dragElement.value as keyof ElementTransforms
  elementTransforms[key].x = Math.round(newX)
  elementTransforms[key].y = Math.round(newY)
}

function onMouseUp() {
  if (isDragging.value) {
    isDragging.value = false
    dragElement.value = null
  }
}

// Scale with mouse wheel
function handleWheel(e: WheelEvent) {
  if (!isEditMode.value || !selectedElement.value) return
  e.preventDefault()

  const delta = e.deltaY > 0 ? -0.05 : 0.05
  const key = selectedElement.value as keyof ElementTransforms
  const newScale = Math.max(0.3, Math.min(3.0, elementTransforms[key].scale + delta))
  elementTransforms[key].scale = Math.round(newScale * 100) / 100
}

// Save transforms to backend
let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveTransforms() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await setFullscreenSettings(
        bgImage.value,
        opacity.value,
        fitMode.value,
        JSON.stringify(elementTransforms),
      )
    } catch (e) {
      console.error('[FS] saveTransforms error:', e)
    }
  }, 300)
}

// Reset selected element
function resetSelectedElement() {
  if (!selectedElement.value) return
  const key = selectedElement.value as keyof ElementTransforms
  elementTransforms[key] = { ...DEFAULT_ELEMENT_TRANSFORMS[key] }
}

// Watch for changes and save
watch(
  () => ({ ...elementTransforms }),
  () => {
    if (isEditMode.value) return // Don't save while editing, save on lock
    saveTransforms()
  },
  { deep: true }
)
</script>

<template>
  <div
    class="fullscreen-root"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @mouseleave="onMouseUp"
    @click="deselectAll"
  >
    <!-- 底层：模糊放大铺满 -->
    <div
      v-if="bgImage"
      class="fullscreen-bg"
      :style="{ backgroundImage: `url(${bgImage})`, opacity: opacity / 100 }"
    />
    <!-- 上层：清晰原图，按用户选择的填充模式显示 -->
    <div
      v-if="bgImage"
      class="fullscreen-sharp"
      :style="{ backgroundImage: `url(${bgImage})`, backgroundSize: fitMode === 'fill' ? '100% 100%' : fitMode, opacity: opacity / 100 }"
    />

    <!-- Edit mode toggle button -->
    <div class="edit-toggle" @click.stop="toggleEditMode">
      <button class="lock-btn" :title="isEditMode ? t('reminder.lock') : t('reminder.unlock')">
        <svg v-if="!isEditMode" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
        </svg>
      </button>
    </div>

    <!-- Edit toolbar -->
    <div v-if="isEditMode" class="edit-toolbar">
      <div class="toolbar-title">{{ t('reminder.editMode') }}</div>
      <div class="toolbar-hint">{{ selectedElement ? t('reminder.scale') + ' / ' + t('reminder.rotate') : 'Click element to select' }}</div>
    </div>

    <!-- Title element -->
    <div
      class="editable-element"
      :class="{
        'edit-mode': isEditMode,
        'selected': selectedElement === 'title',
        'dragging': isDragging && dragElement === 'title'
      }"
      :style="{
        left: elementTransforms.title.x + '%',
        top: elementTransforms.title.y + '%',
        transform: `translate(-50%, -50%) scale(${elementTransforms.title.scale}) rotate(${elementTransforms.title.rotate}deg)`
      }"
      @click.stop="selectElement('title', $event)"
      @mousedown.stop="startDrag('title', $event)"
      @wheel.prevent="handleWheel"
    >
      <div class="element-label" v-if="isEditMode">Title</div>
      <h1 class="title">{{ title }}</h1>
    </div>

    <!-- Body element -->
    <div
      class="editable-element"
      :class="{
        'edit-mode': isEditMode,
        'selected': selectedElement === 'body',
        'dragging': isDragging && dragElement === 'body'
      }"
      :style="{
        left: elementTransforms.body.x + '%',
        top: elementTransforms.body.y + '%',
        transform: `translate(-50%, -50%) scale(${elementTransforms.body.scale}) rotate(${elementTransforms.body.rotate}deg)`
      }"
      @click.stop="selectElement('body', $event)"
      @mousedown.stop="startDrag('body', $event)"
      @wheel.prevent="handleWheel"
    >
      <div class="element-label" v-if="isEditMode">Body</div>
      <p class="subtitle">{{ body }}</p>
    </div>

    <!-- Countdown element -->
    <div
      class="editable-element"
      :class="{
        'edit-mode': isEditMode,
        'selected': selectedElement === 'countdown',
        'dragging': isDragging && dragElement === 'countdown'
      }"
      :style="{
        left: elementTransforms.countdown.x + '%',
        top: elementTransforms.countdown.y + '%',
        transform: `translate(-50%, -50%) scale(${elementTransforms.countdown.scale}) rotate(${elementTransforms.countdown.rotate}deg)`
      }"
      @click.stop="selectElement('countdown', $event)"
      @mousedown.stop="startDrag('countdown', $event)"
      @wheel.prevent="handleWheel"
    >
      <div class="element-label" v-if="isEditMode">Countdown</div>
      <div class="countdown">
        <div class="countdown-label">{{ t('reminder.countdown') }}</div>
        <div class="countdown-time">
          {{ formatTime(remainingSeconds) }}
        </div>
      </div>
    </div>

    <!-- Actions element -->
    <div
      class="editable-element"
      :class="{
        'edit-mode': isEditMode,
        'selected': selectedElement === 'actions',
        'dragging': isDragging && dragElement === 'actions'
      }"
      :style="{
        left: elementTransforms.actions.x + '%',
        top: elementTransforms.actions.y + '%',
        transform: `translate(-50%, -50%) scale(${elementTransforms.actions.scale}) rotate(${elementTransforms.actions.rotate}deg)`
      }"
      @click.stop="selectElement('actions', $event)"
      @mousedown.stop="startDrag('actions', $event)"
      @wheel.prevent="handleWheel"
    >
      <div class="element-label" v-if="isEditMode">Actions</div>
      <div class="actions">
        <button class="btn btn-secondary" @click.stop="handleSnooze(5)">
          {{ t('reminder.snooze5') }}
        </button>
        <button class="btn btn-secondary" @click.stop="handleSnooze(10)">
          {{ t('reminder.snooze10') }}
        </button>
        <button class="btn btn-primary" @click.stop="handleSkip">
          {{ t('reminder.skip') }}
        </button>
      </div>
    </div>

    <!-- Selected element controls -->
    <div v-if="isEditMode && selectedElement" class="element-controls">
      <div class="control-row">
        <label>{{ t('reminder.scale') }}</label>
        <input
          type="range"
          v-model.number="elementTransforms[selectedElement as keyof ElementTransforms].scale"
          :min="0.3"
          :max="3.0"
          :step="0.05"
        />
        <span>{{ Math.round(elementTransforms[selectedElement as keyof ElementTransforms].scale * 100) }}%</span>
      </div>
      <div class="control-row">
        <label>{{ t('reminder.rotate') }}</label>
        <input
          type="range"
          v-model.number="elementTransforms[selectedElement as keyof ElementTransforms].rotate"
          :min="-180"
          :max="180"
          :step="1"
        />
        <span>{{ elementTransforms[selectedElement as keyof ElementTransforms].rotate }}°</span>
      </div>
      <button class="reset-btn" @click="resetSelectedElement">
        {{ t('reminder.resetElement') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.fullscreen-root {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.fullscreen-bg {
  position: absolute;
  inset: -40px;
  background-size: cover;
  background-position: center;
  filter: blur(40px) saturate(1.2);
  transform: scale(1.05);
}

.fullscreen-sharp {
  position: absolute;
  inset: 0;
  background-repeat: no-repeat;
  background-position: center;
}

/* Edit toggle button */
.edit-toggle {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 100;
}

.lock-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(8px);
  color: #ffffff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.lock-btn:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: scale(1.1);
}

/* Edit toolbar */
.edit-toolbar {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  padding: 12px 20px;
  z-index: 100;
  text-align: center;
}

.toolbar-title {
  font-size: 14px;
  font-weight: 600;
  color: #7C3AED;
  margin-bottom: 4px;
}

.toolbar-hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

/* Editable elements */
.editable-element {
  position: absolute;
  z-index: 1;
  text-align: center;
  color: #ffffff;
  max-width: 640px;
  padding: 20px 40px;
  transform-origin: center center;
  transition: box-shadow 0.2s ease;
}

.editable-element.edit-mode {
  cursor: grab;
  border: 2px dashed rgba(255, 255, 255, 0.3);
  border-radius: 8px;
}

.editable-element.edit-mode:hover {
  border-color: rgba(124, 58, 237, 0.6);
  background: rgba(124, 58, 237, 0.1);
}

.editable-element.selected {
  border: 2px solid #7C3AED;
  background: rgba(124, 58, 237, 0.15);
}

.editable-element.dragging {
  cursor: grabbing;
  opacity: 0.9;
}

.element-label {
  position: absolute;
  top: -24px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
  background: rgba(0, 0, 0, 0.5);
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
}

/* Pulse animation */
.pulse-ring {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
}

.pulse-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #EF4444;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6); }
  50% { opacity: 0.7; transform: scale(1.2); box-shadow: 0 0 0 16px rgba(239, 68, 68, 0); }
}

/* Typography */
.title {
  font-size: 42px;
  font-weight: 800;
  margin: 0;
  letter-spacing: -0.02em;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}

.subtitle {
  font-size: 18px;
  margin: 0;
  opacity: 0.9;
  line-height: 1.5;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.25);
}

/* Countdown */
.countdown {
  text-align: center;
}

.countdown-label {
  font-size: 14px;
  opacity: 0.7;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.countdown-time {
  font-size: 80px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -2px;
  text-shadow: 0 2px 16px rgba(0, 0, 0, 0.3);
  line-height: 1;
}

/* Actions */
.actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}

.btn {
  padding: 12px 28px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
  backdrop-filter: blur(8px);
}
.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.25);
}

.btn-primary {
  background: #7C3AED;
  color: #ffffff;
}
.btn-primary:hover {
  background: #6D28D9;
}

/* Element controls */
.element-controls {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  padding: 16px 24px;
  min-width: 280px;
  z-index: 100;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #ffffff;
  font-size: 13px;
  margin-bottom: 12px;
}

.control-row:last-of-type {
  margin-bottom: 16px;
}

.control-row label {
  min-width: 50px;
  font-weight: 600;
}

.control-row input[type="range"] {
  flex: 1;
  accent-color: #7C3AED;
}

.control-row span {
  min-width: 56px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.reset-btn {
  width: 100%;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #ffffff;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.reset-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
