<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { openUrl } from '@tauri-apps/plugin-opener'
import { openLogsDir } from '../../api/tauri'
import { useMessage } from 'naive-ui'

const { t } = useI18n()
const message = useMessage()

interface LinkItem {
  url?: string
  title: string
  desc: string
  icon: string
  iconStyle: string
  onClick?: () => void
}

const links: LinkItem[] = [
  {
    url: 'https://github.com/lanxiuyunO/Catrace',
    title: t('settings.links.githubTitle'),
    desc: t('settings.links.githubDesc'),
    icon: 'M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z',
    iconStyle: 'background:#F3F4F6;color:#24292F;',
  },
  {
    url: 'https://github.com/lanxiuyunO/Catrace/releases',
    title: t('settings.links.changelogTitle'),
    desc: t('settings.links.changelogDesc'),
    icon: 'M12 2L2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5',
    iconStyle: 'background:#EFF6FF;color:#3B82F6;',
  },
  {
    url: 'https://github.com/lanxiuyunO/Catrace/issues',
    title: t('settings.links.issuesTitle'),
    desc: t('settings.links.issuesDesc'),
    icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
    iconStyle: 'background:#FFFBEB;color:#F59E0B;',
  },
  {
    title: t('debug.openLogsDir'),
    desc: t('settings.links.logsDesc'),
    icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
    iconStyle: 'background:#F5F3FF;color:#7C3AED;',
    onClick: async () => {
      try {
        await openLogsDir()
      } catch (e: any) {
        message.error(e?.message || String(e))
      }
    },
  },
]

function handleClick(link: LinkItem) {
  if (link.onClick) {
    link.onClick()
  } else if (link.url) {
    openUrl(link.url)
  }
}
</script>

<template>
  <div class="group links-group">
    <div class="group-label">{{ t('settings.groups.links') }}</div>
    <div class="link-list">
      <div
        v-for="link in links"
        :key="link.title"
        class="link-item"
        @click="handleClick(link)"
      >
        <div class="link-icon" :style="link.iconStyle">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path :d="link.icon" />
          </svg>
        </div>
        <div class="link-body">
          <div class="link-title">{{ link.title }}</div>
          <div class="link-desc">{{ link.desc }}</div>
        </div>
        <svg class="link-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.links-group {
  padding: 1rem 1.25rem 0.625rem;
}

.link-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.link-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0.875rem;
  background: #FAFAFF;
  border: 0.0625rem solid #F5F3FF;
  border-radius: 0.75rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.link-item:hover {
  background: #F5F3FF;
  border-color: #EDE9FE;
  transform: translateY(0.0625rem);
}

.link-icon {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.625rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.link-body {
  flex: 1;
  min-width: 0;
}

.link-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: #2E1065;
  margin-bottom: 0.125rem;
}

.link-desc {
  font-size: 0.75rem;
  color: #8B7AAB;
}

.link-arrow {
  color: #C4B5FD;
  flex-shrink: 0;
  transition: color 0.15s ease;
}

.link-item:hover .link-arrow {
  color: #7C3AED;
}
</style>
