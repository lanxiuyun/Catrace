<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Catrace Logo">
</p>

<h1 align="center">Catrace</h1>

<p align="center">
  <strong>A desktop event system that owns the toast window lifecycle</strong><br>
  What shows up and how it interacts — plugins decide
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
  <a href="#download">Download</a> ·
  <a href="https://lanxiuyun.github.io/Catrace">Website</a> ·
  <a href="https://github.com/lanxiuyun/catrace-plugin">Plugins</a> ·
  <a href="README.md">中文</a>
</p>

![Catrace Dashboard](.readme/dashboard-en.png)

## A card pops up in the corner

Maybe it's "time to get up and move", maybe "AI awaits your approval", maybe a verification code — or maybe a hand of Texas Hold'em, or a canvas to doodle on.

Catrace is a desktop event system. It owns the life of these small toast windows: who raises them, where they appear, how long they live, and who cleans up after a button click. What a window shows and how it interacts is deliberately not its business — that's the plugin's.

Think VSCode: VSCode doesn't write code itself; it hosts the editor, and the coding experience grows out of extensions. Catrace doesn't decide window content; it hosts toast windows, and the small-window experience grows out of plugins.

## Small windows you get today

Rest reminders (a card nudges you to move after working too long — or takes over the full screen), scheduled reminders, AI coding assistant progress and approvals, SMS and app notifications from your Android phone, GitHub issues and stars, headphone events, pasted screenshots saved as files — all plugins, toggled in the Plugin Center.

Write one plugin, and a new kind of small window joins your desktop: cards, sounds, a canvas, always-on interactive widgets — all possible.

> [!NOTE]
> No screen recording, no file reading, no uploading. It only looks at mouse and keyboard activity and which kind of app is in front — and all of that stays on your machine.

## Download

Windows / macOS / Linux, with optional launch at login.

**[Get the latest release](https://github.com/lanxiuyun/Catrace/releases/latest)**

## Some windows are small enough

Not everything deserves a full application window. A countdown, a song lyric, a hand of cards, a new notification — many things fit in one small window: pop up, use it, gone, without interrupting what you were doing.

That's Catrace's bet: could small-window interaction be one direction for the desktop of the future? Build it first, and try it one small window at a time.

## Write your own plugin

Switches and settings for everything live in the Plugin Center. To build your own, the event protocol, host APIs and examples are in [catrace-plugin](https://github.com/lanxiuyun/catrace-plugin).

## Friends

[![linux.do](https://img.shields.io/badge/LINUX--DO-Community-blue.svg?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI%2BPGNsaXBQYXRoIGlkPSJhIj48Y2lyY2xlIGN4PSI2MCIgY3k9IjYwIiByPSI0NyIvPjwvY2xpcFBhdGg%2BPGNpcmNsZSBmaWxsPSIjZjBmMGYwIiBjeD0iNjAiIGN5PSI2MCIgcj0iNTAiLz48cmVjdCBmaWxsPSIjMWMxYzFlIiBjbGlwLXBhdGg9InVybCgjYSkiIHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIzMCIvPjxyZWN0IGZpbGw9IiNmMGYwZjAiIGNsaXAtcGF0aD0idXJsKCNhKSIgeD0iMTAiIHk9IjQwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjQwIi8%2BPHJlY3QgZmlsbD0iI2ZmYjAwMyIgY2xpcC1wYXRoPSJ1cmwoI2EpIiB4PSIxMCIgeT0iODAiIHdpZHRoPSIxMDAiIGhlaWdodD0iMzAiLz48L3N2Zz4%3D&style=flat)](https://linux.do/)
