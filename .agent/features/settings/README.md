# 设置页

卡片式设置容器，支持拖拽排序。

## 涉及文件

- `src/views/Settings.vue` — 页面容器
- `src/components/settings/SettingRow.vue` — 通用设置行
- `src/components/settings/SliderControl.vue` — 滑块+数值
- `src/components/settings/ReminderSettingsCard.vue` — 提醒偏好
- `src/components/settings/MediaSettingsCard.vue` — 视频与音乐
- `src/components/settings/SystemSettingsCard.vue` — 语言/自启/更新
- `src/components/settings/NotificationSettingsCard.vue` — 模式/全屏背景/文案/测试
- `src/components/settings/LinksSettingsCard.vue` — 相关链接
- `src/components/settings/WaterSettingsCard.vue` — 喝水提醒
- `src/components/settings/EyeSettingsCard.vue` — 护眼提醒（绿色主题，与喝水蓝色区分）

## 卡片规范

- 响应式网格布局，右上角拖拽把手，高度撑满 Grid 行
- 拖拽排序持久化（Tauri Store 插件保存顺序）
- 仅「提醒偏好」左侧文字固定 13rem，其余自适应
- 间距统一 rem 单位
- MediaSettingsCard：排除列表 500ms 防抖自动保存，「重置为默认」按钮在标题右侧
