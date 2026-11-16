import type { ReactNode } from 'react'

/**
 * 设置卡外壳：组名 + 内容。卡片外观在 settings.css 的 `.ct-settings-card` 里。
 * 组名就是这张卡的标题（h2），不要图标——设置页要的是安静，不是装饰。
 */
export function SettingsCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ct-settings-card">
      <h2 className="ct-settings-card-label">{label}</h2>
      {children}
    </div>
  )
}
