<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Catrace Logo">
</p>

<h1 align="center">Catrace</h1>

<p align="center">
  <strong>桌面事件系统 · 插件运行时</strong><br>
  休息提醒 · Agent通知 · 定时提醒 · 插件生态
</p>

<p align="center">
  <a href="https://github.com/lanxiuyun/Catrace/releases/latest">
    <img src="https://img.shields.io/github/v/release/lanxiuyun/Catrace?style=flat-square&color=7C3AED&label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC" alt="Latest Release">
  </a>
  <a href="https://github.com/lanxiuyun/Catrace/releases">
    <img src="https://img.shields.io/github/downloads/lanxiuyun/Catrace/total?style=flat-square&color=7C3AED&label=%E4%B8%8B%E8%BD%BD%E6%AC%A1%E6%95%B0" alt="Downloads">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square" alt="Platform">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License">
  </a>
</p>

<p align="center">
  <a href="https://github.com/lanxiuyun/Catrace/releases/latest">
    ⬇️ <strong>点击下载最新版本</strong>
  </a>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="https://lanxiuyun.github.io/Catrace">
    🏠 <strong>官网主页</strong>
  </a>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="https://github.com/lanxiuyun/Catrace">
    💖 <strong>觉得有用就 star 一下吧~</strong>
  </a>
</p>

<p align="center">
  <a href="README_EN.md">English</a> | 中文
</p>

![Catrace Dashboard](.readme/dashboard.png)

## 它是干嘛的

Catrace 是一套桌面事件系统，帮你把电脑前的工作安排得井井有条、也更健康。它内置一系列开箱即用的插件，并在后台默默观察你的使用状态，到点就提醒你，不打扰你专注做事。

**内置插件：**

- **休息提醒** — 很多人一坐电脑前就是几个小时，等反应过来已经腰酸背痛了。它会在后台观察你的活动状态，发现你连续工作太久，就提醒你站起来休息一会儿。
- **Agent 通知** — 如果你是 AI 编程重度用户，它能帮你盯着 Claude Code、Codex、Gemini CLI、Kimi 等 agent 的一举一动，还能直接在卡片上批准或拒绝权限请求。

**外部插件：**

- **定时提醒** — 自定义间隔或每日定点提醒。
- **蓝牙听歌**（bt-music）— 蓝牙耳机连接时自动弹通知或启动你的听歌程序，断开时按设定暂停或关闭。
- **GitHub 通知** — 获取 GitHub 未读通知，有新动态时弹卡片提醒。
- **SmsForwarder 通知** — 安卓手机收到短信或 App 通知时，自动转发到桌面弹卡片提醒。
- **通用通知**（notify-demo）— 手动发送自定义 Toast 的示例插件。
- **Sidecar 能力演示**（sidecar-echo）— 演示 sidecar 能力，如读写文件、选择目录、发起 HTTP 请求。

**插件生态** — 内置插件开箱即用，外部插件可从本地文件夹 / zip 安装，按需启用，随用随关。

## 休息提醒是怎么知道你忙的

它不会偷拍屏幕，也不读取你在做什么。它只是悄悄看看你的鼠标有没有动、键盘有没有敲。

然后根据一套简单的规则来判断：

- 它也会识别你正在进行屏幕消费的状态（如看视频、听音乐、看直播），即使那段时间键鼠活动不多。Windows 下通过检测系统音频输出并匹配音频输出进程排除列表来判断；macOS / Linux 下此功能暂时未实现。
- 从你今天第一次敲键盘或动鼠标开始，它开始计时。
- 中间去倒杯水、回个消息、发个呆，只要没连续歇够一段时间，它都觉得你还在同一个工作节奏里。
- 只有当你真的停下来、连续好几分钟一动不动，它才认为你在休息，并把这段时间记下来。
- 如果你一口气忙满了一个「工作窗口」（比如 45 分钟），中间一直没歇够，或者休息完又忙满了一个窗口，它就会弹出一条通知，温柔地提醒你：该休息啦。

## 休息提醒方式

到时间后，休息提醒插件会通过你选择的方式提醒你休息。支持两种提醒模式：

- **通知提醒** — 屏幕右下角弹出浮动通知卡片，支持多条堆叠显示；每张卡片带「5 分钟后提醒」「10 分钟后提醒」「跳过本次」三个按钮，鼠标悬停暂停倒计时。当你开始休息时，还会追加一个绿色液体球计时器，球内液面随休息进度上升并带有流动动画，显示已连续休息多久、是否达到有效休息时长。Windows 下不抢夺当前输入焦点，文件重命名、输入框编辑时也不会被打断
- **全屏提醒** — 全屏覆盖提醒，可自定义背景图片、适配方式和遮罩透明度，让你不得不停下来休息

你可以设置自己的工作时长和休息判定时长，找到最适合自己的节奏。

## Agent 通知

如果你是 AI 编程的重度用户，Catrace 还能帮你盯着 agent 的一举一动。

- 支持 Claude Code、Codex、Gemini CLI、Kimi 等 agent，安装官方 hook 后即可自动接收状态事件（会话开始、提交提示词、停止、失败、通知等）。
- 每个事件可单独设置显示策略：关闭 / 自动 / 固定（sticky）。
- Claude 的权限请求（PermissionRequest）会弹出卡片，直接在卡片上批准或拒绝，不用再切回终端。
- 设置页可一键安装/卸载各 agent 的 hook，并支持自定义提示音。

## 插件中心

Catrace 正在演进为「桌面事件系统」——内置功能以插件形式组织，你可以在插件中心按需启用或关闭，也可以安装第三方外部插件来扩展能力。

- 左侧导航列出所有插件，右侧详情面板集中管理开关、配置与状态。
- 内置插件：久坐提醒、Agent 通知。
- 外部插件：支持从本地文件夹 / zip 安装，随宿主一起调度，通过 Event Bus 弹出自定义 Toast 卡。定时提醒（自定义间隔 / 每日定点）、蓝牙听歌（bt-music，连接耳机后自动提醒或启动听歌程序）就是典型示例。
- 面向开发者：提供 Rubick 风格插件 API 与 Sidecar 运行时，详见 [外部插件开发指南](.agent/skills/external-plugin-authoring/how-to-develop-catrace-external-plugins-complete-guide.md)。

## 友链

[![友链 linux.do](https://img.shields.io/badge/LINUX--DO-Community-blue.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BPGNsaXBQYXRoIGlkPSJhIj48Y2lyY2xlIGN4PSI2MCIgY3k9IjYwIiByPSI0NyIvPjwvY2xpcFBhdGg%2BPGNpcmNsZSBmaWxsPSIjZjBmMGYwIiBjeD0iNjAiIGN5PSI2MCIgcj0iNTAiLz48cmVjdCBmaWxsPSIjMWMxYzFlIiBjbGlwLXBhdGg9InVybCgjYSkiIHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIzMCIvPjxyZWN0IGZpbGw9IiNmMGYwZjAiIGNsaXAtcGF0aD0idXJsKCNhKSIgeD0iMTAiIHk9IjQwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjQwIi8%2BPHJlY3QgZmlsbD0iI2ZmYjAwMyIgY2xpcC1wYXRoPSJ1cmwoI2EpIiB4PSIxMCIgeT0iODAiIHdpZHRoPSIxMDAiIGhlaWdodD0iMzAiLz48L3N2Zz4%3D&style=flat)](https://linux.do/)

## Contributing

参与开发请参阅 [贡献指南](CONTRIBUTING.md)。
