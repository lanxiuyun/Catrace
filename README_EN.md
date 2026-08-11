<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Catrace Logo">
</p>

<h1 align="center">Catrace</h1>

<p align="center">
  <strong>Desktop event system · Plugin runtime</strong><br>
  Rest reminder · Agent notifications · Scheduled reminders · Plugin ecosystem
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
  <a href="https://github.com/lanxiuyun/Catrace/releases/latest">
    ⬇️ <strong>Download latest release</strong>
  </a>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="https://lanxiuyun.github.io/Catrace">
    🏠 <strong>Homepage</strong>
  </a>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="https://github.com/lanxiuyun/Catrace">
    💖 <strong>Like it? Give us a star!</strong>
  </a>
</p>

<p align="center">
  <a href="README.md">中文</a> | English
</p>

![Catrace Dashboard](.readme/dashboard-en.png)

## What it does

In one sentence: install Catrace and a helpful little assistant sits in the corner of your screen. It reminds you to take a break and shows you notifications that matter to you — all as cards popping up in the bottom-right corner, without interrupting what you're doing.

Ready to use out of the box:

- **Sedentary reminder** — Many people sit in front of the computer for hours, and by the time they realize it, their back and neck are already sore. It watches whether your mouse and keyboard have moved, and when you've been working continuously for too long, it reminds you to stand up and move around. If cards are too gentle for you, you can set it to cover the whole screen to force a break.
- **Scheduled reminders** — Set your own interval (e.g. drink water every hour) or a fixed daily time (e.g. clock out before you leave).

Want more? Catrace can "install" additional features (called plugins):

- **AI assistant activity** — When you're using AI coding tools like Claude or Codex, it pops a card showing what the AI is doing or when it needs your approval, so you don't have to keep switching back to the terminal. Great for heavy AI coding users.
- **Bluetooth headphone music** — When headphones connect, automatically show a notification or launch your music app; on disconnect, pause or close it per your settings.
- **GitHub activity** — Get a card when someone files an issue or stars your project.
- **Phone message forwarding** — Forward SMS or app notifications from an Android phone to your desktop as cards (requires the SmsForwarder forwarding tool).

**Plugin ecosystem** — Built-in features work out of the box; plugins you want can be installed from a local folder or archive, enabled when you need them and disabled when you don't.

## How it knows you're busy

Don't worry — it doesn't record your screen or read your files. It only judges how busy you are from two things:

- **Your mouse and keyboard** — whether they've moved, and for how long.
- **Which app you have open** — a code editor, or a video player.

The rules are simple:

- It starts counting from the first time you touch the mouse or keyboard today.
- If you get up for water, reply to a message, or zone out — as long as you don't stop for a continuous stretch, it still considers you in the same work rhythm.
- Only when you truly pause and stay still for several minutes does it mark that time as rest.
- If you power through a full "work window" (say, 45 minutes) without enough rest in between, or you rest and then fill another full window, it pops a card to gently remind you: time to get up and move.

If you're quietly watching a video or listening to music, your mouse and keyboard may stay still for a while — Catrace also detects through system audio that you're still "using the screen," so it won't count that as rest. All this small data stays in your computer's local storage and is never uploaded.

## Plugin Center

All features live in a place called the Plugin Center — the list of features on the left, each feature's switch and settings on the right. You can see at a glance what's installed and what's enabled.

Want to build your own plugins? Developers are welcome — check out the plugin repo at [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin).

## Friends

[![linux.do](https://img.shields.io/badge/LINUX--DO-Community-blue.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BPGNsaXBQYXRoIGlkPSJhIj48Y2lyY2xlIGN4PSI2MCIgY3k9IjYwIiByPSI0NyIvPjwvY2xpcFBhdGg%2BPGNpcmNsZSBmaWxsPSIjZjBmMGYwIiBjeD0iNjAiIGN5PSI2MCIgcj0iNTAiLz48cmVjdCBmaWxsPSIjMWMxYzFlIiBjbGlwLXBhdGg9InVybCgjYSkiIHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIzMCIvPjxyZWN0IGZpbGw9IiNmMGYwZjAiIGNsaXAtcGF0aD0idXJsKCNhKSIgeD0iMTAiIHk9IjQwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjQwIi8%2BPHJlY3QgZmlsbD0iI2ZmYjAwMyIgY2xpcC1wYXRoPSJ1cmwoI2EpIiB4PSIxMCIgeT0iODAiIHdpZHRoPSIxMDAiIGhlaWdodD0iMzAiLz48L3N2Zz4%3D&style=flat)](https://linux.do/)

## Contributing

See the [Contributing Guide](CONTRIBUTING.md) to get involved.
