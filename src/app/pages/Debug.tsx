import { useCallback, useEffect, useState } from 'react'
import { Alert, Switch } from '@heroui/react'
import { TriangleAlert } from 'lucide-react'
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
import { SpecialDayPreview } from './debug/SpecialDayPreview'
import { StatusOverview } from './debug/StatusOverview'
import './debug.css'

const POLL_INTERVAL_MS = 2000
const SIGNAL_MINUTE_LIMIT = 12

/**
 * 调试页（React 版）。
 *
 * 阅读顺序：实时状态（一行四格）→ Signal 分钟桶（主数据表）→ 音频会话 → Event SDK。
 *
 * 不设页头：调试图里没有值得占一条工具条的操作。唯一的页面级开关「Toast 调试背景」
 * 挂在实时状态面板的标题右侧；刷新信息（每 2 秒自动）写在 Signal 面板的说明里。
 * 页面不显示页名（侧栏已高亮「调试」），h1 只留给读屏。
 */
export function Debug() {
  const t = useT()

  const [data, setData] = useState<MediaDebugInfo | null>(null)
  const [signalMinutes, setSignalMinutes] = useState<SignalMinuteRecord[]>([])
  const [signalRuntime, setSignalRuntime] = useState<SignalRuntimeConfig | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
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

  const toggleToastDebug = async (value: boolean) => {
    try {
      await setToastDebugMode(value)
      setToastDebug(value)
    } catch (error) {
      console.error(error)
    }
  }

  // 页面级唯一的开关：挂在实时状态面板标题右侧，不再单独占一条页头
  const toastDebugToggle = (
    <div className="ct-debug-toggle">
      <Switch
        size="sm"
        isSelected={toastDebug}
        onChange={(value) => void toggleToastDebug(value)}
      >
        <Switch.Content>
          {t('debug.toastDebugMode')}
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch.Content>
      </Switch>
    </div>
  )

  return (
    <PageScroll>
      <RadixPage className="ct-debug-page">
        <div className="ct-debug">
          <h1 className="ct-visually-hidden">{t('debug.title')}</h1>

          {errorMsg && (
            <Alert status="danger">
              <Alert.Indicator>
                <TriangleAlert size={16} aria-hidden="true" />
              </Alert.Indicator>
              <Alert.Content>
                <Alert.Description>{errorMsg}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}

          <StatusOverview data={data} runtime={signalRuntime} action={toastDebugToggle} />

          <SignalPanel minutes={signalMinutes} runtime={signalRuntime} />

          <AudioPanel data={data} />

          <EventSdkCard />

          {import.meta.env.DEV && <SpecialDayPreview />}
        </div>
      </RadixPage>
    </PageScroll>
  )
}
