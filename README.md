<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Catrace">
</p>

<h1 align="center">Catrace</h1>

<p align="center">
  <strong>坐太久了，右下角拍你一下</strong>
</p>

<p align="center">
  写代码写着写着，两小时没抬头。腰比闹钟先响。<br>
  Catrace 看着鼠标键盘：你在忙，它才计时；你歇了，它闭嘴。<br>
  Claude 要授权、GitHub 有人提 issue、手机来验证码——也从同一个角落冒出来。
</p>

<p align="center">
  <a href="https://github.com/lanxiuyun/Catrace/releases/latest"><img src="https://img.shields.io/github/v/release/lanxiuyun/Catrace?style=flat-square&color=7C3AED&label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC" alt="Latest Release"></a>
  <a href="https://github.com/lanxiuyun/Catrace/releases"><img src="https://img.shields.io/github/downloads/lanxiuyun/Catrace/total?style=flat-square&color=7C3AED&label=%E4%B8%8B%E8%BD%BD%E6%AC%A1%E6%95%B0" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square" alt="Platform">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="https://github.com/lanxiuyun/Catrace/releases/latest"><strong>下载</strong></a>
  ·
  <a href="https://lanxiuyun.github.io/Catrace">官网</a>
  ·
  <a href="https://github.com/lanxiuyun/catrace-plugin">插件</a>
  ·
  <a href="README_EN.md">English</a>
</p>

![Catrace](.readme/dashboard.png)

## 为什么要有这个

闹钟按点响。你在开会它也响，你已经躺平了它还在倒计时。

Catrace 不猜你「计划坐多久」，只看你实际在不在忙。连续工作太久，右下角弹一张卡：起来走走。卡片太温柔，就改成全屏——不站起来，点不掉。

同一张卡还接着别的事。不用为了一条授权、一个 issue、一条验证码，在终端、浏览器和口袋之间来回掏。

> [!NOTE]
> 不拍屏幕，不看文件，不上传。键鼠动没动，只存在你这台电脑里。

## 下载

Windows / macOS / Linux。装上就能用，可开机自启。

**[下载最新版本](https://github.com/lanxiuyun/Catrace/releases/latest)**

每小时喝口水、下班前打卡，也可以自己定。想多要一点：耳机一连上就打开听歌软件、linux.do 有人回你、桌面粘贴直接把图片存成文件、翻日期看哪天坐太久。想用的打开，不想用的关掉。

## 它怎么知道你在忙

只靠两件事，不看你敲了什么、点了哪里：

- **鼠标和键盘** — 动没动、动了多久
- **你正开着哪个软件** — 编辑器还是播放器

从你今天第一次碰键鼠开始计时。中间倒杯水、回条消息、发个呆，只要没连着停够一段时间，都还算在忙。真的一动不动好几分钟，才记成休息。

看视频、听音乐时键鼠可能半天不动——它会听系统声音，知道你还在用屏幕，不算休息。

一口气忙满一个工作窗口（比如 45 分钟）没歇够，右下角就会拍你一下。

## 自己写插件

开关都在插件中心。开发者从本地文件夹或 zip 安装，协议和例子在 [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin)。
