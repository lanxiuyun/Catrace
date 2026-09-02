<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Catrace Logo">
</p>

<h1 align="center">Catrace</h1>

<p align="center">
  <strong>桌面事件系统：小窗的一生归它管</strong><br>
  显示什么、怎么交互，插件说了算
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
  <a href="#下载">下载</a> ·
  <a href="https://lanxiuyun.github.io/Catrace">官网</a> ·
  <a href="https://github.com/lanxiuyun/catrace-plugin">插件仓库</a> ·
  <a href="README_EN.md">English</a>
</p>

![Catrace Dashboard](.readme/dashboard.png)

## 右下角弹出一张卡

可能是「该起来走走了」，可能是「AI 等你授权」，可能是一条验证码——也可能是一局德州扑克，或者一块随手涂画的画布。

Catrace 是一个桌面事件系统。它管的是这些小窗（toast）的一生：谁来弹、弹在哪、活多久、点了按钮归谁收尾。至于小窗里显示什么、能做哪些交互，它不预设——那是插件的事。

类比 VSCode：VSCode 自己不写代码，它管编辑器，写代码的体验由扩展长出来；Catrace 自己不决定内容，它管小窗，桌面上的小窗体验由插件长出来。

## 装上就有的小窗

- **久坐提醒** — 它盯着键鼠和前台软件，分得清你是真忙还是真歇：连续忙满一个工作窗口才催你，去倒杯水的几分钟不算摸鱼。嫌卡片太温柔？全屏模式盖住整个屏幕，不站起来点不掉。
- **定时提醒** — 每小时喝口水、下午三点看一眼数据、下班前记得打卡——这些事总靠脑子记，忘了又懊恼。间隔也好、固定时刻也好，设一次就交给卡片。
- **AI 编程助手** — Claude Code、Codex 在终端里跑任务，你切去干别的，它跑到哪一步了、是不是在等你授权，心里总惦记着。现在右下角的卡片替你盯着，喊你回来点一下确认就行。
- **手机消息** — 手机在充电、在兜里、在另一个房间，验证码来了还是得摸出手机。现在短信和 App 通知直接弹在电脑上，一键复制验证码。
- **GitHub 动态** — 项目发出去，就总想回头看看有没有人理。第一颗 star、第一个 issue，不用刷 GitHub，卡片第一时间给你报喜。
- **耳机连接** — 耳机一连上电脑，听歌软件自动打开；断开时按你的设置暂停或收尾，不用手忙脚乱找界面。
- **坐坐热力图** — 今天坐了多久、这周哪天最狠，一张热力图翻着看。久坐提醒管当下，它管复盘。

全都是插件，在「插件中心」随开随关。写一个插件，就能给桌面接入一种新小窗：弹卡片、放声音、开画布、常驻交互，都行。

> [!NOTE]
> 它不拍屏幕、不看文件、不上传数据。判断忙闲只靠鼠标键盘的动静、前台开的是哪类软件，这些记录全在你自己的电脑里。

## 下载

Windows / macOS / Linux，支持开机自启。

**[下载最新版本](https://github.com/lanxiuyun/Catrace/releases/latest)**

## 有些窗口，小窗就够了

不是每件事都值得开一个完整的应用窗口。倒计时、一句歌词、一局牌、一条动态——很多事一张小窗就够了：弹出来、用完、消失，不打断手头的事。

这是 Catrace 的赌注：小窗交互，会不会是桌面的一种未来方向。先做出来，一个小窗一个小窗试过去。

## 自己写插件

插件的开关和设置都在「插件中心」。想自己动手写，事件协议、宿主能力和示例在 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin)。

## 友链

[![友链 linux.do](https://img.shields.io/badge/LINUX--DO-Community-blue.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BPGNsaXBQYXRoIGlkPSJhIj48Y2lyY2xlIGN4PSI2MCIgY3k9IjYwIiByPSI0NyIvPjwvY2xpcFBhdGg%2BPGNpcmNsZSBmaWxsPSIjZjBmMGYwIiBjeD0iNjAiIGN5PSI2MCIgcj0iNTAiLz48cmVjdCBmaWxsPSIjMWMxYzFlIiBjbGlwLXBhdGg9InVybCgjYSkiIHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIzMCIvPjxyZWN0IGZpbGw9IiNmMGYwZjAiIGNsaXAtcGF0aD0idXJsKCNhKSIgeD0iMTAiIHk9IjQwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjQwIi8%2BPHJlY3QgZmlsbD0iI2ZmYjAwMyIgY2xpcC1wYXRoPSJ1cmwoI2EpIiB4PSIxMCIgeT0iODAiIHdpZHRoPSIxMDAiIGhlaWdodD0iMzAiLz48L3N2Zz4%3D&style=flat)](https://linux.do/)
