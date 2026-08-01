import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'bt-music'
const isWindows = process.platform === 'win32'

const DEFAULT_CONFIG = {
  // Off by default — avoid toast spam from local endpoints until user opts in.
  watchEnabled: false,
  nameFilter: '',
  playerPath: isWindows ? 'notepad.exe' : '',
  playerArgs: [],
  pollIntervalMs: 4000,
  notifyDisconnect: true,
}

/** @type {typeof DEFAULT_CONFIG} */
let config = { ...DEFAULT_CONFIG }

/** @type {Map<string, { id: string, name: string, source: string, groupKey: string }>} */
const known = new Map()
let pollTimer = null
let lastPollError = ''
/** First successful PnP snapshot only seeds; later deltas may publish. */
let pnpSeeded = false

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = (message, data, level = 'info') =>
  send({ v: 1, op: 'log', level, message, data })

function respond(requestId, ok, result, error) {
  const message = { v: 1, op: 'response', requestId, ok }
  if (ok) message.result = result ?? null
  else message.error = error || 'request failed'
  send(message)
}

function normalizeConfig(input = {}) {
  const next = { ...config }
  if (typeof input.watchEnabled === 'boolean') next.watchEnabled = input.watchEnabled
  if (typeof input.nameFilter === 'string') next.nameFilter = input.nameFilter.trim()
  if (typeof input.playerPath === 'string') next.playerPath = input.playerPath.trim()
  if (Array.isArray(input.playerArgs)) {
    next.playerArgs = input.playerArgs.map((v) => String(v))
  } else if (typeof input.playerArgs === 'string') {
    next.playerArgs = splitArgs(input.playerArgs)
  }
  if (typeof input.pollIntervalMs === 'number' && Number.isFinite(input.pollIntervalMs)) {
    next.pollIntervalMs = Math.min(60_000, Math.max(1500, Math.round(input.pollIntervalMs)))
  }
  if (typeof input.notifyDisconnect === 'boolean') {
    next.notifyDisconnect = input.notifyDisconnect
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
  const filter = config.nameFilter.trim().toLowerCase()
  if (!filter) return true
  return String(name || '')
    .toLowerCase()
    .includes(filter)
}

function publishConnected(device, reason) {
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'bt-music.connected',
      kind: 'bt-music',
      title: '耳机已连接',
      body: device.name || '蓝牙音频设备',
      level: 'success',
      sticky: true,
      actions: [
        { id: 'open-player', label: '打开听歌' },
        { id: 'dismiss', label: '知道了' },
      ],
      payload: {
        deviceId: device.id,
        deviceName: device.name,
        source: device.source,
        reason,
        pluginId,
        publishedAt: new Date().toISOString(),
      },
      dedupeKey: `bt-music:connected:${device.id}`,
    },
  })
}

function publishDisconnected(device, reason) {
  if (!config.notifyDisconnect) return
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'bt-music.disconnected',
      kind: 'bt-music',
      title: '耳机已断开',
      body: device.name || '蓝牙音频设备',
      level: 'info',
      sticky: false,
      actions: [{ id: 'dismiss', label: '关闭' }],
      payload: {
        deviceId: device.id,
        deviceName: device.name,
        source: device.source,
        reason,
        pluginId,
        publishedAt: new Date().toISOString(),
        auto_hide_ms: 5000,
      },
      dedupeKey: `bt-music:disconnected:${device.id}`,
    },
  })
}

function openPlayer(deviceName) {
  const path = config.playerPath || (isWindows ? 'notepad.exe' : '')
  if (!path) {
    log('open-player skipped: no playerPath configured', { deviceName }, 'warn')
    return { ok: false, error: 'playerPath empty' }
  }
  try {
    const child = spawn(path, config.playerArgs || [], {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    })
    child.unref()
    log('opened player', { path, args: config.playerArgs, pid: child.pid, deviceName })
    return { ok: true, pid: child.pid, path }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('open player failed', { path, message }, 'error')
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

async function listWindowsAudioEndpoints() {
  // Write JSON to a UTF-8 file — console stdout on Chinese Windows is often CP936.
  // Paired headsets keep PnP Status=OK forever; only DEVPKEY_Device_IsConnected
  // flips True while the radio link is up. Require isConnected=true.
  const outFile = path.join(os.tmpdir(), `catrace-bt-music-endpoints-${process.pid}.json`)
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
  try {
    await runPowerShell(script)
    if (!fs.existsSync(outFile)) return []
    const raw = fs.readFileSync(outFile, 'utf8').trim()
    if (!raw) return []
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      lastPollError = `json parse failed: ${error instanceof Error ? error.message : String(error)}`
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
      [...known.values()].some((d) => d.source !== 'mock' && (d.groupKey || deviceGroupKey(d.name)) === groupKey)
    if (already) {
      // Refresh stored record id/name if same group reappeared under new endpoint id.
      for (const [id, prev] of [...known.entries()]) {
        if (prev.source === 'mock') continue
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
    if (device.source === 'mock') continue
    const groupKey = device.groupKey || deviceGroupKey(device.name)
    if (nextGroupKeys.has(groupKey)) continue
    known.delete(id)
    publishDisconnected(device, reason)
  }
}

async function pollOnce(reason = 'poll', options = {}) {
  if (!isWindows) {
    lastPollError = 'watch only implemented on Windows; use simulate in settings'
    return
  }
  if (!config.watchEnabled) return
  try {
    const devices = await listWindowsAudioEndpoints()
    lastPollError = ''
    // Always seed the first successful snapshot so a failed startup seed
    // cannot turn the next poll into a full toast flood.
    const seedOnly = options.seedOnly === true || !pnpSeeded
    applySnapshot(devices, reason, { seedOnly })
    pnpSeeded = true
    log('device poll ok', {
      reason,
      seedOnly,
      count: devices.length,
      names: devices.map((d) => d.name),
    })
  } catch (error) {
    lastPollError = error instanceof Error ? error.message : String(error)
    log('device poll failed', { error: lastPollError }, 'warn')
  }
}

function schedulePoll() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (!isWindows || !config.watchEnabled) return
  pollTimer = setInterval(() => {
    pollOnce('poll').catch(() => {})
  }, config.pollIntervalMs)
  pollTimer.unref?.()
}

function statusPayload() {
  return {
    pluginId,
    platform: process.platform,
    pid: process.pid,
    watchSupported: isWindows,
    watchEnabled: config.watchEnabled,
    pnpSeeded,
    pollIntervalMs: config.pollIntervalMs,
    nameFilter: config.nameFilter,
    playerPath: config.playerPath,
    playerArgs: config.playerArgs,
    notifyDisconnect: config.notifyDisconnect,
    lastPollError: lastPollError || null,
    devices: [...known.values()],
  }
}

function simulateConnect(params = {}) {
  const name = String(params.deviceName || params.name || 'WH-1000XM5 (模拟)').trim()
  const id = String(params.deviceId || params.id || `mock:${name.toLowerCase()}`).trim()
  const device = { id, name, source: 'mock', groupKey: deviceGroupKey(name) }
  known.set(id, device)
  publishConnected(device, 'simulate')
  return device
}

function simulateDisconnect(params = {}) {
  const idHint = params.deviceId || params.id
  const nameHint = params.deviceName || params.name
  let device = null
  if (idHint && known.has(String(idHint))) {
    device = known.get(String(idHint))
  } else if (nameHint) {
    device = [...known.values()].find((d) => d.name === nameHint) || null
  } else {
    device =
      [...known.values()].reverse().find((d) => d.source === 'mock') ||
      [...known.values()].at(-1) ||
      null
  }
  if (!device) return null
  known.delete(device.id)
  publishDisconnected(device, 'simulate')
  return device
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
        const wasEnabled = config.watchEnabled
        config = normalizeConfig(params)
        if (!config.watchEnabled) {
          // Drop PnP-known devices on disable so next enable re-seeds cleanly.
          for (const [id, device] of [...known.entries()]) {
            if (device.source !== 'mock') known.delete(id)
          }
          pnpSeeded = false
        }
        schedulePoll()
        log('config updated', { config })
        respond(requestId, true, statusPayload())
        if (config.watchEnabled && isWindows && (!wasEnabled || !pnpSeeded)) {
          pnpSeeded = false
          pollOnce('watch-enabled', { seedOnly: true }).catch(() => {})
        }
        break
      }
      case 'simulateConnect': {
        const device = simulateConnect(params)
        respond(requestId, true, { device, status: statusPayload() })
        break
      }
      case 'simulateDisconnect': {
        const device = simulateDisconnect(params)
        respond(requestId, true, { device, status: statusPayload() })
        break
      }
      case 'refresh': {
        pollOnce('manual-refresh')
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

send({ v: 1, op: 'ready' })
log('bt-music sidecar ready', {
  pluginId,
  pid: process.pid,
  platform: process.platform,
  protocol: process.env.CATRACE_PROTOCOL_VERSION,
})

schedulePoll()
if (isWindows && config.watchEnabled) {
  // Seed current endpoints without toast spam; only later deltas notify.
  setTimeout(() => {
    pollOnce('startup', { seedOnly: true }).catch(() => {})
  }, 800)
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.op === 'shutdown') {
    log('graceful shutdown', { devices: known.size })
    process.exit(0)
  }

  if (message.op === 'config' && message.config && typeof message.config === 'object') {
    const wasEnabled = config.watchEnabled
    config = normalizeConfig(message.config)
    if (!config.watchEnabled) {
      for (const [id, device] of [...known.entries()]) {
        if (device.source !== 'mock') known.delete(id)
      }
      pnpSeeded = false
    }
    schedulePoll()
    log('host config applied', { config })
    if (config.watchEnabled && isWindows && (!wasEnabled || !pnpSeeded)) {
      pnpSeeded = false
      pollOnce('host-config', { seedOnly: true }).catch(() => {})
    }
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
        message.payload?.deviceName ||
        message.event?.payload?.deviceName ||
        undefined
      openPlayer(deviceName)
    }
  }
})
