import { useEffect, useState } from 'react'
import { Button, Input, Switch } from '@heroui/react'
import {
  getEventSdkStatus,
  rotateEventSdkToken,
  setEventSdkEnabled,
} from '../../../api/tauri'
import { useT } from '../../i18n'
import { showToast } from '../../ui/toast'
import { DebugPanel } from './DebugPanel'

/**
 * Event SDK（本机 HTTP 事件接口）面板。
 *
 * 结构就是一张设置卡：启用开关、地址、令牌。挂在调试页里，所以外壳跟调试面板一致，
 * 行则沿用设置页的行语言（左文案右控件、相邻行 hairline），两边的行看起来是同一套东西。
 */
export function EventSdkCard() {
  const t = useT()
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:23457')
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const status = await getEventSdkStatus()
        if (!alive) return
        setEnabled(status.enabled)
        setBaseUrl(status.base_url)
        setToken(status.token)
      } catch (error) {
        console.error('Failed to load event sdk status', error)
      } finally {
        if (alive) setReady(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const toggleEnabled = async (value: boolean) => {
    setLoading(true)
    try {
      await setEventSdkEnabled(value)
      setEnabled(value)
    } catch {
      showToast(t('settings.messages.saveFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(token)
      showToast(t('settings.eventSdk.copied'))
    } catch {
      showToast(t('settings.messages.saveFailed'), 'error')
    }
  }

  const rotateToken = () => {
    const confirmed = window.confirm(
      `${t('settings.eventSdk.rotateTitle')}\n\n${t('settings.eventSdk.rotateBody')}`,
    )
    if (!confirmed) return
    setLoading(true)
    void (async () => {
      try {
        const next = await rotateEventSdkToken()
        setToken(next)
        showToast(t('settings.eventSdk.rotated'))
      } catch {
        showToast(t('settings.messages.saveFailed'), 'error')
      } finally {
        setLoading(false)
      }
    })()
  }

  const maskedToken = '\u2022'.repeat(Math.min(28, token.length || 28))

  return (
    <DebugPanel title={t('settings.groups.eventSdk')}>
      <div className="ct-debug-row">
        <div className="ct-debug-row-copy">
          <span className="ct-debug-row-title">{t('settings.eventSdk.enableTitle')}</span>
          <span className="ct-debug-row-desc">{t('settings.eventSdk.enableDesc')}</span>
        </div>
        <div className="ct-debug-row-control">
          <Switch
            isSelected={enabled}
            isDisabled={loading || !ready}
            aria-label={t('settings.eventSdk.enableTitle')}
            onChange={(value) => void toggleEnabled(value)}
          >
            <Switch.Content>
              <Switch.Control><Switch.Thumb /></Switch.Control>
            </Switch.Content>
          </Switch>
        </div>
      </div>

      <div className="ct-debug-row">
        <div className="ct-debug-row-copy">
          <span className="ct-debug-row-title">{t('settings.eventSdk.endpointTitle')}</span>
          <span className="ct-debug-row-desc">{t('settings.eventSdk.endpointDesc')}</span>
        </div>
        <div className="ct-debug-row-control">
          <code className="ct-debug-code">{baseUrl}/v1</code>
        </div>
      </div>

      <div className="ct-debug-row is-stack">
        <div className="ct-debug-row-copy">
          <span className="ct-debug-row-title">{t('settings.eventSdk.tokenTitle')}</span>
          <span className="ct-debug-row-desc">{t('settings.eventSdk.tokenDesc')}</span>
        </div>
        <div className="ct-debug-row-control">
          <Input
            className="ct-debug-token-input"
            variant="secondary"
            fullWidth
            readOnly
            value={showToken ? token : maskedToken}
            aria-label={t('settings.eventSdk.tokenTitle')}
          />
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => setShowToken((value) => !value)}
          >
            {showToken ? t('settings.eventSdk.hide') : t('settings.eventSdk.show')}
          </Button>
          <Button size="sm" onClick={() => void copyToken()}>
            {t('settings.eventSdk.copy')}
          </Button>
          <Button size="sm" variant="tertiary" isDisabled={loading} onClick={rotateToken}>
            {t('settings.eventSdk.rotate')}
          </Button>
        </div>
      </div>
    </DebugPanel>
  )
}
