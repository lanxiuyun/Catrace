import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'bt-music'
const isWindows = process.platform === 'win32'

const DEFAULT_CONFIG = {
  // Plugin enable starts the sidecar — always watch (no opt-in gate).
  nameFilter: '',
  playerPath: '',
  playerArgs: [],
  notifyDisconnect: true,
  /** 0 = sticky until dismiss; >0 = auto-hide seconds */
  connectedAutoHideSec: 5,
  disconnectedAutoHideSec: 3,
}

/** @type {typeof DEFAULT_CONFIG} */
let config = { ...DEFAULT_CONFIG }

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

function normalizeConfig(input = {}) {
  const next = { ...config }
  if (typeof input.nameFilter === 'string') next.nameFilter = input.nameFilter.trim()
  if (typeof input.playerPath === 'string') next.playerPath = input.playerPath.trim()
  if (Array.isArray(input.playerArgs)) {
    next.playerArgs = input.playerArgs.map((v) => String(v))
  } else if (typeof input.playerArgs === 'string') {
    next.playerArgs = splitArgs(input.playerArgs)
  }
  if (typeof input.notifyDisconnect === 'boolean') {
    next.notifyDisconnect = input.notifyDisconnect
  }
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
  // legacy pollIntervalMs ignored
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
  const filter = config.nameFilter.trim().toLowerCase()
  if (!filter) return true
  return String(name || '')
    .toLowerCase()
    .includes(filter)
}

function autoHideMs(sec) {
  const s = clampAutoHideSec(sec, 0)
  return s <= 0 ? 0 : s * 1000
}

function publishConnected(device, reason) {
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
      actions: sticky
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
}

function publishDisconnected(device, reason) {
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

function openPlayer(deviceName) {
  const playerPath = String(config.playerPath || '').trim()
  if (!playerPath) {
    log('open-player skipped: no playerPath configured', { deviceName }, 'warn')
    return { ok: false, error: '请先在设置里选择听歌程序' }
  }
  try {
    const child = spawn(playerPath, config.playerArgs || [], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    })
    child.unref()
    log('opened player', { path: playerPath, args: config.playerArgs, pid: child.pid, deviceName })
    return { ok: true, pid: child.pid, path: playerPath }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('open player failed', { path: playerPath, message }, 'error')
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
 * PowerShell body that writes a UTF-8 JSON array of connected BT audio PnP nodes
 * to $outFile. Shared by one-shot list and the event watcher.
 */
function psCollectConnectedScript(outFilePs) {
  return `
$ErrorActionPreference = 'Stop'
$outFile = '${outFilePs}'
$raw = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object {
  $id = [string]$_.InstanceId
  $name = [string]$_.FriendlyName
  $cls = [string]$_.Class
  $st = [string]$_.Status
  if ($st -eq 'Error') { return $false }
  if ($cls -eq 'MEDIA' -and ($id -match 'BTHENUM|BTHHFENUM')) { return $true }
  if ($cls -eq 'Bluetooth' -and $id -match 'BTHENUM\\\\DEV_' -and ($name -match '耳机|Headset|Buds|AirPods|Headphone|Ear')) { return $true }
  if ($cls -eq 'System' -and $id -match 'BTHENUM' -and ($name -match 'Hands-Free|耳机')) { return $true }
  if ($cls -eq 'Bluetooth' -and $id -match 'BTHENUM\\\\\\{0000110' -and ($name -match 'Avrcp|A2DP|耳机|Headset')) { return $true }
  return $false
})
$items = @()
foreach ($d in $raw) {
  $connected = $false
  try {
    $p = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_IsConnected' -ErrorAction SilentlyContinue
    if ($null -ne $p -and $null -ne $p.Data) {
      $connected = [bool]$p.Data
    }
  } catch {}
  if (-not $connected) { continue }
  $items += [pscustomobject]@{
    FriendlyName = $d.FriendlyName
    InstanceId = $d.InstanceId
    Class = $d.Class
    Status = $d.Status
    IsConnected = $true
  }
}
if ($items.Count -eq 0) {
  $json = '[]'
} else {
  $json = ($items | ConvertTo-Json -Compress -Depth 3)
}
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

function queueSnapshot(devices, reason, { seedOnly = false, immediate = false } = {}) {
  // Always seed the first successful snapshot so a failed startup seed
  // cannot turn the next event into a full toast flood.
  const effectiveSeed = seedOnly || !pnpSeeded
  if (effectiveSeed || immediate) {
    if (applyDebounceTimer) {
      clearTimeout(applyDebounceTimer)
      applyDebounceTimer = null
    }
    pendingSnapshot = null
    applySnapshot(devices, reason, { seedOnly: effectiveSeed })
    pnpSeeded = true
    lastWatchError = ''
    log('device snapshot applied', {
      reason,
      seedOnly: effectiveSeed,
      count: devices.length,
      names: devices.map((d) => d.name),
      mode: 'event',
    })
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
  }, 350)
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
 * Long-running PowerShell: subscribe to Win32_DeviceChangeEvent (arrival/removal),
 * debounce bursts, then dump connected BT audio JSON to a stable UTF-8 file and
 * print "SNAPSHOT" on stdout so Node can re-read without CP936 corruption.
 */
function buildWatcherScript(outFilePs) {
  const collect = psCollectConnectedScript(outFilePs)
  // After each emit, print a single ASCII marker line. Node re-reads $outFile as UTF-8.
  return `
$ErrorActionPreference = 'Continue'
$outFile = '${outFilePs}'

function Write-BtSnapshotMarker {
  try {
${collect
  .split('\n')
  .map((line) => `    ${line}`)
  .join('\n')}
    [Console]::Out.WriteLine('SNAPSHOT')
    [Console]::Out.Flush()
  } catch {
    [Console]::Error.WriteLine(('SNAPSHOT_ERROR ' + $_.Exception.Message))
  }
}

# Seed immediately so Node can mark pnpSeeded without waiting for a plug event.
Write-BtSnapshotMarker

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
      # Coalesce PnP storms (A2DP+HFP+services arrive together).
      $deadline = [datetime]::UtcNow.AddMilliseconds(700)
      while ([datetime]::UtcNow -lt $deadline) {
        try {
          $watcher.Options.Timeout = [System.TimeSpan]::FromMilliseconds(80)
          $null = $watcher.WaitForNextEvent()
        } catch {
          break
        }
      }
      $watcher.Options.Timeout = [System.TimeSpan]::FromSeconds(5)
      Write-BtSnapshotMarker
    } catch {
      # Timeout: idle keep-alive so the process stays responsive to kill.
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
    if (text !== 'SNAPSHOT') {
      // Ignore stray PS noise.
      return
    }
    try {
      const devices = parseEndpointFile(outFile)
      queueSnapshot(devices, 'device-change')
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
    watchEnabled: true,
    watchMode: isWindows ? 'device-change-event' : 'none',
    watcherPid: watcherChild?.pid || null,
    pnpSeeded,
    nameFilter: config.nameFilter,
    playerPath: config.playerPath,
    playerArgs: config.playerArgs,
    notifyDisconnect: config.notifyDisconnect,
    connectedAutoHideSec: config.connectedAutoHideSec,
    disconnectedAutoHideSec: config.disconnectedAutoHideSec,
    lastWatchError: lastWatchError || null,
    devices: [...known.values()],
  }
}

function applyHostConfig(input) {
  const prevFilter = config.nameFilter
  config = normalizeConfig(input)
  log('config applied', { config })
  // Name filter change should re-evaluate current set without waiting for plug.
  if (isWindows && prevFilter !== config.nameFilter && pnpSeeded) {
    snapshotOnce('filter-change', { immediate: true }).catch(() => {})
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
        const result = openPlayer(params.deviceName)
        respond(requestId, result.ok, result, result.error)
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
      openPlayer(deviceName)
    }
  }
})
