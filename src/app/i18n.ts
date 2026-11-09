import { useCallback } from 'react'
import { emit, listen } from '@tauri-apps/api/event'
import { getLocale, setLocale } from '../api/tauri'
import { detectDefaultLocale } from '../utils/locale'
import zhCN from '../i18n/locales/zh-CN'
import enUS from '../i18n/locales/en-US'
import { useShellStore, type LocaleKey } from './store'

export type { LocaleKey } from './store'
export type TranslationParams = Record<string, string | number>
export const LOCALE_CHANGED_EVENT = 'catrace-locale-changed'

type MessageTree = { [key: string]: string | MessageTree }
const messages: Record<LocaleKey, MessageTree> = { 'zh-CN': zhCN, 'en-US': enUS }
let initPromise: Promise<void> | null = null
let localeRevision = 0

export const isLocaleKey = (value: unknown): value is LocaleKey =>
  value === 'zh-CN' || value === 'en-US'

function lookup(tree: MessageTree, key: string): string | undefined {
  let node: string | MessageTree | undefined = tree
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

/** Framework-independent translation lookup, including Chinese fallback and interpolation. */
export function translate(locale: LocaleKey, key: string, params?: TranslationParams): string {
  const text = lookup(messages[locale], key) ?? lookup(messages['zh-CN'], key) ?? key
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

function applyLocale(locale: LocaleKey): void {
  useShellStore.getState().setLocale(locale)
  document.documentElement.lang = locale
}

/** Persist first, then synchronize every WebView; Rust set_locale itself does not broadcast. */
export async function setAppLocale(locale: LocaleKey): Promise<void> {
  if (!isLocaleKey(locale)) return
  await setLocale(locale)
  localeRevision++
  applyLocale(locale)
  try {
    await emit(LOCALE_CHANGED_EVENT, { locale })
  } catch (error) {
    console.error('广播语言变更失败', error)
  }
}

export function initLocale(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      await listen<{ locale: LocaleKey }>(LOCALE_CHANGED_EVENT, (event) => {
        if (!isLocaleKey(event.payload?.locale)) return
        localeRevision++
        applyLocale(event.payload.locale)
      })
    } catch (error) {
      console.error('监听语言变更失败', error)
    }
    const revision = localeRevision
    const stored = await getLocale().catch(() => null)
    if (revision !== localeRevision) return
    const locale = isLocaleKey(stored) ? stored : detectDefaultLocale()
    applyLocale(locale)
    if (!isLocaleKey(stored)) await setAppLocale(locale).catch(() => {})
  })()
  return initPromise
}

/** React consumers rerender when the shared locale changes. */
export function useT(): (key: string, params?: TranslationParams) => string {
  const locale = useShellStore((state) => state.locale)
  return useCallback(
    (key: string, params?: TranslationParams) => translate(locale, key, params),
    [locale],
  )
}
