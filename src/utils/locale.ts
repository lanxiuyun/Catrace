export type SupportedLocale = 'zh-CN' | 'en-US'

export function detectDefaultLocale(): SupportedLocale {
  const lang = navigator.language || 'zh-CN'
  if (lang.startsWith('en')) return 'en-US'
  return 'zh-CN'
}
