# 专用 Toast 卡片自渲染正文与外层通用模板的取舍

`ReminderToast.vue` 是通用卡片堆叠容器，对每种 `kind` 做两件事：渲染专用组件（如 `EyeToastCard`）、再用通用模板渲染 header / progress / body / actions 等公共部分。当某个 `kind` 改用专用卡片完全自定义布局时，必须显式把通用模板里对应的部分排除，否则会渲染两遍。

## 这条约定踩过的坑

护眼卡片（`kind === 'eye'`）加按钮时，为了让正文用绿色主题，在 `EyeToastCard.vue` 内部渲染了 `<p class="body-text">{{ body }}</p>`。但 `ReminderToast.vue` 通用模板里有 `<p v-if="item.kind !== 'update'" class="body-text">{{ item.body }}</p>`，对 `eye` 也成立，于是同一段正文出现两次：一次绿色（卡片内）、一次黑色（通用模板）。

修法：通用模板的 body 渲染条件加上 `&& item.kind !== 'eye'`，正文只由 `EyeToastCard` 自渲染。

## 判断原则

- **专用卡片只是换皮**（按钮、颜色不同，布局一致）→ 不要自渲染，继续用通用模板，通过 `.toast-card-<kind> .xxx` 选择器覆盖样式。喝水 / 休息提醒走这条路。
- **专用卡片要改结构**（多/少元素、不同顺序、自定义组件）→ 自渲染全套内容，并把通用模板里同位置的部分用 `v-if="item.kind !== '<kind>'"` 排除。护眼（自渲染 body）、更新通知（完全独立分支）、休息计时（液体球）走这条路。

## 通用模板里需要逐项排除的位置

| 通用模板部分 | 排除条件 | 谁自渲染 |
|---|---|---|
| header | `v-if="item.kind !== 'eye'"` | `EyeToastCard` |
| progress bar | `v-if="item.kind !== 'eye' && !== 'update' && !== 'rest-timer'"` | 护眼/更新/休息计时各自处理 |
| body | `v-if="item.kind !== 'update' && item.kind !== 'eye'"` | 护眼卡片自渲染、更新通知用 changelog |
| actions | 按 `kind` 分支渲染 | 每种自己一组按钮 |

新增自渲染型卡片时，对照这张表逐项加排除条件，避免正文/进度条/header 重复。

## 相关

- [[eye-reminder]] — 护眼卡片是自渲染 body 的实例
- [[water-reminder]] — 喝水提醒走「只换皮」路线，作对比
