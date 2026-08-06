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
