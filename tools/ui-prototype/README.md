# Catrace 插件中心 UI 原型

独立的 **React + Radix Themes + Lucide** 设计原型，未接入现有 Vue 主应用和 Rust 内核。根目录的 [catrace-ui-concept.html](../../catrace-ui-concept.html) 是可直接打开的离线构建产物，CSS、JavaScript 和图标均已内嵌。

## 当前设计

- 固定一级导航、次级插件选择列表与右侧详情工作区，列表和详情分别滚动。
- 搜索与分类筛选、列表/详情双向同步开关、每个插件独立的设置草稿。
- 「偏好设置」「运行统计与日志」「关于与权限」三个页签。
- 浅色主题为冷灰工作区、白色面板和紫色强调；深色主题保留中性黑灰底色。
- 窄窗口采用列表与详情切换，提供返回入口与焦点恢复。

设置仅保存在内存中，刷新后重置。「更新设置」只应用到当前预览；历史分布明确标记为示例数据，日志记录本页操作。通知仅为页面内模拟；不代表真实系统授权、后台调度、插件安装或安全隔离已经实现。

## 安装、测试与构建

以下命令可直接在 PowerShell 中运行，不启动开发服务。构建要求 Node.js 18 或以上版本。

```powershell
npm --prefix "C:\work_sapce\Catrace\tools\ui-prototype" ci --no-audit --no-fund
npm --prefix "C:\work_sapce\Catrace\tools\ui-prototype" test
npm --prefix "C:\work_sapce\Catrace\tools\ui-prototype" run build
```

重新构建会覆盖根目录的 [catrace-ui-concept.html](../../catrace-ui-concept.html)。不需要用户下载目录中的原始设计稿，也不依赖被忽略的临时目录。

## 源码与检查

- [preview.jsx](./preview.jsx)：React 界面及交互。
- [layout.css](./layout.css)：布局、主题与响应式适配。
- [model.mjs](./model.mjs)：可测试的状态转换与演示数据。
- [model.test.mjs](./model.test.mjs)：13 项状态测试。
- [check.mjs](./check.mjs)：React 静态渲染与页面边界检查。
- [build.mjs](./build.mjs)：生成离线 HTML，检查主题变量与外部 CSS 依赖。

当前验证范围为状态测试、React 静态渲染和离线构建；尚未完成浏览器视觉与键盘交互实测。
