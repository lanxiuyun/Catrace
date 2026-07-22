<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
} from 'naive-ui'
import { themeOverrides } from './theme'
import { zhCN as naiveZhCN, enUS as naiveEnUS } from 'naive-ui'
import ReminderPopup from './views/ReminderPopup.vue'
import ReminderFullscreen from './views/ReminderFullscreen.vue'
import ReminderToast from './views/ReminderToast.vue'
import OverlayScrollbar from './components/OverlayScrollbar.vue'

const route = useRoute()
const { t, locale } = useI18n()

const naiveLocale = computed(() => {
  return locale.value === 'zh-CN' ? naiveZhCN : naiveEnUS
})

const isReminderRoute = computed(() => {
  return ['/reminder-popup', '/reminder-fullscreen', '/reminder-toast'].includes(route.path)
})

const currentReminderType = computed(() => {
  if (route.path === '/reminder-popup') return 'popup'
  if (route.path === '/reminder-fullscreen') return 'fullscreen'
  if (route.path === '/reminder-toast') return 'toast'
  return ''
})

const needsTransparentBg = computed(() => {
  return route.path === '/reminder-fullscreen' || route.path === '/reminder-toast'
})

// 全屏提醒 / toast 提醒时让 html/body 背景透明
watch(needsTransparentBg, (val) => {
  document.documentElement.classList.toggle('reminder-transparent', val)
}, { immediate: true })
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides" :locale="naiveLocale">
    <n-message-provider>
      <n-dialog-provider>
        <template v-if="isReminderRoute">
          <ReminderPopup v-if="currentReminderType === 'popup'" />
          <ReminderFullscreen v-else-if="currentReminderType === 'fullscreen'" />
          <ReminderToast v-else-if="currentReminderType === 'toast'" />
          <RouterView v-else />
        </template>

        <div v-else class="app-shell">
          <header class="global-header">
            <div class="brand-block">
              <div class="brand-copy">
                <strong>Catrace</strong>
                <span>v26.7.18</span>
              </div>
            </div>

            <nav class="global-nav" aria-label="Primary navigation">
              <RouterLink to="/dashboard" class="nav-link">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                {{ t('nav.overview') }}
              </RouterLink>
              <RouterLink to="/plugins" class="nav-link">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v3" /><path d="M16 3v3" /><path d="M7 6h10a2 2 0 0 1 2 2v3a7 7 0 0 1-14 0V8a2 2 0 0 1 2-2Z" /><path d="M12 18v3" /></svg>
                {{ t('nav.plugins') }}
              </RouterLink>
              <RouterLink to="/debug" class="nav-link">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5" /><path d="M8 17v-6" /><path d="M12 17V7" /><path d="M16 17v-3" /><path d="M20 17V9" /></svg>
                {{ t('nav.debug') }}
              </RouterLink>
              <RouterLink to="/settings" class="nav-link">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-3v-.08a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 14.7a1.7 1.7 0 0 0-1.56-1.03H5v-3h.44A1.7 1.7 0 0 0 7 9.64a1.7 1.7 0 0 0-.34-1.88L6.6 7.7l2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.7 4.4V4h3v.4a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03H21v3h-.05A1.7 1.7 0 0 0 19.4 15Z" /></svg>
                {{ t('nav.systemSettings') }}
              </RouterLink>
            </nav>

          </header>

          <main class="app-workspace">
            <OverlayScrollbar>
              <RouterView v-slot="{ Component }">
                <KeepAlive>
                  <component :is="Component" />
                </KeepAlive>
              </RouterView>
            </OverlayScrollbar>
          </main>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style>
html, body, #app {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: #f8fafc;
}

* {
  -webkit-user-select: none;
  user-select: none;
}

.app-shell,
.app-shell * {
  box-sizing: border-box;
}

input,
textarea,
[contenteditable="true"] {
  -webkit-user-select: auto;
  user-select: auto;
}

html.reminder-transparent,
html.reminder-transparent body,
html.reminder-transparent #app {
  background: transparent !important;
}

.app-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f8fafc;
}

.global-header {
  height: 3.5rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0 1.25rem 0 0.75rem;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  color: #1e293b;
}

.brand-block,
.brand-copy,
.global-nav,
.nav-link {
  display: flex;
  align-items: center;
}

.brand-block {
  gap: 0.625rem;
  flex-shrink: 0;
}

.brand-copy {
  gap: 0.4rem;
  white-space: nowrap;
}

.brand-copy strong {
  font-size: 1rem;
  letter-spacing: -0.02em;
}

.brand-copy span {
  padding: 0.1rem 0.35rem;
  border-radius: 0.25rem;
  background: #f1f5f9;
  color: #94a3b8;
  font-size: 0.625rem;
  font-weight: 600;
}

.global-nav {
  align-self: stretch;
  gap: 0.25rem;
}

.nav-link {
  position: relative;
  gap: 0.45rem;
  padding: 0 0.75rem;
  color: #64748b;
  font-size: 0.8125rem;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.15s ease;
}

.nav-link::after {
  content: '';
  position: absolute;
  right: 0.75rem;
  bottom: 0;
  left: 0.75rem;
  height: 0.125rem;
  border-radius: 999px 999px 0 0;
  background: transparent;
}

.nav-link:hover,
.nav-link.router-link-active {
  color: #7c3aed;
}

.nav-link.router-link-active::after {
  background: #7c3aed;
}

.nav-link svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.app-workspace {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

</style>
