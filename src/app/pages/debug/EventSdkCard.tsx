import { useEffect, useState } from 'react'
import { Button, Card, Code, Switch, TextField } from '@radix-ui/themes'
import {
  getEventSdkStatus,
  rotateEventSdkToken,
  setEventSdkEnabled,
} from '../../../api/tauri'
import { useT } from '../../i18n'
import { showToast } from '../../ui/toast'

/**
 * Event SDK（本机 HTTP 事件接口）卡片，原 components/settings/EventSdkSettingsCard.vue 的 React 版。
 * 现在只挂在调试页里，所以样式跟随调试面板走。
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
      showToast(t('settings.messages.saved'))
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
    <Card className="ct-debug-panel">
      <div className="ct-debug-panel-head">
        <h2>{t('settings.groups.eventSdk')}</h2>
      </div>

      <div className="ct-debug-setting">
        <div className="ct-debug-setting-copy">
          <strong>{t('settings.eventSdk.enableTitle')}</strong>
          <span>{t('settings.eventSdk.enableDesc')}</span>
        </div>
        <Switch
          checked={enabled}
          disabled={loading || !ready}
          aria-label={t('settings.eventSdk.enableTitle')}
          onCheckedChange={(value) => void toggleEnabled(value)}
        />
      </div>

      <div className="ct-debug-setting">
        <div className="ct-debug-setting-copy">
          <strong>{t('settings.eventSdk.endpointTitle')}</strong>
          <span>{t('settings.eventSdk.endpointDesc')}</span>
        </div>
        <Code className="ct-debug-code">{baseUrl}/v1</Code>
      </div>

      <div className="ct-debug-setting is-top">
        <div className="ct-debug-setting-copy">
          <strong>{t('settings.eventSdk.tokenTitle')}</strong>
          <span>{t('settings.eventSdk.tokenDesc')}</span>
        </div>
        <div className="ct-debug-token">
          <TextField.Root
            className="ct-debug-token-input"
            size="1"
            readOnly
            value={showToken ? token : maskedToken}
            aria-label={t('settings.eventSdk.tokenTitle')}
          />
          <Button
            size="1"
            variant="soft"
            color="gray"
            onClick={() => setShowToken((value) => !value)}
          >
            {showToken ? t('settings.eventSdk.hide') : t('settings.eventSdk.show')}
          </Button>
          <Button size="1" onClick={() => void copyToken()}>
            {t('settings.eventSdk.copy')}
          </Button>
          <Button size="1" variant="soft" color="gray" disabled={loading} onClick={rotateToken}>
            {t('settings.eventSdk.rotate')}
          </Button>
        </div>
      </div>
    </Card>
  )
}
