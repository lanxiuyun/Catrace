import { useCallback, useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  Card,
  Code,
  Flex,
  Switch,
  Table,
  Text,
  TextField,
} from '@radix-ui/themes'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import {
  getMediaDebugInfo,
  getRecentSignalMinutes,
  getSignalRuntimeConfig,
  getToastDebugMode,
  setToastDebugMode,
  startNotificationTest,
  stopNotificationTest,
  type MediaDebugInfo,
  type SignalMinuteRecord,
  type SignalRuntimeConfig,
} from '../../api/tauri'
import { useT } from '../i18n'
import { PageScroll } from '../components/PageScroll'
import { RadixPage } from '../components/RadixPage'
import { EventSdkCard } from './debug/EventSdkCard'
import './debug.css'

const POLL_INTERVAL_MS = 2000
const SIGNAL_MINUTE_LIMIT = 12

function formatMinuteTs(ts: number): string {
  // signal_minutes.timestamp = bucket_start + 60（分钟结束时间）
  const date = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function mouseSlotsFilled(json: string | null): string {
  if (!json) return '—'
  try {
    const slots = JSON.parse(json) as Array<number | null>
    if (!Array.isArray(slots)) return '—'
    const filled = slots.filter((value) => value !== null && value !== undefined).length
    return `${filled}/60`
  } catch {
    return '—'
  }
}

function formatDistance(px: number): string {
  if (!Number.isFinite(px)) return '—'
  if (px >= 1000) return `${(px / 1000).toFixed(1)}k`
  return String(Math.round(px))
}

/** 调试页（React 版，替代 views/mainWindow/Debug.vue）：媒体检测、Signal 分钟桶、通知测试、Event SDK。 */
export function Debug() {
  const t = useT()

  const [data, setData] = useState<MediaDebugInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [toastDebug, setToastDebug] = useState(false)
  const [testRunning, setTestRunning] = useState(false)
  const [testIntervalText, setTestIntervalText] = useState('15')
  const [signalMinutes, setSignalMinutes] = useState<SignalMinuteRecord[]>([])
  const [signalRuntime, setSignalRuntime] = useState<SignalRuntimeConfig | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [media, minutes, runtime] = await Promise.all([
        getMediaDebugInfo(),
        getRecentSignalMinutes(SIGNAL_MINUTE_LIMIT),
        getSignalRuntimeConfig(),
      ])
      setData(media)
      setSignalMinutes(minutes)
      setSignalRuntime(runtime)
      setErrorMsg(null)
    } catch (error) {
      console.error(error)
      setErrorMsg(error instanceof Error ? error.message : String(error))
    }
  }, [])

  // 与 Vue 版一致：进入页面后每 2 秒拉一次；离开页面停止轮询并停掉通知测试。
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null

    const loop = () => {
      void loadData().finally(() => {
        if (alive) timer = setTimeout(loop, POLL_INTERVAL_MS)
      })
    }
    loop()

    void (async () => {
      try {
        const next = await getToastDebugMode()
        if (alive) setToastDebug(next)
      } catch (error) {
        console.error(error)
      }
    })()

    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      void stopNotificationTest().catch(() => undefined)
    }
  }, [loadData])

  const refresh = async () => {
    setLoading(true)
    try {
      await loadData()
    } finally {
      setLoading(false)
    }
  }

  const toggleToastDebug = async (value: boolean) => {
    try {
      await setToastDebugMode(value)
      setToastDebug(value)
    } catch (error) {
      console.error(error)
    }
  }

  const intervalSeconds = Math.max(1, Math.round(Number(testIntervalText) || 1))

  const startTest = async () => {
    try {
      await startNotificationTest(intervalSeconds)
      setTestRunning(true)
    } catch (error) {
      console.error(error)
    }
  }

  const stopTest = async () => {
    try {
      await stopNotificationTest()
      setTestRunning(false)
    } catch (error) {
      console.error(error)
    }
  }

  const snapshot = signalRuntime?.snapshot ?? {}
  const pendingBuckets = Number(snapshot.pending_buckets ?? 0)
  const currentMinuteTs = Number(snapshot.minute_ts)
  const currentKeys = Number(snapshot.key_count ?? 0)
  const currentMouse = Number(snapshot.mouse_distance_px ?? 0)
  const estimatedActive =
    data !== null && (data.mouse_keyboard_count >= 3 || data.media_active)

  return (
    <PageScroll>
      <RadixPage className="ct-debug-page">
        <div className="ct-debug">
          <header className="ct-debug-header">
            <h1 className="ct-debug-title">{t('debug.title')}</h1>
            <div className="ct-debug-actions">
              <label className="ct-debug-switch">
                <Text size="1" color="gray">
                  {t('debug.toastDebugMode')}
                </Text>
                <Switch
                  size="1"
                  checked={toastDebug}
                  aria-label={t('debug.toastDebugMode')}
                  onCheckedChange={(value) => void toggleToastDebug(value)}
                />
              </label>
              <Button
                size="1"
                variant="soft"
                color="gray"
                disabled={loading}
                onClick={() => void refresh()}
              >
                <RefreshCw size={13} aria-hidden="true" />
                {t('debug.refresh')}
              </Button>
            </div>
          </header>

          {errorMsg && (
            <Callout.Root color="red" size="1">
              <Callout.Icon>
                <TriangleAlert size={16} aria-hidden="true" />
              </Callout.Icon>
              <Callout.Text>{errorMsg}</Callout.Text>
            </Callout.Root>
          )}

          <Card className="ct-debug-panel">
            <div className="ct-debug-panel-head">
              <h2>{t('debug.notificationTest.title')}</h2>
            </div>
            <Flex align="center" gap="4" wrap="wrap">
              <label className="ct-debug-inline">
                <Text size="1" color="gray">
                  {t('debug.notificationTest.interval')}
                </Text>
                <TextField.Root
                  className="ct-debug-number"
                  size="1"
                  type="number"
                  min={1}
                  value={testIntervalText}
                  disabled={testRunning}
                  aria-label={t('debug.notificationTest.interval')}
                  onChange={(event) => setTestIntervalText(event.target.value)}
                >
                  <TextField.Slot side="right">
                    {t('debug.notificationTest.seconds')}
                  </TextField.Slot>
                </TextField.Root>
              </label>
              {testRunning ? (
                <Button size="1" color="red" onClick={() => void stopTest()}>
                  {t('debug.notificationTest.stop')}
                </Button>
              ) : (
                <Button size="1" onClick={() => void startTest()}>
                  {t('debug.notificationTest.start')}
                </Button>
              )}
            </Flex>
          </Card>

          <EventSdkCard />

          <Card className="ct-debug-panel">
            <div className="ct-debug-panel-head">
              <h2>{t('debug.signal.title')}</h2>
            </div>

            {signalRuntime && (
              <dl className="ct-debug-facts">
                <div>
                  <dt>{t('debug.signal.keySeq')}</dt>
                  <dd>
                    <Badge size="1" color={signalRuntime.key_sequence_enabled ? 'orange' : 'gray'}>
                      {signalRuntime.key_sequence_enabled ? t('debug.yes') : t('debug.no')}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt>{t('debug.signal.retention')}</dt>
                  <dd>{signalRuntime.retention_hours}h</dd>
                </div>
                <div>
                  <dt>{t('debug.signal.pending')}</dt>
                  <dd>{pendingBuckets}</dd>
                </div>
                <div>
                  <dt>{t('debug.signal.curMinute')}</dt>
                  <dd>
                    {Number.isFinite(currentMinuteTs) && currentMinuteTs > 0
                      ? formatMinuteTs(currentMinuteTs + 60)
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>{t('debug.signal.curKeys')}</dt>
                  <dd>{currentKeys}</dd>
                </div>
                <div>
                  <dt>{t('debug.signal.curMouse')}</dt>
                  <dd>{formatDistance(currentMouse)} px</dd>
                </div>
              </dl>
            )}

            {signalMinutes.length > 0 ? (
              <Table.Root className="ct-debug-table" size="1" variant="ghost">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>{t('debug.signal.colTime')}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t('debug.signal.colApp')}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t('debug.signal.colFg')}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t('debug.signal.colKeys')}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t('debug.signal.colSeq')}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t('debug.signal.colMouse')}</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>{t('debug.signal.colSlots')}</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {signalMinutes.map((row) => (
                    <Table.Row key={row.timestamp}>
                      <Table.Cell className="ct-debug-mono">{formatMinuteTs(row.timestamp)}</Table.Cell>
                      <Table.Cell className="ct-debug-app">
                        {row.dominant_process_name || '—'}
                      </Table.Cell>
                      <Table.Cell>{row.foreground_sample_count}</Table.Cell>
                      <Table.Cell>{row.key_count}</Table.Cell>
                      <Table.Cell>
                        <Badge size="1" color={row.key_sequence_json ? 'orange' : 'gray'}>
                          {row.key_sequence_json ? t('debug.signal.seqOn') : t('debug.signal.seqOff')}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>{formatDistance(row.mouse_distance_px)}</Table.Cell>
                      <Table.Cell>{mouseSlotsFilled(row.mouse_seconds_json)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            ) : (
              <p className="ct-debug-empty">{t('debug.signal.empty')}</p>
            )}

            <Text size="1" color="gray" className="ct-debug-hint">
              {t('debug.signal.hint')}
            </Text>
          </Card>

          {data && (
            <>
              <Card className="ct-debug-panel">
                <div className="ct-debug-panel-head">
                  <h2>{t('debug.finalResult')}</h2>
                </div>
                <div className="ct-debug-results">
                  <div className="ct-debug-result">
                    <span className="ct-debug-result-label">{t('debug.mediaActive')}</span>
                    <Badge size="2" color={data.media_active ? 'green' : 'gray'}>
                      {data.media_active ? t('debug.mediaActiveTrue') : 'false'}
                    </Badge>
                  </div>
                  <div className="ct-debug-result">
                    <span className="ct-debug-result-label">{t('debug.mkCount')}</span>
                    <Badge size="2" color="gray">
                      {data.mouse_keyboard_count}
                    </Badge>
                  </div>
                  <div className="ct-debug-result">
                    <span className="ct-debug-result-label">{t('debug.estimatedStatus')}</span>
                    <Badge size="2" color={estimatedActive ? 'green' : 'gray'}>
                      {estimatedActive ? t('timeline.active') : t('timeline.rest')}
                    </Badge>
                  </div>
                </div>
              </Card>

              <Card className="ct-debug-panel">
                <div className="ct-debug-panel-head">
                  <h2>{t('debug.audioSessions')}</h2>
                </div>

                <dl className="ct-debug-facts">
                  <div>
                    <dt>{t('debug.available')}</dt>
                    <dd>
                      <Badge size="1" color={data.audio_error ? 'red' : 'green'}>
                        {data.audio_error ? t('debug.no') : t('debug.yes')}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('debug.sessionCount')}</dt>
                    <dd>{data.audio_sessions.length}</dd>
                  </div>
                  <div>
                    <dt>{t('debug.audioActive')}</dt>
                    <dd>
                      <Badge size="1" color={data.audio_active ? 'green' : 'gray'}>
                        {data.audio_active ? t('debug.yes') : t('debug.no')}
                      </Badge>
                    </dd>
                  </div>
                </dl>

                {data.audio_error && (
                  <Text size="1" color="red" as="p" className="ct-debug-error">
                    {t('debug.errorPrefix')}
                    {data.audio_error}
                  </Text>
                )}

                {data.audio_sessions.length > 0 ? (
                  <Table.Root className="ct-debug-table" size="1" variant="ghost">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>{t('debug.processName')}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>PID</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>{t('debug.peak')}</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>
                          {t('debug.whitelisted')}
                        </Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {data.audio_sessions.map((session) => (
                        <Table.Row key={`${session.pid}-${session.process_name}`}>
                          <Table.Cell>{session.process_name}</Table.Cell>
                          <Table.Cell className="ct-debug-mono">{session.pid}</Table.Cell>
                          <Table.Cell className="ct-debug-mono">
                            {session.peak.toFixed(4)}
                          </Table.Cell>
                          <Table.Cell>
                            <Badge size="1" color={session.whitelisted ? 'green' : 'gray'}>
                              {session.whitelisted ? t('debug.yes') : t('debug.no')}
                            </Badge>
                          </Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                ) : (
                  !data.audio_error && (
                    <p className="ct-debug-empty">{t('debug.noAudioSessions')}</p>
                  )
                )}
              </Card>

              <Card className="ct-debug-panel">
                <div className="ct-debug-panel-head">
                  <h2>{t('debug.focusWindow')}</h2>
                </div>
                <dl className="ct-debug-facts is-column">
                  <div>
                    <dt>{t('debug.windowTitle')}</dt>
                    <dd>{data.focus_window_title || '—'}</dd>
                  </div>
                  <div>
                    <dt>{t('debug.appName')}</dt>
                    <dd>{data.focus_app_name || '—'}</dd>
                  </div>
                  <div>
                    <dt>{t('debug.processPath')}</dt>
                    <dd>
                      <Code className="ct-debug-code">{data.focus_process_path || '—'}</Code>
                    </dd>
                  </div>
                </dl>
              </Card>
            </>
          )}
        </div>
      </RadixPage>
    </PageScroll>
  )
}
