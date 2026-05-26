<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  NSlider,
  NSwitch,
  NButton,
  NSpace,
  useMessage,
} from 'naive-ui'
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getVersion } from '@tauri-apps/api/app'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import {
  getConfig, setConfig,
  getSilentStart, setSilentStart,
  testNotification,
} from '../api/tauri'

const config = ref({ window_minutes: 45, break_minutes: 5 })
const autostart = ref(false)
const silentStart = ref(false)
const loading = ref({ config: false, autostart: false, silent: false })
const message = useMessage()

// 更新状态
const appVersion = ref('')
const updateInfo = ref<{ available: boolean; version?: string; body?: string } | null>(null)
const updateLoading = ref(false)
const updateInstalling = ref(false)

onMounted(async () => {
  try {
    const [c, a, s, v] = await Promise.all([
      getConfig(),
      isEnabled(),
      getSilentStart(),
      getVersion(),
    ])
    config.value = {
      window_minutes: Number(c.window_minutes),
      break_minutes: Number(c.break_minutes),
    }
    autostart.value = a
    silentStart.value = s
    appVersion.value = v
  } catch (e) {
    console.error('获取配置失败', e)
  }
})

async function saveConfig() {
  loading.value.config = true
  try {
    await setConfig(config.value)
    message.success('已保存')
  } catch (e) {
    message.error('保存失败')
  } finally {
    loading.value.config = false
  }
}

async function toggleAutostart(val: boolean) {
  loading.value.autostart = true
  try {
    if (val) {
      await enable()
    } else {
      await disable()
    }
    autostart.value = val
    message.success(val ? '已开启开机自启' : '已关闭开机自启')
  } catch (e) {
    message.error('设置失败')
    autostart.value = !val
  } finally {
    loading.value.autostart = false
  }
}

async function toggleSilentStart(val: boolean) {
  loading.value.silent = true
  try {
    await setSilentStart(val)
    silentStart.value = val
    message.success(val ? '已开启静默启动' : '已关闭静默启动')
  } catch (e) {
    message.error('设置失败')
    silentStart.value = !val
  } finally {
    loading.value.silent = false
  }
}

async function notify() {
  try {
    await testNotification()
    message.success('通知已发送')
  } catch (e) {
    message.error('通知失败')
  }
}

async function handleCheckUpdate() {
  updateLoading.value = true
  try {
    const update = await check({
      headers: { 'X-AccessKey': '9SzxzOb3pQgkOB-LU-QU1Q' },
    })
    if (update) {
      updateInfo.value = { available: true, version: update.version, body: update.body || '' }
      message.info(`发现新版本：${update.version}`)
    } else {
      updateInfo.value = { available: false }
      message.success('当前已是最新版本')
    }
  } catch (e) {
    message.error('检查更新失败')
    console.error(e)
  } finally {
    updateLoading.value = false
  }
}

async function handleInstallUpdate() {
  updateInstalling.value = true
  try {
    const update = await check({
      headers: { 'X-AccessKey': '9SzxzOb3pQgkOB-LU-QU1Q' },
    })
    if (!update) {
      message.warning('未找到可用更新')
      return
    }
    await update.downloadAndInstall((event) => {
      console.log(event)
    })
    message.success('更新已安装，即将重启')
    await relaunch()
  } catch (e) {
    message.error('更新失败')
    console.error(e)
  } finally {
    updateInstalling.value = false
  }
}
</script>

<template>
  <div class="settings">
    <h1 class="title">设置</h1>
    <p class="subtitle">自定义 Catrace 的工作方式</p>

    <div class="two-col">
      <!-- 左侧：设置项 -->
      <div class="col-left">
        <div class="group">
          <div class="group-label">提醒偏好</div>

          <div class="setting-row">
            <div class="setting-meta">
              <div class="setting-title">连续工作提醒</div>
              <div class="setting-desc">连续工作多久后提醒你休息</div>
            </div>
            <div class="setting-control slider-control">
              <n-slider v-model:value="config.window_minutes" :min="10" :max="120" :step="5" />
              <span class="setting-value">{{ config.window_minutes }} 分钟</span>
            </div>
          </div>

          <div class="divider" />

          <div class="setting-row">
            <div class="setting-meta">
              <div class="setting-title">休息判定</div>
              <div class="setting-desc">连续休息多少分钟算一次有效休息</div>
            </div>
            <div class="setting-control slider-control">
              <n-slider v-model:value="config.break_minutes" :min="1" :max="30" :step="1" />
              <span class="setting-value">{{ config.break_minutes }} 分钟</span>
            </div>
          </div>

          <div class="divider" />

          <div class="setting-row actions">
            <div />
            <n-space>
              <n-button type="primary" :loading="loading.config" @click="saveConfig">保存</n-button>
              <n-button @click="notify">测试通知</n-button>
            </n-space>
          </div>
        </div>

        <div class="group">
          <div class="group-label">软件更新</div>

          <div class="setting-row">
            <div class="setting-meta">
              <div class="setting-title">当前版本</div>
              <div class="setting-desc">{{ appVersion || '...' }}</div>
            </div>
            <div class="setting-control">
              <n-button
                :loading="updateLoading"
                :disabled="updateInstalling"
                @click="handleCheckUpdate"
              >检查更新</n-button>
            </div>
          </div>

          <template v-if="updateInfo?.available">
            <div class="divider" />
            <div class="update-banner">
              <div class="update-banner-title">
                发现新版本 {{ updateInfo.version }}
              </div>
              <div v-if="updateInfo.body" class="update-banner-body">
                {{ updateInfo.body }}
              </div>
              <n-button
                type="primary"
                :loading="updateInstalling"
                @click="handleInstallUpdate"
              >立即更新</n-button>
            </div>
          </template>
        </div>

        <div class="group">
          <div class="group-label">启动行为</div>

          <div class="setting-row">
            <div class="setting-meta">
              <div class="setting-title">开机自启</div>
              <div class="setting-desc">系统启动时自动运行 Catrace</div>
            </div>
            <n-switch
              :value="autostart"
              :loading="loading.autostart"
              @update:value="toggleAutostart"
            />
          </div>

          <div class="divider" />

          <div class="setting-row">
            <div class="setting-meta">
              <div class="setting-title">静默启动</div>
              <div class="setting-desc">开机时不显示窗口，只在托盘运行</div>
            </div>
            <n-switch
              :value="silentStart"
              :loading="loading.silent"
              :disabled="!autostart"
              @update:value="toggleSilentStart"
            />
          </div>
        </div>
      </div>

      <!-- 右侧：相关链接 -->
      <div class="col-right">
        <div class="group links-group">
      <div class="group-label">相关链接</div>
      <div class="link-list">
        <div class="link-item" @click="openUrl('https://github.com/lanxiuyun/Catrace')">
          <div class="link-icon" style="background:#F3F4F6;color:#24292F;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          </div>
          <div class="link-body">
            <div class="link-title">GitHub</div>
            <div class="link-desc">查看源码和提交 Issue</div>
          </div>
          <svg class="link-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>

        <div class="link-item" @click="openUrl('https://github.com/lanxiuyun/Catrace/releases')">
          <div class="link-icon" style="background:#EFF6FF;color:#3B82F6;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          </div>
          <div class="link-body">
            <div class="link-title">更新日志</div>
            <div class="link-desc">查看版本更新记录</div>
          </div>
          <svg class="link-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>

        <div class="link-item" @click="openUrl('https://github.com/lanxiuyun/Catrace/issues')">
          <div class="link-icon" style="background:#FFFBEB;color:#F59E0B;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div class="link-body">
            <div class="link-title">问题反馈</div>
            <div class="link-desc">报告 Bug 或建议新功能</div>
          </div>
          <svg class="link-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
        </div>
      </div>
    </div>

    <!-- 底部：关于 -->
    <div class="group about">
      <div class="about-name">Catrace</div>
      <div class="about-version">v0.1.0</div>
      <div class="about-desc">后台静默运行的桌面工具，帮助你平衡工作与休息</div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  padding: 32px 40px;
}

.title {
  font-size: 22px;
  font-weight: 700;
  color: #2E1065;
  margin: 0 0 4px 0;
}
.subtitle {
  font-size: 13px;
  color: #8B7AAB;
  margin: 0 0 28px 0;
}

/* 两栏布局 */
.two-col {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 20px;
  align-items: start;
}

/* 分组卡片 */
.group {
  background: #fff;
  border: 1px solid #EBE6F2;
  border-radius: 14px;
  padding: 20px 28px;
  margin-bottom: 16px;
}
.group-label {
  font-size: 11px;
  font-weight: 600;
  color: #8B7AAB;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

/* 设置行 */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 14px 0;
}
.setting-row.actions {
  padding: 8px 0 4px;
}

.setting-meta {
  flex-shrink: 1;
  min-width: 0;
}
.setting-title {
  font-size: 14px;
  font-weight: 600;
  color: #2E1065;
  margin-bottom: 2px;
}
.setting-desc {
  font-size: 12px;
  color: #8B7AAB;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 20px;
}
.slider-control {
  flex: 1;
  max-width: 320px;
  min-width: 120px;
}
.slider-control :deep(.n-slider) {
  flex: 1;
}
.setting-value {
  font-size: 14px;
  font-weight: 700;
  color: #7C3AED;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 56px;
  text-align: right;
}

.divider {
  height: 1px;
  background: #F5F3FF;
  margin: 0;
}

/* 关于 */
.about {
  text-align: center;
  padding: 24px;
  margin-bottom: 0;
}
.about-name {
  font-size: 14px;
  font-weight: 700;
  color: #2E1065;
}
.about-version {
  font-size: 11px;
  color: #A78BFA;
  margin: 2px 0 8px;
  font-variant-numeric: tabular-nums;
}
.about-desc {
  font-size: 12px;
  color: #8B7AAB;
}

/* 相关链接 */
.links-group {
  padding: 20px 28px 12px;
}
.link-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}
.link-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: #FAFAFF;
  border: 1px solid #F5F3FF;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.link-item:hover {
  background: #F5F3FF;
  border-color: #EDE9FE;
  transform: translateY(-1px);
}
.link-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
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
  font-size: 14px;
  font-weight: 600;
  color: #2E1065;
  margin-bottom: 2px;
}
.link-desc {
  font-size: 12px;
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

/* 更新提示 */
.update-banner {
  padding: 14px 0 4px;
}
.update-banner-title {
  font-size: 14px;
  font-weight: 600;
  color: #2E1065;
  margin-bottom: 6px;
}
.update-banner-body {
  font-size: 12px;
  color: #8B7AAB;
  margin-bottom: 12px;
  white-space: pre-wrap;
  line-height: 1.5;
}

/* 响应式 */
@media (max-width: 900px) {
  .two-col {
    grid-template-columns: 1fr;
  }
  .slider-control {
    max-width: 260px;
  }
}
</style>
