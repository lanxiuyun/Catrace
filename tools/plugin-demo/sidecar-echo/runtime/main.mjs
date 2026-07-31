import { spawn } from 'node:child_process'
import readline from 'node:readline'

const pluginId = process.env.CATRACE_PLUGIN_ID || 'unknown'
let sequence = 0
let intervalMs = 15_000
let timer

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const log = (message, data) => send({ v: 1, op: 'log', level: 'info', message, data })

function publish(reason = 'timer') {
  sequence += 1
  send({
    v: 1,
    op: 'publish',
    event: {
      eventType: 'sidecar-echo.tick',
      kind: 'sidecar-echo',
      title: `Sidecar #${sequence}`,
      body: `本机进程已通过 stdout JSONL 发布事件（${reason}）`,
      level: 'success',
      sticky: true,
      actions: [
        { id: 'echo', label: '回传 Sidecar' },
        { id: 'dismiss', label: '完成' }
      ],
      payload: {
        sequence,
        pid: process.pid,
        pluginId,
        reason,
        publishedAt: new Date().toISOString()
      },
      dedupeKey: 'sidecar-echo:tick'
    }
  })
}

function schedule() {
  clearInterval(timer)
  timer = setInterval(() => publish('timer'), intervalMs)
  timer.unref()
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      const error = new Error(stderr.trim() || `${command} exited with code ${code}`)
      error.exitCode = code
      reject(error)
    })
  })
}

async function pickWithPowerShell(kind) {
  const body = kind === 'folder'
    ? `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }`
    : `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.FileName) }`
  const encoded = Buffer.from(body, 'utf16le').toString('base64')
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded])
}

async function pickWithOsascript(kind) {
  const script = kind === 'folder'
    ? 'POSIX path of (choose folder)'
    : 'POSIX path of (choose file)'
  try {
    return await run('osascript', ['-e', script])
  } catch (error) {
    if (String(error.message).includes('User canceled')) return ''
    throw error
  }
}

async function pickWithLinuxDialog(kind) {
  const zenityArgs = kind === 'folder'
    ? ['--file-selection', '--directory']
    : ['--file-selection']
  try {
    return await run('zenity', zenityArgs)
  } catch (zenityError) {
    if (zenityError.exitCode === 1) return ''
    const kdialogArgs = kind === 'folder' ? ['--getexistingdirectory'] : ['--getopenfilename']
    try {
      return await run('kdialog', kdialogArgs)
    } catch (kdialogError) {
      if (kdialogError.exitCode === 1) return ''
      throw new Error(`No supported file dialog found (zenity/kdialog): ${zenityError.message}`)
    }
  }
}

function pickPath(kind) {
  if (process.platform === 'win32') return pickWithPowerShell(kind)
  if (process.platform === 'darwin') return pickWithOsascript(kind)
  return pickWithLinuxDialog(kind)
}

async function request(method, params = {}) {
  if (method === 'environment.get') return { ...process.env }
  if (method === 'dialog.pickFile') return pickPath('file')
  if (method === 'dialog.pickFolder') return pickPath('folder')
  if (method === 'process.spawn') {
    const path = String(params.path || '').trim()
    if (!path) throw new Error('program path cannot be empty')
    const args = Array.isArray(params.args) ? params.args.map(String) : []
    const child = spawn(path, args, { detached: true, stdio: 'ignore', windowsHide: false })
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.unref()
    return { pid: child.pid }
  }
  if (method === 'http.get') {
    const url = String(params.url || '').trim()
    if (!url) throw new Error('URL cannot be empty')
    const response = await fetch(url)
    return {
      status: response.status,
      url: response.url,
      contentType: response.headers.get('content-type'),
      body: await response.text()
    }
  }
  throw new Error(`unknown sidecar method: ${method}`)
}

async function handleRequest(message) {
  const requestId = String(message.requestId || '')
  if (!requestId) return
  try {
    const result = await request(String(message.method || ''), message.params)
    send({ v: 1, op: 'response', requestId, ok: true, result })
  } catch (error) {
    send({
      v: 1,
      op: 'response',
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

send({ v: 1, op: 'ready' })
log('sidecar demo ready', { pluginId, pid: process.pid, protocol: process.env.CATRACE_PROTOCOL_VERSION })
publish('startup')
schedule()

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.op === 'shutdown') {
    log('graceful shutdown', { sequence })
    process.exit(0)
  }

  if (message.op === 'request') {
    void handleRequest(message)
    return
  }

  if (message.op === 'resolved') {
    log('toast resolved by host', {
      eventId: message.eventId,
      actionId: message.actionId,
      resolutionKind: message.resolutionKind
    })
    if (message.actionId === 'echo') {
      setTimeout(() => {
        log('echo roundtrip publish', { eventId: message.eventId, actionId: message.actionId })
        publish('action-roundtrip')
      }, 400)
    }
  }
})
