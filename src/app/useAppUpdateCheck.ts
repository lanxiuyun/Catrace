import { useEffect } from 'react'
import { checkAppUpdate, getUpdateSource } from '../api/tauri'
import { useAppUpdateStore } from '../stores/appUpdate'

/** 启动后等主窗渲染稳定再检查，避免和首屏抢网络。 */
const AUTO_CHECK_DELAY_MS = 3000

/**
 * 主窗启动后自动检查一次更新。
 * 发现新版本只写进 store（侧栏「设置」红点 + 设置页版本行），不再弹右下角更新 Toast；
 * 检查失败只记日志，不打扰用户。
 */
export function useAppUpdateCheck() {
  const setNotice = useAppUpdateStore((state) => state.setNotice)

  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const source = await getUpdateSource()
          const update = await checkAppUpdate({ timeout: 10_000, source })
          if (!alive) return
          setNotice(update ? { version: update.version, body: update.body ?? '' } : null)
        } catch (error) {
          console.warn('[update] auto check failed', error)
        }
      })()
    }, AUTO_CHECK_DELAY_MS)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [setNotice])
}
