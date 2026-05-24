<script setup lang="ts">
import { ref, onMounted } from 'vue'
import {
  NForm,
  NFormItem,
  NSlider,
  NButton,
  NSpace,
  NCard,
  useMessage,
} from 'naive-ui'
import { getConfig, setConfig, testNotification } from '../api/tauri'

const config = ref({ window_minutes: 45, break_minutes: 5 })
const message = useMessage()

onMounted(async () => {
  try {
    const c = await getConfig()
    config.value = {
      window_minutes: Number(c.window_minutes),
      break_minutes: Number(c.break_minutes),
    }
  } catch (e) {
    console.error('获取配置失败', e)
  }
})

async function save() {
  try {
    await setConfig(config.value)
    message.success('已保存')
  } catch (e) {
    message.error('保存失败')
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
</script>

<template>
  <div class="settings">
    <n-card title="设置" style="max-width: 480px; border-radius: 20px; background: #fff;" :bordered="false">
      <n-form label-placement="left" label-width="auto">
        <n-form-item label="工作窗口（分钟）">
          <n-slider v-model:value="config.window_minutes" :min="10" :max="120" :step="5" />
          <span style="margin-left: 12px; min-width: 36px">{{ config.window_minutes }}</span>
        </n-form-item>
        <n-form-item label="休息打断（分钟）">
          <n-slider v-model:value="config.break_minutes" :min="1" :max="30" :step="1" />
          <span style="margin-left: 12px; min-width: 36px">{{ config.break_minutes }}</span>
        </n-form-item>
        <n-space>
          <n-button type="primary" @click="save">保存</n-button>
          <n-button @click="notify">测试通知</n-button>
        </n-space>
      </n-form>
    </n-card>
  </div>
</template>

<style scoped>
.settings {
  padding: 32px;
  background: #FAF5FF;
  min-height: 100vh;
}
</style>
