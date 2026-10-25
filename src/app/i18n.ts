import { useCallback } from 'react'
import zhCN from '../i18n/locales/zh-CN'
import enUS from '../i18n/locales/en-US'
import { useShellStore, type LocaleKey } from './store'

/**
 * React 侧的 i18n：直接复用 vue-i18n 的词条对象（纯 TS 对象，无框架依赖），
 * 语言切换仍由宿主（设置页 / 持久化）驱动，经 store 镜像过来。
 * M6 清场时再决定是否换成 react-i18next，当前先避免多一层运行时。
 */
type MessageTree = { [key: string]: string | MessageTree }

const messages: Record<LocaleKey, MessageTree> = {
  'zh-CN': zhCN as MessageTree,
  'en-US': enUS as MessageTree,
}

function lookup(tree: MessageTree, key: string): string | undefined {
  let node: string | MessageTree | undefined = tree
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  )
}

export function translate(
  locale: LocaleKey,
  key: string,
  params?: Record<string, string | number>,
): string {
  const text = lookup(messages[locale], key) ?? lookup(messages['zh-CN'], key) ?? key
  return interpolate(text, params)
}

/** 组件内使用：locale 变化会触发重渲染。 */
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const locale = useShellStore((state) => state.locale)
  return useCallback(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  )
}
