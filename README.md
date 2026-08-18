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

**Catrace** 右下角会弹出你需要知道的消息——久坐提醒你休息，插件推送新动态（AI 进度、GitHub、手机消息）。

现在装好就能用的功能：

- **久坐提醒** — 很多人一坐电脑前就是几个小时，等反应过来已经腰酸背痛了。它会观察你的鼠标键盘有没有动静，发现你连续工作太久，就提醒你站起来活动一下。嫌卡片提醒太温柔？还可以选全屏盖住屏幕，逼你起来歇会儿。
- **定时提醒** — 自己定间隔，比如每小时喝口水；或者定每天固定时间，比如下班前想起打卡。

想更强大？Catrace 可以「加装」更多功能（叫插件），装上就有：

- **AI 助手动态** — 你在用 Claude、Codex 这类 AI 编程工具时，它能弹卡片告诉你「AI 干到哪一步了」「要你授权什么」，不用切回终端盯着看。适合 AI 编程重度用户。
- **蓝牙耳机听歌** — 耳机一连上电脑，自动弹出通知或帮你打开听歌软件；断开时按你的设置暂停或关闭。
- **GitHub 动态** — 有人给你提了 issue 或点赞，弹卡片提醒你。
- **手机消息转发** — 安卓手机来短信或 App 通知，自动转发到电脑桌面弹卡片（需搭配 SmsForwarder 转发工具）。

**插件生态** — 内置功能开箱即用，想装的插件可以从本地文件夹或压缩包安装，随用随开、不用就关。

## 它怎么知道你在忙

放心，它不拍你屏幕，也不看你文件。它只靠两件事判断你忙不忙：

- **你的鼠标和键盘** — 动没动、动了多久。
- **你正开着哪个软件** — 是写代码的编辑器，还是视频播放器。

规则很简单：

- 从你今天第一次碰鼠标键盘开始计时。
- 中间去倒杯水、回个消息、发个呆，只要没歇够一段时间，它都当你还在工作节奏里。
- 只有你真的停下来、连着好几分钟一动不动，它才认定你在休息，并记下来。
- 一口气忙满一个「工作窗口」（比如 45 分钟）没歇够，或者歇完又忙满一个窗口，它就弹卡片提醒你：该起来活动啦。

如果你在安静看视频、听音乐，鼠标键盘可能半天不动，它也会通过系统声音识别出你还在「用屏幕」，不算你休息。这些小数据全部存在你电脑本地，不上传任何东西。

## 插件中心

所有功能都装在一个叫「插件中心」的地方，左边是功能列表，右边是每个功能的开关和设置。装了什么、开着哪些，一目了然。

想自己动手做插件？欢迎开发者参与，插件仓库在 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin)。

## 友链

[![友链 linux.do](https://img.shields.io/badge/LINUX--DO-Community-blue.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BPGNsaXBQYXRoIGlkPSJhIj48Y2lyY2xlIGN4PSI2MCIgY3k9IjYwIiByPSI0NyIvPjwvY2xpcFBhdGg%2BPGNpcmNsZSBmaWxsPSIjZjBmMGYwIiBjeD0iNjAiIGN5PSI2MCIgcj0iNTAiLz48cmVjdCBmaWxsPSIjMWMxYzFlIiBjbGlwLXBhdGg9InVybCgjYSkiIHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIzMCIvPjxyZWN0IGZpbGw9IiNmMGYwZjAiIGNsaXAtcGF0aD0idXJsKCNhKSIgeD0iMTAiIHk9IjQwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjQwIi8%2BPHJlY3QgZmlsbD0iI2ZmYjAwMyIgY2xpcC1wYXRoPSJ1cmwoI2EpIiB4PSIxMCIgeT0iODAiIHdpZHRoPSIxMDAiIGhlaWdodD0iMzAiLz48L3N2Zz4%3D&style=flat)](https://linux.do/)

## Contributing

参与开发请参阅 [贡献指南](CONTRIBUTING.md)。
