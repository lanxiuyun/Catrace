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

Catrace 用卡片形式统一展示桌面上的各种通知——提醒你该休息了、告诉你 AI agent 的新动态、转发手机或社区的通知，所有消息都收进屏幕右下角的通知卡片。内置插件开箱即用，还能安装外部插件扩展能力，不打扰你专注做事。

**内置插件：**

- **休息提醒** — 很多人一坐电脑前就是几个小时，等反应过来已经腰酸背痛了。它不偷拍屏幕、不读取你在做什么，只悄悄看你的鼠标、键盘有没有动，发现你连续工作太久，就提醒你站起来休息一会儿。支持浮动通知卡片和全屏遮罩两种提醒方式。
- **Agent 通知** — 如果你是 AI 编程重度用户，它能帮你盯着 Claude Code、Codex、Gemini CLI、Kimi 等 agent 的一举一动，还能直接在卡片上批准或拒绝权限请求。

**外部插件：**

- **定时提醒** — 自定义间隔或每日定点提醒。
- **蓝牙听歌**（bt-music）— 蓝牙耳机连接时自动弹通知或启动你的听歌程序，断开时按设定暂停或关闭。
- **GitHub 通知** — 获取 GitHub 未读通知，有新动态时弹卡片提醒。
- **SmsForwarder 通知** — 安卓手机收到短信或 App 通知时，自动转发到桌面弹卡片提醒。
- **通用通知**（notify-demo）— 手动发送自定义 Toast 的示例插件。
- **Sidecar 能力演示**（sidecar-echo）— 演示 sidecar 能力，如读写文件、选择目录、发起 HTTP 请求。

**插件生态** — 内置插件开箱即用，外部插件可从本地文件夹 / zip 安装，按需启用，随用随关。

## 怎么知道你在忙的

休息提醒不偷拍屏幕，也不读取你在做什么。宿主在后台做三件事来判断你的状态：

- **感知** — 持续采集三类轻量信号：当前前台应用（1 秒采样一次）、键盘敲击、鼠标移动，全部保存在本地，不上传任何数据。
- **判断** — 根据这些信号实时判断你是在工作还是休息：能按前台应用名区分「工作」和「娱乐放松」，Windows 下还会检测系统音频输出，识别看视频、听音乐、看直播这类键鼠活动不多但仍在盯着屏幕的「屏幕消费」状态。
- **结算** — 每分钟对信号做一次汇总（这一分钟主要用了哪个应用、敲了多少键、动了多远鼠标），作为休息提醒和各插件判断的依据。

工作节奏怎么算：

- 从你今天第一次敲键盘或动鼠标开始，它开始计时。
- 中间去倒杯水、回个消息、发个呆，只要没连续歇够一段时间，它都觉得你还在同一个工作节奏里。
- 只有当你真的停下来、连续好几分钟一动不动，它才认为你在休息，并把这段时间记下来。
- 如果你一口气忙满了一个「工作窗口」（比如 45 分钟），中间一直没歇够，或者休息完又忙满了一个窗口，它就会弹出一条通知，温柔地提醒你：该休息啦。

## 插件中心

Catrace 以插件形式组织所有功能，你可以在插件中心按需启用或关闭，也可以安装第三方外部插件来扩展能力。

- 左侧导航列出所有插件，右侧详情面板集中管理开关、配置与状态。
- 外部插件支持从本地文件夹 / zip 安装，随宿主一起调度，通过事件总线弹出自定义通知卡片。
- 面向开发者：提供 Rubick 风格插件 API 与 Sidecar 运行时，详见 [外部插件开发指南](.agent/skills/external-plugin-authoring/how-to-develop-catrace-external-plugins-complete-guide.md)。

## 友链

[![友链 linux.do](https://img.shields.io/badge/LINUX--DO-Community-blue.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BPGNsaXBQYXRoIGlkPSJhIj48Y2lyY2xlIGN4PSI2MCIgY3k9IjYwIiByPSI0NyIvPjwvY2xpcFBhdGg%2BPGNpcmNsZSBmaWxsPSIjZjBmMGYwIiBjeD0iNjAiIGN5PSI2MCIgcj0iNTAiLz48cmVjdCBmaWxsPSIjMWMxYzFlIiBjbGlwLXBhdGg9InVybCgjYSkiIHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIzMCIvPjxyZWN0IGZpbGw9IiNmMGYwZjAiIGNsaXAtcGF0aD0idXJsKCNhKSIgeD0iMTAiIHk9IjQwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjQwIi8%2BPHJlY3QgZmlsbD0iI2ZmYjAwMyIgY2xpcC1wYXRoPSJ1cmwoI2EpIiB4PSIxMCIgeT0iODAiIHdpZHRoPSIxMDAiIGhlaWdodD0iMzAiLz48L3N2Zz4%3D&style=flat)](https://linux.do/)

## Contributing

参与开发请参阅 [贡献指南](CONTRIBUTING.md)。
