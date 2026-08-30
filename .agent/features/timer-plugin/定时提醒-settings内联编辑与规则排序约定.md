# 定时提醒 settings：内联编辑与规则排序

## 交互模型（不要用 NModal）

一条提醒 = 一张卡。**编辑 / 新建在卡内展开**，不弹层。

```
[提醒列表 n]                    [+ 新建提醒]
┌ 标题 + tags              测试 编辑 删除 开关 ┐  ← header 始终在
│ （启用时）正文预览                            │  ← content：关闭时折叠
│ （编辑时）紧凑表单 + 取消/保存                 │
└──────────────────────────────────────────────┘
```

| 动作 | 行为 |
|------|------|
| 新建 | 列表顶插入 `create-card`，`editingId='__new__'` |
| 编辑 | 当前卡 `is-editing`，content 换 `renderEditor()` |
| 关闭规则 | content 折叠，只留 header（测试/编辑/删除/开关仍在） |
| 删除 | `NPopconfirm` 二次确认；护眼示例不可删 |
| 编辑中 | 其它卡测试/编辑禁用，防串台 |

### 紧凑编辑器

1. **标题** | 输入（护眼只读）
2. **正文** | 2 行 textarea
3. **触发** | 模式 + 间隔/定点控件（护眼：模式固定，**间隔可改**）
4. **通知** | 常驻开关；关常驻时同行「停留 N 秒」
5. **颜色** | `<input type="color">`，可恢复默认紫
6. **提示音** | 开关；开启后音量、选文件、恢复默认、预览

颜色与声音字段见 [定时提醒-toast颜色与提示音规则字段.md](定时提醒-toast颜色与提示音规则字段.md)。

冗余说明进 `NTooltip`（`?`），不占纵向空间。每日定点用 **时 / 分** 两个数字框添加，不存自由文本。

## 列表排序 `compareRules`

1. 启用 > 关闭  
2. 同启停：`interval` > `daily`  
3. interval：`interval_minutes` 升序  
4. daily：多个 `daily_times` 里**最早**时刻升序  
5. 标题 `localeCompare('zh')`

## 护眼示例（builtin eye）

| 字段 | 可否改 | 固定值 / 说明 |
|------|--------|----------------|
| `title` | 否 | `护眼提醒` |
| `mode` | 否 | `interval` |
| `reset_on_rest` | 否 | `true` |
| `daily_times` | 否 | `[]` |
| `interval_minutes` | **可** | 默认 20 |
| `body` / `sticky` / `card_duration_sec` / `enabled` | 可 | 用户配置 |

实现要点：

- `EYE_FIXED` + `isEyeRule` + `applyEyeFixed`
- `ensureBuiltinEyeRule`：**始终恰好一条** eye，多余合并丢弃
- load / save / portable 路径都强制回写不可变字段
- 编辑 UI：`eyeLocked` 时标题只读、触发区不出现模式切换

## 视觉约定（对齐系统设置）

- 色板：`#2e1065` / `#8b7aab` / `#7c3aed` / `#ebe6f2` / `#f5f3ff`
- 非 primary 按钮：白底紫描边（CSS 覆写 naive 变量）
- 列表根无外 padding（宿主 `.plugin-detail` 管边距）

## 为何不回退弹窗

曾用 `NModal`：样式写在 `.timer-settings` 下 → teleport 后全失效 → 原生滚动条双轴、数字框错位。  
见 [[m10-external-plugins]]「NModal / teleport 样式陷阱」。
