<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import {
  NCard,
  NSpace,
  NTag,
  NButton,
  NEmpty,
  NDescriptions,
  NDescriptionsItem,
  NTable,
  NText,
} from 'naive-ui'
import { getVideoDebugInfo, type VideoDebugInfo } from '../api/tauri'

const data = ref<VideoDebugInfo | null>(null)
const loading = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

async function refresh() {
  loading.value = true
  try {
    data.value = await getVideoDebugInfo()
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  refresh()
  timer = setInterval(refresh, 1000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="debug-page">
    <div class="page-header">
      <h2>视频检测调试</h2>
      <n-button size="small" :loading="loading" @click="refresh">手动刷新</n-button>
    </div>

    <n-space vertical :size="16" v-if="data">
      <!-- 最终判定 -->
      <n-card title="最终判定" size="small">
        <n-space align="center" :size="24">
          <div class="result-item">
            <div class="result-label">media_active</div>
            <n-tag :type="data.media_active ? 'success' : 'default'" size="large">
              {{ data.media_active ? 'true（视频活跃）' : 'false' }}
            </n-tag>
          </div>
          <div class="result-item">
            <div class="result-label">键鼠计数（本分钟）</div>
            <n-tag size="large">{{ data.mouse_keyboard_count }}</n-tag>
          </div>
          <div class="result-item">
            <div class="result-label">预计活跃状态</div>
            <n-tag :type="data.mouse_keyboard_count >= 3 || data.media_active ? 'success' : 'default'" size="large">
              {{ data.mouse_keyboard_count >= 3 || data.media_active ? '活跃' : '休息' }}
            </n-tag>
          </div>
        </n-space>
      </n-card>

      <!-- GSMTCSM -->
      <n-card title="系统媒体会话（GSMTCSM）" size="small">
        <n-space vertical :size="12">
          <n-descriptions :column="3" size="small" bordered>
            <n-descriptions-item label="可用">
              <n-tag :type="data.gsmtcsm_available ? 'success' : 'error'">
                {{ data.gsmtcsm_available ? '是' : '否' }}
              </n-tag>
            </n-descriptions-item>
            <n-descriptions-item label="会话数">{{ data.gsmtcsm_session_count }}</n-descriptions-item>
            <n-descriptions-item label="有 Playing">
              <n-tag :type="data.gsmtcsm_has_playing ? 'success' : 'default'">
                {{ data.gsmtcsm_has_playing ? '是' : '否' }}
              </n-tag>
            </n-descriptions-item>
          </n-descriptions>

          <n-text v-if="data.gsmtcsm_error" type="error">
            错误：{{ data.gsmtcsm_error }}
          </n-text>

          <n-table v-if="data.gsmtcsm_sessions.length > 0" :single-line="false" size="small">
            <thead>
              <tr>
                <th>标题</th>
                <th>艺术家</th>
                <th>状态</th>
                <th>类型</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(s, i) in data.gsmtcsm_sessions" :key="i">
                <td>{{ s.title }}</td>
                <td>{{ s.artist }}</td>
                <td>
                  <n-tag :type="s.status === 'Playing' ? 'success' : 'default'" size="small">
                    {{ s.status }}
                  </n-tag>
                </td>
                <td>{{ s.playback_type }}</td>
              </tr>
            </tbody>
          </n-table>

          <n-empty v-else-if="!data.gsmtcsm_error" description="无媒体会话" size="small" />
        </n-space>
      </n-card>

      <!-- 焦点窗口 -->
      <n-card title="焦点窗口（关键词匹配）" size="small">
        <n-space vertical :size="12">
          <n-descriptions :column="1" size="small" bordered>
            <n-descriptions-item label="窗口标题">{{ data.focus_window_title }}</n-descriptions-item>
            <n-descriptions-item label="应用名">{{ data.focus_app_name }}</n-descriptions-item>
            <n-descriptions-item label="进程路径">{{ data.focus_process_path }}</n-descriptions-item>
            <n-descriptions-item label="关键词匹配">
              <n-tag :type="data.keyword_matched ? 'success' : 'default'">
                {{ data.keyword_matched ? '是' : '否' }}
              </n-tag>
              <n-text v-if="data.matched_keyword" depth="3" style="margin-left: 8px;">
                （命中：{{ data.matched_keyword }}）
              </n-text>
            </n-descriptions-item>
          </n-descriptions>
        </n-space>
      </n-card>
    </n-space>
  </div>
</template>

<style scoped>
.debug-page {
  padding: 24px;
  max-width: 900px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h2 {
  margin: 0;
  font-size: 20px;
  color: #2e1065;
}

.result-item {
  text-align: center;
}

.result-label {
  font-size: 12px;
  color: #8b7aab;
  margin-bottom: 6px;
}
</style>
