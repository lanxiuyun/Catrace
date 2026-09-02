<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Catrace">
</p>

<h1 align="center">Catrace</h1>

<p align="center">
  <strong>Sat too long? It pokes you in the corner.</strong>
</p>

<p align="center">
  Two hours into a coding session before you look up. Your back notices first.<br>
  Catrace watches the mouse and keyboard: it counts while you work, and shuts up when you rest.<br>
  Claude needs approval, someone filed a GitHub issue, a code hits your phone — same corner.
</p>

<p align="center">
  <a href="https://github.com/lanxiuyun/Catrace/releases/latest"><img src="https://img.shields.io/github/v/release/lanxiuyun/Catrace?style=flat-square&color=7C3AED&label=Latest%20Release" alt="Latest Release"></a>
  <a href="https://github.com/lanxiuyun/Catrace/releases"><img src="https://img.shields.io/github/downloads/lanxiuyun/Catrace/total?style=flat-square&color=7C3AED&label=Downloads" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square" alt="Platform">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="https://github.com/lanxiuyun/Catrace/releases/latest"><strong>Download</strong></a>
  ·
  <a href="https://lanxiuyun.github.io/Catrace">Homepage</a>
  ·
  <a href="https://github.com/lanxiuyun/catrace-plugin">Plugins</a>
  ·
  <a href="README.md">中文</a>
</p>

![Catrace](.readme/dashboard-en.png)

## Why this exists

Alarms fire on a schedule. They fire in meetings. They keep counting after you've already lain down.

Catrace does not care how long you *planned* to sit. It cares whether you actually are. Work too long without a break, and a card slides in at the bottom-right: stand up. If a card is too polite, go fullscreen — the screen stays covered until you get up.

The same card catches the other stuff, so you are not digging through a terminal, a browser, and a pocket for one approval, one issue, one SMS code.

> [!NOTE]
> No screen recording. No file reading. No upload. Whether the mouse moved stays on this computer.

## Download

Windows / macOS / Linux. Install and go. Autostart is optional.

**[Download latest release](https://github.com/lanxiuyun/Catrace/releases/latest)**

Hourly water, clock-out reminder — set your own. Extra if you want it: headphones connect and the music app opens, linux.do replies land on the desktop, paste an image on the desktop and it saves as a file, flip back through days you sat too long. Turn on what you want; turn off what you don't.

## How it knows you're busy

Two things only — not what you typed, not where you clicked:

- **Mouse and keyboard** — whether they moved, and for how long
- **Which app is in front** — editor or player

Counting starts the first time you touch input today. Water, a reply, zoning out — still work, unless you actually stay still for several minutes. That pause is rest.

Quiet video or music can leave the mouse idle. Catrace hears system audio, knows the screen is still in use, and does not count that as a break.

Fill a work window (say 45 minutes) without enough rest, and the corner pokes you.

## Write a plugin

Toggles live in Plugin Center. Devs install from a folder or zip; protocol and examples: [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin).
