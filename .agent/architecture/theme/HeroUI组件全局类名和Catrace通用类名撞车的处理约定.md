# HeroUI 组件全局类名和 Catrace 通用类名撞车

HeroUI v3 的组件根类名是全局的 `.card` / `.badge` / `.header` / `.progress-bar` 这类短词；Catrace 的时间线卡片、状态胶囊和 Toast 卡片历史上也用过同名 class。组件迁移到 HeroUI 后，这些 Catrace 元素会同时吃到两套样式，而且问题不一定报错，只表现为间距、高度、布局悄悄变了。

## 典型现象

| Catrace 元素 | 被 HeroUI 命中的类 | 多出来的效果 |
|---|---|---|
| 时间线卡片 `.ct-timeline-windows .card` | HeroUI `.card` | `padding: 16px`、`gap: 12px`，叠在 `.card-summary` 的内边距上，卡片被撑高、内容被往里推 |
| 状态胶囊 `.ct-timeline-windows .badge` | HeroUI `.badge` | `min-height / min-width: 28px`，胶囊比文字高出一截 |
| Toast 卡片 `.header` | HeroUI `.header` | `padding`、12px 字号、muted 颜色覆盖卡片原本的头部排版 |
| Toast 进度条 `.progress-bar` | HeroUI `.progress-bar` | `display: grid` 和 `grid-template-areas`，细进度条布局被改掉 |

`.grid` 也会撞 Tailwind 的 `.grid`，但两边都只是 `display: grid`，没有实际影响；这类“同名但属性一致”的碰撞可以不动。

## 处理规则

1. **新增 Catrace 组件优先用 `ct-` 前缀**，不要用 `.card` / `.badge` / `.header` / `.progress-bar` 这种通用词。
2. 复用第三方组件库时，先确认它有没有同名全局类；有的话把 Catrace 类名改掉，或至少在自己的作用域里把第三方多出来的属性显式归零。
3. **不能只靠选择器特异性**：Catrace 的 `.ct-timeline-windows .card` 能压过 HeroUI 的 `.card` 的 `background` / `border`，但 HeroUI 设置而 Catrace 没声明的 `padding` / `gap` 仍会生效。要归零的是“自己没写、对方写了”的属性。
4. 回归时用计算样式核对，不只看截图：`padding`、`gap`、`min-height`、`display` 这几项最容易漏。

## 本轮落点

- [timeline-windows.css](../../../src/app/pages/dashboard/timeline-windows.css)：`.ct-timeline-windows .card` 显式 `padding: 0; gap: 0`，`.badge` 的 `min-height/min-width` 归零
- [toast.css](../../../src/app/windows/toast/toast.css)：Toast 卡片的 `.header` / `.progress-bar` 补归零规则
- 排查方法：把第三方 CSS 和 Catrace CSS 里的 class token 取交集，本轮交集就是 `badge` / `card` / `grid` / `header` / `progress-bar`
