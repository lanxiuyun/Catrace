import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'bt-music'
const isWindows = process.platform === 'win32'

const DEFAULT_CONFIG = {
  /** Master switch inside plugin settings (sidecar may still run). */
  listenEnabled: true,
  /** Match if device name contains any keyword; empty = all BT audio. */
  nameKeywords: [],
  playerPath: '',
  playerArgs: [],
  notifyDisconnect: true,
  /** Connect → spawn player without waiting for toast action. */
  autoLaunchOnConnect: false,
  /** Disconnect → send system media pause key. */
  pauseOnDisconnect: false,
  /** 0 = sticky until dismiss; >0 = auto-hide seconds */
  connectedAutoHideSec: 5,
  disconnectedAutoHideSec: 3,
}

/** @type {typeof DEFAULT_CONFIG} */
let config = {
  ...DEFAULT_CONFIG,
  nameKeywords: [...DEFAULT_CONFIG.nameKeywords],
  playerArgs: [...DEFAULT_CONFIG.playerArgs],
}

/** Recently seen paired BT audio names for settings quick-pick (not only connected). */
/** @type {Map<string, { id: string, name: string }>} */
const pairedCatalog = new Map()

/** @type {Map<string, { id: string, name: string, source: string, groupKey: string }>} */
const known = new Map()
let lastWatchError = ''
/** First successful PnP snapshot only seeds; later deltas may publish. */
let pnpSeeded = false

/** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
let watcherChild = null
/** @type {readline.Interface | null} */
let watcherRl = null
let watcherGeneration = 0
/** Coalesce bursty DeviceChange events on the Node side too. */
let applyDebounceTimer = null
/** @type {{ devices: any[], reason: string } | null} */
let pendingSnapshot = null
/** Retry scans when IsConnected lags behind the first PnP event. */
let connectProbeTimer = null
let connectProbeLeft = 0

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = (message, data, level = 'info') =>
  send({ v: 1, op: 'log', level, message, data })

function respond(requestId, ok, result, error) {
  const message = { v: 1, op: 'response', requestId, ok }
  if (ok) message.result = result ?? null
  else message.error = error || 'request failed'
  send(message)
}

function clampAutoHideSec(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const rounded = Math.round(n)
  if (rounded <= 0) return 0
  return Math.min(600, Math.max(3, rounded))
}

function normalizeKeywords(input) {
  const raw = []
  if (Array.isArray(input)) {
    for (const item of input) {
      const s = String(item || '').trim()
      if (s) raw.push(s)
    }
  } else if (typeof input === 'string') {
    for (const part of input.split(/[,，;；\n]+/)) {
      const s = part.trim()
      if (s) raw.push(s)
    }
  }
  const seen = new Set()
  const out = []
  for (const k of raw) {
    const key = k.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(k)
    if (out.length >= 20) break
  }
  return out
}

function normalizeConfig(input = {}) {
  const next = {
    ...config,
    nameKeywords: [...(config.nameKeywords || [])],
    playerArgs: [...(config.playerArgs || [])],
  }
  if (typeof input.listenEnabled === 'boolean') next.listenEnabled = input.listenEnabled
  if (Array.isArray(input.nameKeywords) || typeof input.nameKeywords === 'string') {
    next.nameKeywords = normalizeKeywords(input.nameKeywords)
  } else if (typeof input.nameFilter === 'string' && input.nameFilter.trim()) {
    // legacy single filter string → one keyword
    next.nameKeywords = normalizeKeywords([input.nameFilter])
  }
  if (typeof input.playerPath === 'string') next.playerPath = input.playerPath.trim()
  if (Array.isArray(input.playerArgs)) {
    next.playerArgs = input.playerArgs.map((v) => String(v))
  } else if (typeof input.playerArgs === 'string') {
    next.playerArgs = splitArgs(input.playerArgs)
  }
  if (typeof input.notifyDisconnect === 'boolean') next.notifyDisconnect = input.notifyDisconnect
  if (typeof input.autoLaunchOnConnect === 'boolean') {
    next.autoLaunchOnConnect = input.autoLaunchOnConnect
  }
  if (typeof input.pauseOnDisconnect === 'boolean') {
    next.pauseOnDisconnect = input.pauseOnDisconnect
  }
  // legacy launchDelayMs ignored — always start immediately
  if (
    typeof input.connectedAutoHideSec === 'number' ||
    typeof input.connectedAutoHideSec === 'string'
  ) {
    next.connectedAutoHideSec = clampAutoHideSec(input.connectedAutoHideSec, next.connectedAutoHideSec)
  }
  if (
    typeof input.disconnectedAutoHideSec === 'number' ||
    typeof input.disconnectedAutoHideSec === 'string'
  ) {
    next.disconnectedAutoHideSec = clampAutoHideSec(
      input.disconnectedAutoHideSec,
      next.disconnectedAutoHideSec,
    )
  }
  return next
}

function splitArgs(value) {
  return (
    value.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) =>
      part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part,
    ) || []
  )
}

function matchesFilter(name) {
  const keywords = Array.isArray(config.nameKeywords) ? config.nameKeywords : []
  if (!keywords.length) return true
  const hay = String(name || '').toLowerCase()
  return keywords.some((k) => hay.includes(String(k).toLowerCase()))
}

function autoHideMs(sec) {
  const s = clampAutoHideSec(sec, 0)
  return s <= 0 ? 0 : s * 1000
}

function publishConnected(device, reason) {
  if (!config.listenEnabled) return
  const hideMs = autoHideMs(config.connectedAutoHideSec)
  const sticky = hideMs <= 0
  const payload = {
    deviceId: device.id,
    deviceName: device.name,
    source: device.source,
    reason,
    pluginId,
    publishedAt: new Date().toISOString(),
  }
  if (!sticky) payload.auto_hide_ms = hideMs

  // Quiet auto-launch still gets a short toast unless user set 0 sticky.
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'bt-music.connected',
      kind: 'bt-music',
      title: '耳机已连接',
      body: device.name || '蓝牙音频设备',
      level: 'success',
      sticky,
      actions: config.autoLaunchOnConnect
        ? [{ id: 'dismiss', label: sticky ? '知道了' : '关闭' }]
        : sticky
          ? [
              { id: 'open-player', label: '打开听歌' },
              { id: 'dismiss', label: '知道了' },
            ]
          : [
              { id: 'open-player', label: '打开听歌' },
              { id: 'dismiss', label: '关闭' },
            ],
      payload,
      dedupeKey: `bt-music:connected:${device.id}`,
    },
  })

  if (config.autoLaunchOnConnect) {
    openPlayer(device.name).catch((error) => {
      log(
        'auto-launch failed',
        { error: error instanceof Error ? error.message : String(error) },
        'warn',
      )
    })
  }
}

function publishDisconnected(device, reason) {
  if (!config.listenEnabled) return
  if (config.pauseOnDisconnect) {
    sendMediaPause().catch(() => {})
  }
  if (!config.notifyDisconnect) return
  const hideMs = autoHideMs(config.disconnectedAutoHideSec)
  const sticky = hideMs <= 0
  const payload = {
    deviceId: device.id,
    deviceName: device.name,
    source: device.source,
    reason,
    pluginId,
    publishedAt: new Date().toISOString(),
  }
  if (!sticky) payload.auto_hide_ms = hideMs

  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'bt-music.disconnected',
      kind: 'bt-music',
      title: '耳机已断开',
      body: device.name || '蓝牙音频设备',
      level: 'info',
      sticky,
      actions: [{ id: 'dismiss', label: '关闭' }],
      payload,
      dedupeKey: `bt-music:disconnected:${device.id}`,
    },
  })
}

function psSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Start (or re-activate) a GUI app like a normal user launch:
 * Start-Process + find main window + restore + SetForegroundWindow.
 */
async function openPlayerWindows(playerPath, args) {
  const pathLit = psSingleQuote(playerPath)
  const argsLit = `@(${(args || []).map((a) => psSingleQuote(a)).join(',')})`
  const script = `
$ErrorActionPreference = 'Stop'
if (-not ('CatraceWinActivate' -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Collections.Generic;

public static class CatraceWinActivate {
  public const int SW_RESTORE = 9;
  public const int SW_SHOW = 5;
  public const int SW_SHOWNA = 8;
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_SHOWWINDOW = 0x0040;
  public const int HWND_TOP = 0;
  public const int HWND_TOPMOST = -1;
  public const int HWND_NOTOPMOST = -2;

  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
  [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

  public const uint GW_OWNER = 4;
  public const int GWL_STYLE = -16;
  public const int GWL_EXSTYLE = -20;
  public const int WS_VISIBLE = 0x10000000;
  public const int WS_EX_TOOLWINDOW = 0x00000080;
  public const int WS_EX_APPWINDOW = 0x00040000;
  public const int WPF_ASYNCWINDOWPLACEMENT = 0x0004;
  public const int SW_SHOWMINIMIZED = 2;

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }

  [StructLayout(LayoutKind.Sequential)]
  public struct WINDOWPLACEMENT {
    public int length;
    public int flags;
    public int showCmd;
    public POINT ptMinPosition;
    public POINT ptMaxPosition;
    public RECT rcNormalPosition;
  }

  static bool IsCandidateTopLevel(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
    // Owned windows (tooltips/popups) are usually not the main frame.
    if (GetWindow(hWnd, GW_OWNER) != IntPtr.Zero) return false;
    int style = GetWindowLong(hWnd, GWL_STYLE);
    int ex = GetWindowLong(hWnd, GWL_EXSTYLE);
    bool iconic = IsIconic(hWnd);
    bool visible = IsWindowVisible(hWnd) || (style & WS_VISIBLE) != 0 || iconic;
    if (!visible) return false;
    // Skip pure tool windows unless marked app window.
    if ((ex & WS_EX_TOOLWINDOW) != 0 && (ex & WS_EX_APPWINDOW) == 0) return false;
    // Minimized windows often have off-screen tiny rects — still valid targets.
    if (iconic) return true;
    if (GetWindowTextLength(hWnd) <= 0) return false;
    RECT r;
    if (!GetWindowRect(hWnd, out r)) return false;
    int w = r.Right - r.Left;
    int h = r.Bottom - r.Top;
    return w >= 80 && h >= 80;
  }

  public static List<IntPtr> FindTopLevelWindows(int pid) {
    var list = new List<IntPtr>();
    EnumWindows((hWnd, l) => {
      uint wpid;
      GetWindowThreadProcessId(hWnd, out wpid);
      if ((int)wpid != pid) return true;
      if (!IsCandidateTopLevel(hWnd)) return true;
      list.Add(hWnd);
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static bool RestoreWindow(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return false;
    // SetWindowPlacement is the reliable path for minimized frames.
    WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
    wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
    if (GetWindowPlacement(hWnd, ref wp)) {
      if (wp.showCmd == SW_SHOWMINIMIZED || IsIconic(hWnd)) {
        wp.showCmd = SW_RESTORE;
        wp.flags |= WPF_ASYNCWINDOWPLACEMENT;
        SetWindowPlacement(hWnd, ref wp);
      }
    }
    if (IsIconic(hWnd)) {
      ShowWindowAsync(hWnd, SW_RESTORE);
      ShowWindow(hWnd, SW_RESTORE);
    } else {
      ShowWindowAsync(hWnd, SW_SHOW);
      ShowWindow(hWnd, SW_SHOW);
    }
    return true;
  }

  public static bool Activate(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero || !IsWindow(hWnd)) return false;
    RestoreWindow(hWnd);
    BringWindowToTop(hWnd);
    // Brief TOPMOST pulse helps when restore alone leaves the frame behind.
    SetWindowPos(hWnd, (IntPtr)HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    SetWindowPos(hWnd, (IntPtr)HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    SetWindowPos(hWnd, (IntPtr)HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);

    IntPtr fg = GetForegroundWindow();
    uint cur = GetCurrentThreadId();
    uint fgPidIgnore, tgtPidIgnore;
    uint fgTid = GetWindowThreadProcessId(fg, out fgPidIgnore);
    uint tgtTid = GetWindowThreadProcessId(hWnd, out tgtPidIgnore);
    bool attachedFg = false;
    bool attachedTgt = false;
    bool ok = false;
    try {
      if (fgTid != 0 && fgTid != cur) attachedFg = AttachThreadInput(cur, fgTid, true);
      if (tgtTid != 0 && tgtTid != cur && tgtTid != fgTid) attachedTgt = AttachThreadInput(cur, tgtTid, true);
      AllowSetForegroundWindow(-1);
      SwitchToThisWindow(hWnd, true);
      ok = SetForegroundWindow(hWnd);
      if (!ok) {
        // Last resort: keybd alt trick is avoided; retry restore + focus.
        RestoreWindow(hWnd);
        ok = SetForegroundWindow(hWnd);
      }
    } finally {
      if (attachedTgt) AttachThreadInput(cur, tgtTid, false);
      if (attachedFg) AttachThreadInput(cur, fgTid, false);
    }
    return ok || !IsIconic(hWnd);
  }

  public static bool ActivateProcess(int pid) {
    var wins = FindTopLevelWindows(pid);
    // Process.MainWindowHandle still works for many minimized apps.
    try {
      var proc = Process.GetProcessById(pid);
      IntPtr main = proc.MainWindowHandle;
      if (main != IntPtr.Zero && !wins.Contains(main)) wins.Insert(0, main);
    } catch {}
    if (wins.Count == 0) return false;
    bool ok = false;
    foreach (var w in wins) {
      if (Activate(w)) ok = true;
    }
    return ok;
  }
}
"@
}

$path = ${pathLit}
$argList = ${argsLit}
$exeName = [System.IO.Path]::GetFileNameWithoutExtension($path)

# Prefer activating an already-running instance of the same exe (user-like bring-to-front).
$existing = @(Get-Process -Name $exeName -ErrorAction SilentlyContinue | Where-Object {
  try {
    if (-not $_.Path) { return $true }
    [string]::Equals($_.Path, $path, [System.StringComparison]::OrdinalIgnoreCase)
  } catch { $true }
})
$pidOut = 0
$activated = $false
$started = $false

if ($existing.Count -gt 0) {
  foreach ($p in $existing) {
    # Force restore via MainWindowHandle first (best for minimized frames).
    try {
      if ($p.MainWindowHandle -ne [IntPtr]::Zero) {
        [void][CatraceWinActivate]::Activate([IntPtr]$p.MainWindowHandle)
      }
    } catch {}
    if ([CatraceWinActivate]::ActivateProcess($p.Id)) {
      $activated = $true
      $pidOut = $p.Id
      break
    }
  }
  if (-not $activated) { $pidOut = $existing[0].Id }
  # Second chance after a short wait (some apps delay un-minimize).
  if (-not $activated -and $pidOut -ne 0) {
    Start-Sleep -Milliseconds 250
    if ([CatraceWinActivate]::ActivateProcess($pidOut)) { $activated = $true }
  }
}

if (-not $activated) {
  $startParams = @{ FilePath = $path; PassThru = $true; ErrorAction = 'Stop' }
  if ($argList.Count -gt 0) { $startParams['ArgumentList'] = $argList }
  $proc = Start-Process @startParams
  $started = $true
  $pidOut = $proc.Id
  # Wait for a real top-level window (player splash / main).
  $deadline = [datetime]::UtcNow.AddSeconds(8)
  while ([datetime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 200
    try {
      $alive = Get-Process -Id $pidOut -ErrorAction Stop
    } catch { break }
    if ([CatraceWinActivate]::ActivateProcess($pidOut)) {
      $activated = $true
      break
    }
    # Some launchers spawn a child and exit — try same-name processes.
    $siblings = @(Get-Process -Name $exeName -ErrorAction SilentlyContinue)
    foreach ($s in $siblings) {
      if ([CatraceWinActivate]::ActivateProcess($s.Id)) {
        $activated = $true
        $pidOut = $s.Id
        break
      }
    }
    if ($activated) { break }
  }
} else {
  # Soft re-activate pulse
  Start-Sleep -Milliseconds 120
  [void][CatraceWinActivate]::ActivateProcess($pidOut)
}

Write-Output (("OK pid={0} started={1} activated={2}" -f $pidOut, $started, $activated))
`
  const stdout = await runPowerShell(script)
  const m = String(stdout || '').match(/OK pid=(\d+) started=(True|False) activated=(True|False)/i)
  if (!m) {
    throw new Error(stdout.trim() || 'launch produced no result')
  }
  return {
    ok: true,
    pid: Number(m[1]),
    started: /^true$/i.test(m[2]),
    activated: /^true$/i.test(m[3]),
    path: playerPath,
  }
}

async function openPlayer(deviceName) {
  const playerPath = String(config.playerPath || '').trim()
  if (!playerPath) {
    log('open-player skipped: no playerPath configured', { deviceName }, 'warn')
    return { ok: false, error: '请先在设置里选择听歌程序' }
  }
  const args = Array.isArray(config.playerArgs) ? config.playerArgs.map((v) => String(v)) : []
  try {
    if (isWindows) {
      const result = await openPlayerWindows(playerPath, args)
      log('opened player', {
        path: playerPath,
        args,
        pid: result.pid,
        deviceName,
        started: result.started,
        activated: result.activated,
        via: 'start-process-activate',
      })
      return result
    }
    const child = spawn(playerPath, args, {
      detached: true,
      stdio: 'ignore',
      shell: false,
    })
    child.unref()
    log('opened player', {
      path: playerPath,
      args,
      pid: child.pid,
      deviceName,
      via: 'spawn',
    })
    return { ok: true, pid: child.pid, path: playerPath, started: true, activated: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('open player failed', { path: playerPath, message }, 'error')
    return { ok: false, error: message }
  }
}

async function sendMediaPause() {
  if (!isWindows) return { ok: false, error: 'pause only on Windows' }
  // VK_MEDIA_PLAY_PAUSE = 0xB3 — toggles pause on most players / system mixer.
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CatraceMediaKeys {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const byte VK_MEDIA_PLAY_PAUSE = 0xB3;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public static void Toggle() {
    keybd_event(VK_MEDIA_PLAY_PAUSE, 0, 0, UIntPtr.Zero);
    keybd_event(VK_MEDIA_PLAY_PAUSE, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }
}
"@
[CatraceMediaKeys]::Toggle()
`
  try {
    await runPowerShell(script)
    log('sent media play/pause key', {})
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('media pause failed', { message }, 'warn')
    return { ok: false, error: message }
  }
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `powershell exit ${code}`))
        return
      }
      resolve(stdout.trim())
    })
  })
}

/** Strip role suffixes so A2DP + Hands-Free collapse to one headset. */
function deviceGroupKey(name) {
  let n = String(name || '')
  // AudioEndpoint style: "耳机 (荣耀亲选耳夹式耳机 Hands-Free)" → inner name.
  const paren = n.match(/^[^\(]+\((.+)\)\s*$/)
  if (paren) n = paren[1]
  return (
    n
      .replace(
        /\s*[\(\[]?\s*(hands-?free(?:\s+ag(?:\s+audio)?)?|stereo|ag audio|headset|a2dp|avrcp|voip|通信|立体声|免提)\s*[\)\]]?\s*$/i,
        '',
      )
      .replace(
        /\s+(hands-?free(?:\s+ag(?:\s+audio)?)?|stereo|ag audio|a2dp|avrcp|voip|通信|立体声|免提)\s*$/i,
        '',
      )
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase() || String(name || '').toLowerCase()
  )
}

/** True for classic BT audio sinks — not every BLE keyboard/mouse. */
function isBluetoothAudioCandidate(item) {
  const name = String(item.name || '')
  const id = String(item.id || '')
  const cls = String(item.className || '')
  const hay = `${id}\n${name}\n${cls}`

  // Local speakers / HDMI monitors — never treat as headset connect.
  if (/realtek|nvidia|high definition audio|microsoft gs|voice clarity|扬声器\s*\(/i.test(hay)) {
    if (!/bthenum|bthhfenum|耳机|headset|hands-?free|a2dp|avrcp/i.test(hay)) return false
  }

  // Primary path on this machine: A2DP/HFP MEDIA under BTHENUM / BTHHFENUM.
  if (/bthhfenum|bthenum\\\{0000110[bcde]|bthenum\\\{0000111e/i.test(id)) return true
  if (/^media$/i.test(cls) && /bth|bluetooth|耳机|headset|hands-?free/i.test(hay)) return true

  // AudioEndpoint for headsets often stay Status=Unknown even while connected;
  // names look like "耳机 (荣耀亲选耳夹式耳机)".
  if (/audioendpoint/i.test(cls) || /\\mmdevapi\\/i.test(id)) {
    if (/耳机|headset|hands-?free|headphone|earbud|buds|airpods|freebuds|linkbuds|wh-\d|xm[345]/i.test(name)) {
      return true
    }
    // "Something (DeviceName Hands-Free)" pattern after local DAC exclusion above.
    if (/\(.+\)/.test(name) && /hands-?free|stereo|a2dp|蓝牙/i.test(name)) return true
  }

  // Bluetooth class leaf device (not LE service UUID noise).
  if (/^bluetooth$/i.test(cls) && /bthenum\\dev_/i.test(id) && /耳机|headset|buds|airpods|headphone/i.test(name)) {
    return true
  }

  return /bthhfenum|airpods|galaxy buds|wh-\d|xm[345]|freebuds|linkbuds/i.test(hay)
}

function pickPreferredEndpoint(candidates) {
  // Prefer stereo/A2DP-looking names over Hands-Free / AG Audio.
  const score = (d) => {
    const n = String(d.name || '').toLowerCase()
    const id = String(d.id || '').toLowerCase()
    if (/hands-?free|ag audio|通信|免提|voip|bthhfenum|0000111e|00001108/.test(`${n}\n${id}`)) return 0
    if (/stereo|立体声|a2dp|0000110b|0000110a/.test(`${n}\n${id}`)) return 2
    if (/media/i.test(d.className || '')) return 2
    return 1
  }
  return [...candidates].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0]
}

function displayNameFor(device) {
  // Prefer clean product name over "耳机 (xxx Hands-Free)".
  const raw = String(device.name || '').trim()
  const paren = raw.match(/^[^\(]+\((.+)\)\s*$/)
  let name = paren ? paren[1].trim() : raw
  name = name
    .replace(/\s+hands-?free(?:\s+ag(?:\s+audio)?)?\s*$/i, '')
    .replace(/\s+stereo\s*$/i, '')
    .replace(/\s+avrcp.*$/i, '')
    .trim()
  return name || raw
}

/**
 * Fast collect: only MEDIA + a few Bluetooth class nodes (not full PnP dump).
 * Writes UTF-8 JSON array to $outFile. Used by watcher and one-shot list.
 */
function psCollectConnectedScript(outFilePs) {
  return `
$ErrorActionPreference = 'Stop'
$outFile = '${outFilePs}'
$seen = @{}
$items = New-Object System.Collections.Generic.List[object]

function Test-BtAudioId([string]$id, [string]$name, [string]$cls) {
  if ($cls -eq 'MEDIA' -and ($id -match 'BTHENUM|BTHHFENUM')) { return $true }
  if ($cls -eq 'Bluetooth' -and $id -match 'BTHENUM\\\\DEV_' -and ($name -match '耳机|Headset|Buds|AirPods|Headphone|Ear|WH-|XM|FreeBuds|LinkBuds')) { return $true }
  if ($cls -eq 'System' -and $id -match 'BTHENUM' -and ($name -match 'Hands-Free|耳机')) { return $true }
  if ($cls -eq 'Bluetooth' -and $id -match 'BTHENUM\\\\\\{0000110' -and ($name -match 'Avrcp|A2DP|耳机|Headset')) { return $true }
  return $false
}

function Add-IfConnected($d) {
  if ($null -eq $d) { return }
  $id = [string]$d.InstanceId
  if ([string]::IsNullOrEmpty($id)) { return }
  if ($seen.ContainsKey($id)) { return }
  $name = [string]$d.FriendlyName
  $cls = [string]$d.Class
  $st = [string]$d.Status
  if ($st -eq 'Error') { return }
  if (-not (Test-BtAudioId $id $name $cls)) { return }
  $connected = $false
  try {
    $p = Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_IsConnected' -ErrorAction SilentlyContinue
    if ($null -ne $p -and $null -ne $p.Data) { $connected = [bool]$p.Data }
  } catch {}
  if (-not $connected) { return }
  $seen[$id] = $true
  [void]$items.Add([pscustomobject]@{
    FriendlyName = $name
    InstanceId = $id
    Class = $cls
    Status = $st
    IsConnected = $true
  })
}

# MEDIA first — A2DP/HFP sinks live here and the class set is small.
foreach ($d in @(Get-PnpDevice -Class MEDIA -Status OK -ErrorAction SilentlyContinue)) { Add-IfConnected $d }
# Bluetooth class leaf devices (name-filtered inside Add-IfConnected).
foreach ($d in @(Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue)) { Add-IfConnected $d }

if ($items.Count -eq 0) { $json = '[]' }
else { $json = ($items | ConvertTo-Json -Compress -Depth 3) }
[System.IO.File]::WriteAllText($outFile, $json, [System.Text.UTF8Encoding]::new($false))
`
}

function parseEndpointFile(outFile) {
  if (!fs.existsSync(outFile)) return []
  const raw = fs.readFileSync(outFile, 'utf8').trim()
  if (!raw) return []
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    lastWatchError = `json parse failed: ${error instanceof Error ? error.message : String(error)}`
    log('device list json parse failed', { preview: raw.slice(0, 200) }, 'warn')
    return []
  }
  const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
  const mapped = list
    .map((item) => {
      const name = String(item.FriendlyName || item.friendlyName || '').trim()
      const id = String(item.InstanceId || item.instanceId || name).trim()
      const className = String(item.Class || item.class || '').trim()
      const status = String(item.Status || item.status || '').trim()
      const isConnected = item.IsConnected === true || item.isConnected === true
      if (!id || !name) return null
      // Paired-but-idle nodes stay Status=OK; only IsConnected means link up.
      if (!isConnected) return null
      if (/^error$/i.test(status)) return null
      if (/^media$/i.test(className) && !/^ok$/i.test(status)) return null
      return {
        id,
        name,
        className,
        status,
        source: 'pnp-bt-audio',
        groupKey: deviceGroupKey(name),
      }
    })
    .filter(Boolean)
    .filter((d) => isBluetoothAudioCandidate(d))
    .filter((d) => matchesFilter(d.name) || matchesFilter(displayNameFor(d)))
    .map((d) => ({
      ...d,
      name: displayNameFor(d),
    }))

  // One toast per headset group (collapse Hands-Free + Stereo / A2DP + HFP).
  const groups = new Map()
  for (const device of mapped) {
    const key = device.groupKey
    const bucket = groups.get(key) || []
    bucket.push(device)
    groups.set(key, bucket)
  }
  return [...groups.values()].map((bucket) => pickPreferredEndpoint(bucket))
}

async function listWindowsAudioEndpoints() {
  // Write JSON to a UTF-8 file — console stdout on Chinese Windows is often CP936.
  // Paired headsets keep PnP Status=OK forever; only DEVPKEY_Device_IsConnected
  // flips True while the radio link is up. Require isConnected=true.
  const outFile = path.join(os.tmpdir(), `catrace-bt-music-endpoints-${process.pid}.json`)
  const outFilePs = outFile.replace(/'/g, "''")
  try {
    await runPowerShell(psCollectConnectedScript(outFilePs))
    return parseEndpointFile(outFile)
  } finally {
    try {
      fs.unlinkSync(outFile)
    } catch {
      /* ignore */
    }
  }
}

function applySnapshot(devices, reason, { seedOnly = false } = {}) {
  const nextGroupKeys = new Set(devices.map((d) => d.groupKey || deviceGroupKey(d.name)))

  for (const device of devices) {
    const groupKey = device.groupKey || deviceGroupKey(device.name)
    const already =
      known.has(device.id) ||
      [...known.values()].some((d) => (d.groupKey || deviceGroupKey(d.name)) === groupKey)
    if (already) {
      // Refresh stored record id/name if same group reappeared under new endpoint id.
      for (const [id, prev] of [...known.entries()]) {
        if ((prev.groupKey || deviceGroupKey(prev.name)) !== groupKey) continue
        if (id !== device.id) known.delete(id)
      }
      known.set(device.id, { ...device, groupKey })
      continue
    }
    known.set(device.id, { ...device, groupKey })
    if (!seedOnly) publishConnected(device, reason)
  }

  if (seedOnly) return

  for (const [id, device] of [...known.entries()]) {
    const groupKey = device.groupKey || deviceGroupKey(device.name)
    if (nextGroupKeys.has(groupKey)) continue
    known.delete(id)
    publishDisconnected(device, reason)
  }
}

function scheduleConnectProbe(reason) {
  // Fast MEDIA-class scans from Node while IsConnected catches up to audio.
  connectProbeLeft = 8
  if (connectProbeTimer) clearTimeout(connectProbeTimer)
  const gaps = [100, 150, 200, 300, 400, 500, 700, 1000]
  let i = 0
  const tick = () => {
    connectProbeTimer = null
    if (connectProbeLeft <= 0) return
    connectProbeLeft -= 1
    const gap = gaps[Math.min(i, gaps.length - 1)]
    i += 1
    snapshotOnce(`${reason}:probe${i}`, { immediate: true })
      .catch(() => {})
      .finally(() => {
        if (connectProbeLeft > 0) {
          connectProbeTimer = setTimeout(tick, gap)
          connectProbeTimer.unref?.()
        }
      })
  }
  connectProbeTimer = setTimeout(tick, gaps[0])
  connectProbeTimer.unref?.()
}

function queueSnapshot(devices, reason, { seedOnly = false, immediate = false } = {}) {
  // Always seed the first successful snapshot so a failed startup seed
  // cannot turn the next event into a full toast flood.
  const effectiveSeed = seedOnly || !pnpSeeded
  rememberPaired(devices)
  const forceImmediate = immediate || effectiveSeed || /device-change|probe|event/i.test(reason)
  if (forceImmediate) {
    if (applyDebounceTimer) {
      clearTimeout(applyDebounceTimer)
      applyDebounceTimer = null
    }
    pendingSnapshot = null
    const before = known.size
    applySnapshot(devices, reason, { seedOnly: effectiveSeed })
    pnpSeeded = true
    lastWatchError = ''
    log('device snapshot applied', {
      reason,
      seedOnly: effectiveSeed,
      count: devices.length,
      names: devices.map((d) => d.name),
      mode: 'event',
      immediate: true,
    })
    // Event arrived but still no connected headset → keep probing IsConnected.
    if (
      !effectiveSeed &&
      known.size === before &&
      devices.length === 0 &&
      /device-change:event/i.test(reason)
    ) {
      scheduleConnectProbe(reason)
    }
    if (known.size > before && connectProbeTimer) {
      clearTimeout(connectProbeTimer)
      connectProbeTimer = null
      connectProbeLeft = 0
    }
    return
  }

  pendingSnapshot = { devices, reason }
  if (applyDebounceTimer) clearTimeout(applyDebounceTimer)
  applyDebounceTimer = setTimeout(() => {
    applyDebounceTimer = null
    const pending = pendingSnapshot
    pendingSnapshot = null
    if (!pending) return
    applySnapshot(pending.devices, pending.reason, { seedOnly: false })
    pnpSeeded = true
    lastWatchError = ''
    log('device snapshot applied', {
      reason: pending.reason,
      seedOnly: false,
      count: pending.devices.length,
      names: pending.devices.map((d) => d.name),
      mode: 'event',
    })
  }, 50)
  applyDebounceTimer.unref?.()
}

async function snapshotOnce(reason = 'manual', options = {}) {
  if (!isWindows) {
    lastWatchError = 'watch only implemented on Windows'
    return
  }
  try {
    const devices = await listWindowsAudioEndpoints()
    queueSnapshot(devices, reason, {
      seedOnly: options.seedOnly === true,
      immediate: options.immediate === true || options.seedOnly === true,
    })
  } catch (error) {
    lastWatchError = error instanceof Error ? error.message : String(error)
    log('device snapshot failed', { error: lastWatchError, reason }, 'warn')
  }
}

/**
 * Long-running PowerShell: DeviceChange → immediate MEDIA-class snapshot (no coalesce wait).
 * Node runs a short probe chain if IsConnected still lags behind audio.
 */
function buildWatcherScript(outFilePs) {
  const collect = psCollectConnectedScript(outFilePs)
  return `
$ErrorActionPreference = 'Continue'
$outFile = '${outFilePs}'

function Write-BtSnapshotMarker([string]$why) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
${collect
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n')}
    $sw.Stop()
    [Console]::Out.WriteLine(('SNAPSHOT why={0} ms={1}' -f $why, [int]$sw.ElapsedMilliseconds))
    [Console]::Out.Flush()
  } catch {
    [Console]::Error.WriteLine(('SNAPSHOT_ERROR ' + $_.Exception.Message))
  }
}

Write-BtSnapshotMarker 'seed'

$query = 'SELECT * FROM Win32_DeviceChangeEvent WHERE EventType = 2 OR EventType = 3'
$watcher = $null
try {
  $watcher = New-Object System.Management.ManagementEventWatcher
  $watcher.Query = New-Object System.Management.WqlEventQuery($query)
  $watcher.Options.Timeout = [System.TimeSpan]::FromSeconds(5)
  $watcher.Start()
  while ($true) {
    try {
      $null = $watcher.WaitForNextEvent()
      # Immediate first snapshot — audio may already be up by the time IsConnected flips.
      Write-BtSnapshotMarker 'event'
      # Drain burst without delaying the first marker above.
      $drainUntil = [datetime]::UtcNow.AddMilliseconds(80)
      $extra = 0
      while ([datetime]::UtcNow -lt $drainUntil) {
        try {
          $watcher.Options.Timeout = [System.TimeSpan]::FromMilliseconds(15)
          $null = $watcher.WaitForNextEvent()
          $extra++
        } catch { break }
      }
      $watcher.Options.Timeout = [System.TimeSpan]::FromSeconds(5)
      if ($extra -gt 0) { Write-BtSnapshotMarker 'event-burst' }
    } catch {
      continue
    }
  }
} finally {
  if ($null -ne $watcher) {
    try { $watcher.Stop() } catch {}
    try { $watcher.Dispose() } catch {}
  }
}
`
}

function stopWatcher() {
  watcherGeneration += 1
  if (applyDebounceTimer) {
    clearTimeout(applyDebounceTimer)
    applyDebounceTimer = null
  }
  if (connectProbeTimer) {
    clearTimeout(connectProbeTimer)
    connectProbeTimer = null
  }
  connectProbeLeft = 0
  pendingSnapshot = null
  if (watcherRl) {
    try {
      watcherRl.removeAllListeners()
      watcherRl.close()
    } catch {
      /* ignore */
    }
    watcherRl = null
  }
  if (watcherChild) {
    const child = watcherChild
    watcherChild = null
    try {
      child.kill()
    } catch {
      /* ignore */
    }
    // Windows: ensure the PowerShell tree dies.
    if (isWindows && child.pid) {
      try {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        }).unref?.()
      } catch {
        /* ignore */
      }
    }
  }
}

function startWatcher() {
  if (!isWindows) return
  stopWatcher()
  const generation = watcherGeneration
  const outFile = path.join(os.tmpdir(), `catrace-bt-music-watch-${process.pid}.json`)
  const outFilePs = outFile.replace(/'/g, "''")
  const script = buildWatcherScript(outFilePs)

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  watcherChild = child

  let stderrBuf = ''
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString('utf8')
    if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-2000)
  })

  child.on('error', (error) => {
    if (generation !== watcherGeneration) return
    lastWatchError = error instanceof Error ? error.message : String(error)
    log('device watcher failed to start', { error: lastWatchError }, 'error')
  })

  child.on('exit', (code, signal) => {
    if (generation !== watcherGeneration) return
    watcherChild = null
    if (watcherRl) {
      try {
        watcherRl.close()
      } catch {
        /* ignore */
      }
      watcherRl = null
    }
    lastWatchError = `watcher exited code=${code} signal=${signal || ''} ${stderrBuf.trim()}`.trim()
    log('device watcher exited; restarting in 2s', { code, signal, stderr: stderrBuf.slice(0, 400) }, 'warn')
    setTimeout(() => {
      if (generation !== watcherGeneration) return
      startWatcher()
    }, 2000).unref?.()
  })

  watcherRl = readline.createInterface({ input: child.stdout })
  watcherRl.on('line', (line) => {
    if (generation !== watcherGeneration) return
    const text = String(line || '').trim()
    if (!text) return
    if (text.startsWith('SNAPSHOT_ERROR')) {
      lastWatchError = text.slice('SNAPSHOT_ERROR'.length).trim()
      log('device watcher snapshot error', { error: lastWatchError }, 'warn')
      return
    }
    if (!text.startsWith('SNAPSHOT')) {
      // Ignore stray PS noise.
      return
    }
    // "SNAPSHOT why=event ms=42"
    const whyMatch = text.match(/why=([^\s]+)/i)
    const msMatch = text.match(/ms=(\d+)/i)
    const why = whyMatch ? whyMatch[1] : 'device-change'
    const scanMs = msMatch ? Number(msMatch[1]) : null
    try {
      const devices = parseEndpointFile(outFile)
      if (scanMs != null) {
        log('device watcher snapshot', { why, scanMs, count: devices.length }, scanMs > 800 ? 'warn' : 'info')
      }
      queueSnapshot(devices, why === 'seed' ? 'seed' : `device-change:${why}`, {
        seedOnly: why === 'seed',
        immediate: true,
      })
    } catch (error) {
      lastWatchError = error instanceof Error ? error.message : String(error)
      log('device watcher apply failed', { error: lastWatchError }, 'warn')
    }
  })

  log('device watcher started', {
    pid: child.pid,
    outFile,
    query: 'Win32_DeviceChangeEvent EventType=2|3',
  })
}

function statusPayload() {
  return {
    pluginId,
    platform: process.platform,
    pid: process.pid,
    watchSupported: isWindows,
    listenEnabled: config.listenEnabled,
    watchEnabled: config.listenEnabled,
    watchMode: isWindows ? 'device-change-event' : 'none',
    watcherPid: watcherChild?.pid || null,
    pnpSeeded,
    nameKeywords: [...(config.nameKeywords || [])],
    playerPath: config.playerPath,
    playerArgs: config.playerArgs,
    notifyDisconnect: config.notifyDisconnect,
    autoLaunchOnConnect: config.autoLaunchOnConnect,
    pauseOnDisconnect: config.pauseOnDisconnect,
    connectedAutoHideSec: config.connectedAutoHideSec,
    disconnectedAutoHideSec: config.disconnectedAutoHideSec,
    lastWatchError: lastWatchError || null,
    devices: [...known.values()],
    pairedDevices: [...pairedCatalog.values()],
  }
}

function filterSignature(cfg) {
  return JSON.stringify({
    on: cfg.listenEnabled !== false,
    keys: [...(cfg.nameKeywords || [])].map((k) => String(k).toLowerCase()).sort(),
  })
}

function applyHostConfig(input) {
  const prevSig = filterSignature(config)
  config = normalizeConfig(input)
  log('config applied', { config })
  if (isWindows && pnpSeeded && prevSig !== filterSignature(config)) {
    snapshotOnce('filter-change', { immediate: true }).catch(() => {})
  }
}

function rememberPaired(devices) {
  for (const d of devices) {
    const name = String(d.name || '').trim()
    if (!name) continue
    const id = String(d.id || name)
    pairedCatalog.set(name.toLowerCase(), { id, name })
  }
  // Cap catalog size
  if (pairedCatalog.size > 40) {
    const keys = [...pairedCatalog.keys()]
    for (const k of keys.slice(0, pairedCatalog.size - 40)) pairedCatalog.delete(k)
  }
}

/**
 * List paired BT audio names (not only currently connected) for settings quick-pick.
 */
async function listPairedBluetoothAudio() {
  if (!isWindows) return []
  const outFile = path.join(os.tmpdir(), `catrace-bt-music-paired-${process.pid}.json`)
  const outFilePs = outFile.replace(/'/g, "''")
  const script = `
$ErrorActionPreference = 'Stop'
$outFile = '${outFilePs}'
$raw = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object {
  $id = [string]$_.InstanceId
  $name = [string]$_.FriendlyName
  $cls = [string]$_.Class
  $st = [string]$_.Status
  if ($st -eq 'Error') { return $false }
  if ($cls -eq 'MEDIA' -and ($id -match 'BTHENUM|BTHHFENUM')) { return $true }
  if ($cls -eq 'Bluetooth' -and $id -match 'BTHENUM\\\\DEV_' -and ($name -match '耳机|Headset|Buds|AirPods|Headphone|Ear|WH-|XM')) { return $true }
  if ($cls -eq 'System' -and $id -match 'BTHENUM' -and ($name -match 'Hands-Free|耳机')) { return $true }
  return $false
})
$items = @()
foreach ($d in $raw) {
  $items += [pscustomobject]@{
    FriendlyName = $d.FriendlyName
    InstanceId = $d.InstanceId
    Class = $d.Class
    Status = $d.Status
    IsConnected = $true
  }
}
if ($items.Count -eq 0) { $json = '[]' } else { $json = ($items | ConvertTo-Json -Compress -Depth 3) }
[System.IO.File]::WriteAllText($outFile, $json, [System.Text.UTF8Encoding]::new($false))
`
  try {
    await runPowerShell(script)
    // Reuse parser without name keyword filter by temporarily clearing keywords.
    const saved = config.nameKeywords
    config.nameKeywords = []
    let devices = []
    try {
      devices = parseEndpointFile(outFile)
    } finally {
      config.nameKeywords = saved
    }
    rememberPaired(devices)
    return [...pairedCatalog.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  } finally {
    try {
      fs.unlinkSync(outFile)
    } catch {
      /* ignore */
    }
  }
}

function handleRequest(message) {
  const requestId = message.requestId || message.id
  if (!requestId) return
  const method = String(message.method || '')
  const params = message.params && typeof message.params === 'object' ? message.params : {}

  try {
    switch (method) {
      case 'getStatus':
        respond(requestId, true, statusPayload())
        break
      case 'listDevices':
        respond(requestId, true, { devices: [...known.values()] })
        break
      case 'listPairedDevices': {
        listPairedBluetoothAudio()
          .then((devices) => respond(requestId, true, { devices }))
          .catch((error) =>
            respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
          )
        break
      }
      case 'setConfig': {
        applyHostConfig(params)
        respond(requestId, true, statusPayload())
        break
      }
      case 'refresh': {
        snapshotOnce('manual-refresh', { immediate: true })
          .then(() => respond(requestId, true, statusPayload()))
          .catch((error) =>
            respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
          )
        break
      }
      case 'openPlayer': {
        openPlayer(params.deviceName)
          .then((result) => respond(requestId, result.ok, result, result.error))
          .catch((error) =>
            respond(requestId, false, null, error instanceof Error ? error.message : String(error)),
          )
        break
      }
      default:
        respond(requestId, false, null, `unknown method: ${method}`)
    }
  } catch (error) {
    respond(requestId, false, null, error instanceof Error ? error.message : String(error))
  }
}

function shutdown() {
  log('graceful shutdown', { devices: known.size })
  stopWatcher()
  process.exit(0)
}

send({ v: 1, op: 'ready' })
log('bt-music sidecar ready', {
  pluginId,
  pid: process.pid,
  platform: process.platform,
  protocol: process.env.CATRACE_PROTOCOL_VERSION,
  watchMode: isWindows ? 'device-change-event' : 'none',
})

if (isWindows) {
  startWatcher()
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.op === 'shutdown') {
    shutdown()
    return
  }

  if (message.op === 'config' && message.config && typeof message.config === 'object') {
    applyHostConfig(message.config)
    return
  }

  if (message.op === 'request') {
    handleRequest(message)
    return
  }

  if (message.op === 'resolved') {
    log('toast resolved by host', {
      eventId: message.eventId,
      actionId: message.actionId,
      resolutionKind: message.resolutionKind,
    })
    if (message.actionId === 'open-player') {
      const deviceName =
        message.payload?.deviceName || message.event?.payload?.deviceName || undefined
      openPlayer(deviceName).catch((error) => {
        log(
          'open-player from toast failed',
          { error: error instanceof Error ? error.message : String(error) },
          'warn',
        )
      })
    }
  }
})
