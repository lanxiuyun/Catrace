<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Catrace Logo">
</p>

<h1 align="center">Catrace</h1>

<p align="center">
  <strong>Desktop small-window system</strong><br>
  Local-first · Free & open source · Everything is a plugin
</p>

<p align="center">
  <a href="https://github.com/lanxiuyun/Catrace/releases/latest">
    <img src="https://img.shields.io/github/v/release/lanxiuyun/Catrace?style=flat-square&color=7C3AED&label=Latest%20Release" alt="Latest Release">
  </a>
  <a href="https://github.com/lanxiuyun/Catrace/releases">
    <img src="https://img.shields.io/github/downloads/lanxiuyun/Catrace/total?style=flat-square&color=7C3AED&label=Downloads" alt="Downloads">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square" alt="Platform">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License">
  </a>
</p>

<p align="center">
  <a href="https://github.com/lanxiuyun/Catrace/releases/latest">Download</a> ·
  <a href="https://github.com/lanxiuyun/catrace-plugin">Plugins</a> ·
  <a href="https://lanxiuyun.github.io/Catrace">Website</a> ·
  <a href="README.md">中文</a>
</p>

![Catrace Dashboard](.readme/dashboard-en.png)

## What Catrace is

Catrace is a **desktop small-window system**. Plugins decide what a window shows and how it interacts — a reminder card, a full-screen rest alarm that covers your display, or whatever comes next. The cards you see today are content *inside* those windows, not the OS notification center.

Its core is not "reminders"; it's the **window itself**. A plugin can open, collapse, move, or dress up a small window at any time. VSCode manages code editing; Catrace manages the **lifecycle of small windows**.

The built-in rest reminder and scheduled reminders are just the first residents of the small window; more capabilities plug in as plugins — install once, toggle as you like.

## What a small window can be

- **Rest reminders** — After a full work window (say, 45 minutes) without enough rest, a card pops in the corner; if a card is too gentle, go full-screen — it won't go away until you stand up.
- **Scheduled reminders** — Water every hour, check the numbers at 3pm, clock out on time — set an interval or a fixed time once, and the small window remembers.
- **AI assistant progress** — Claude Code or Codex running in the terminal: which step it's on, whether it needs approval — the small window tells you first, no more alt-tabbing.
- **Headphones** — Headphones connect, your music app opens by itself; when they disconnect, it pauses or wraps up per your settings.
- **Phone messages** — SMS, app notifications and verification codes forwarded to your desktop, landing in the corner window.
- **GitHub activity** — New issues and stars reach you the moment they happen.

> [!NOTE]
> No screen recording, no file reading, no uploading. It only looks at mouse and keyboard activity and which kind of app is in front — and all of that stays on your machine.

## Download

Windows / macOS / Linux, with optional launch at login. Plugins need no compilation — install from a **folder or zip**.

**[Get the latest release](https://github.com/lanxiuyun/Catrace/releases/latest)**

## How it knows you're busy

It doesn't guess how long you "planned" to sit; it watches whether you're actually busy:

- Counting starts the first time you touch the mouse or keyboard today;
- Grabbing water, replying to a message, or zoning out for a moment doesn't break the rhythm — only several consecutive still minutes counts as rest;
- A full work window without enough rest earns a tap.

Watching a video or listening to music keeps your hands still — it hears system audio and knows you're still using the screen.

## Plugins & community

The plugin repository is [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin): built-in features work out of the box; plugins you want are installed from a local folder or archive and toggled off whenever you like. To write your own, the protocol and examples live there too.

## Friends

<a href="https://linux.do/"><img src="https://www.boltp.com/favicon/linux.do.png" alt="linux.do" width="32" height="32"></a>
<a href="https://space.bilibili.com/67079745?spm_id_from=333.337.0.0"><img src="https://ts1.tc.mm.bing.net/th/id/OIP-C.pkSBH1VD3JAHQB25kVNJmQHaHa?r=0&amp;rs=1&amp;pid=ImgDetMain&amp;o=7&amp;rm=3" alt="玄离199" width="32" height="32"></a>