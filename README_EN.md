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

Catrace is a desktop event system that keeps your time at the computer organized and healthier. It ships a set of ready-to-use plugins and quietly watches your usage in the background, reminding you when it's time — without interrupting your focus.

**Built-in plugins:**

- **Rest reminder** — Many people sit in front of the computer for hours, and by the time they realize it, their back and neck are already sore. It doesn't screenshot your screen or read what you're doing — it only quietly checks whether your mouse has moved or keyboard has been tapped, and reminds you to stand up and take a break when you've been working continuously for too long. Two reminder modes: floating notification cards and a full-screen overlay.
- **Agent notifications** — If you're a heavy AI coding user, it keeps an eye on agents like Claude Code, Codex, Gemini CLI, and Kimi for you, and lets you approve or deny permission requests right on the card.

**External plugins:**

- **Scheduled reminders** — Custom intervals or fixed daily times.
- **Bluetooth music** (bt-music) — Shows a notification or launches your music app when Bluetooth headphones connect, and pauses or closes it on disconnect per your settings.
- **GitHub notifications** — Fetches your GitHub unread notifications and pops a card when there's new activity.
- **SmsForwarder notifications** — Forwards SMS or app notifications from an Android phone to your desktop as cards.
- **Generic notify** (notify-demo) — A demo plugin that sends custom Toasts manually.
- **Sidecar capability demo** (sidecar-echo) — Demonstrates sidecar capabilities such as reading/writing files, picking directories, and making HTTP requests.

**Plugin ecosystem** — Built-in plugins work out of the box; external plugins can be installed from a local folder or zip, enabling only what you need.

## How it knows you're busy

The rest reminder doesn't take screenshots of your screen, nor does it read what you're doing. The host does three things in the background to judge your state:

- **Sense** — Continuously collects three lightweight signals: the current foreground app (sampled once per second), keyboard presses, and mouse movement. Everything is stored locally and never uploaded.
- **Judge** — Uses these signals to decide in real time whether you're working or resting: it tells "work" from "leisure" by the foreground app name, and on Windows it also checks system audio output to detect "screen consumption" — watching videos, listening to music, or live streams where you're staring at the screen with little keyboard/mouse activity.
- **Settle** — Every minute it summarizes the signals (dominant app, key count, mouse distance) as the basis for rest reminders and every other plugin.

How your work rhythm is measured:

- It starts counting from the first time you type or move the mouse today.
- If you get up for water, reply to a message, or zone out — as long as you don't stop for a continuous stretch, it still considers you in the same work rhythm.
- Only when you truly pause and stay still for several minutes does it mark that time as rest.
- If you power through a full "work window" (say, 45 minutes) without enough rest in between, or you rest and then fill another full window, it pops up a gentle reminder: time to take a break.

## Plugin Center

Catrace organizes all features as plugins that you can enable or disable on demand in the Plugin Center, and you can install third-party external plugins to extend its capabilities.

- The left rail lists all plugins; the detail panel on the right manages each plugin's toggle, config, and status.
- External plugins can be installed from a local folder or zip; they run alongside the host and push custom notification cards over the event bus.
- For developers: Rubick-style plugin API plus a Sidecar runtime. See the [external plugin authoring guide](.agent/skills/external-plugin-authoring/how-to-develop-catrace-external-plugins-complete-guide.md).

## Friends

[![linux.do](https://img.shields.io/badge/LINUX--DO-Community-blue.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BPGNsaXBQYXRoIGlkPSJhIj48Y2lyY2xlIGN4PSI2MCIgY3k9IjYwIiByPSI0NyIvPjwvY2xpcFBhdGg%2BPGNpcmNsZSBmaWxsPSIjZjBmMGYwIiBjeD0iNjAiIGN5PSI2MCIgcj0iNTAiLz48cmVjdCBmaWxsPSIjMWMxYzFlIiBjbGlwLXBhdGg9InVybCgjYSkiIHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIzMCIvPjxyZWN0IGZpbGw9IiNmMGYwZjAiIGNsaXAtcGF0aD0idXJsKCNhKSIgeD0iMTAiIHk9IjQwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjQwIi8%2BPHJlY3QgZmlsbD0iI2ZmYjAwMyIgY2xpcC1wYXRoPSJ1cmwoI2EpIiB4PSIxMCIgeT0iODAiIHdpZHRoPSIxMDAiIGhlaWdodD0iMzAiLz48L3N2Zz4%3D&style=flat)](https://linux.do/)

## Contributing

See the [Contributing Guide](CONTRIBUTING.md) to get involved.
