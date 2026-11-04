import { useCallback, useEffect, useState } from 'react'
import { Button, Callout, Switch } from '@radix-ui/themes'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import {
  getMediaDebugInfo,
  getRecentSignalMinutes,
  getSignalRuntimeConfig,
  getToastDebugMode,
  setToastDebugMode,
  type MediaDebugInfo,
  type SignalMinuteRecord,
  type SignalRuntimeConfig,
} from '../../api/tauri'
import { useT } from '../i18n'
import { PageScroll } from '../components/PageScroll'
import { RadixPage } from '../components/RadixPage'
import { AudioPanel } from './debug/AudioPanel'
import { EventSdkCard } from './debug/EventSdkCard'
import { SignalPanel } from './debug/SignalPanel'
import { StatusOverview } from './debug/StatusOverview'
import { formatClock } from './debug/format'
import './debug.css'

const POLL_INTERVAL_MS = 2000
const SIGNAL_MINUTE_LIMIT = 12

/**
 * 调试页（React 版）。
 *
 * 阅读顺序：实时状态（一行四格）→ Signal 分钟桶（主数据表）→ 音频会话 + Event SDK。
 *
 * 顶部工具条是粘性的半透明材质：滚到表格中间也能刷新、也能开关 Toast 调试背景。
 * 页面不显示页名（侧栏已高亮「调试」），h1 只留给读屏。
 */
export function Debug() {
  const t = useT()

  const [data, setData] = useState<MediaDebugInfo | null>(null)
  const [signalMinutes, setSignalMinutes] = useState<SignalMinuteRecord[]>([])
  const [signalRuntime, setSignalRuntime] = useState<SignalRuntimeConfig | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [manualLoading, setManualLoading] = useState(false)
  const [toastDebug, setToastDebug] = useState(false)

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
      setUpdatedAt(formatClock())
      setErrorMsg(null)
    } catch (error) {
      console.error(error)
      setErrorMsg(error instanceof Error ? error.message : String(error))
    }
  }, [])

  // 进入页面后每 2 秒拉一次；离开页面停止轮询并停掉通知测试。
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
    }
  }, [loadData])

  const refresh = async () => {
    setManualLoading(true)
    try {
      await loadData()
    } finally {
      setManualLoading(false)
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

  return (
    <PageScroll>
      <RadixPage className="ct-debug-page">
        <div className="ct-debug-toolbar">
          <div className="ct-debug-toolbar-inner">
            <div className="ct-debug-live">
              {errorMsg ? (
                <span className="ct-debug-live-error">{t('debug.fetchFailed')}</span>
              ) : (
                <span className="ct-debug-live-time">
                  {updatedAt ? t('debug.updatedAt', { time: updatedAt }) : '—'}
                </span>
              )}
              <span className="ct-debug-live-cadence">{t('debug.autoRefresh')}</span>
            </div>

            <div className="ct-debug-actions">
              <div className="ct-debug-toggle">
                <span className="ct-debug-toggle-label">{t('debug.toastDebugMode')}</span>
                <Switch
                  size="1"
                  checked={toastDebug}
                  aria-label={t('debug.toastDebugMode')}
                  onCheckedChange={(value) => void toggleToastDebug(value)}
                />
              </div>
              <Button
                size="1"
                variant="soft"
                color="gray"
                disabled={manualLoading}
                aria-busy={manualLoading}
                onClick={() => void refresh()}
              >
                <RefreshCw
                  size={13}
                  className={manualLoading ? 'ct-debug-spin' : undefined}
                  aria-hidden="true"
                />
                {t('debug.refresh')}
              </Button>
            </div>
          </div>
        </div>

        <div className="ct-debug">
          <h1 className="ct-visually-hidden">{t('debug.title')}</h1>

          {errorMsg && (
            <Callout.Root color="red" size="1">
              <Callout.Icon>
                <TriangleAlert size={16} aria-hidden="true" />
              </Callout.Icon>
              <Callout.Text>{errorMsg}</Callout.Text>
            </Callout.Root>
          )}

          <StatusOverview data={data} runtime={signalRuntime} />

          <SignalPanel minutes={signalMinutes} runtime={signalRuntime} />

          <AudioPanel data={data} />

          <EventSdkCard />
        </div>
      </RadixPage>
    </PageScroll>
  )
}
