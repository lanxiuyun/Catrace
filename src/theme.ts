import type { GlobalThemeOverrides } from 'naive-ui'

/**
 * Catrace 统一色板 — macOS 风格（参考根目录 catrace_macos_edition.html）：
 * 系统蓝 #007AFF / 系统紫 #5E5CE6 / 系统绿 #34C759 / 系统橙 #FF9500，
 * 背景 #F6F6F6、卡片白、苹果微边框。变量名沿用历史的 violet* 前缀。
 */
export const colors = {
  violet900: '#0055B3',
  violet700: '#0066D6',
  violet600: '#007AFF',
  violet500: '#3395FF',
  violet400: '#5E5CE6',
  violet200: 'rgba(0, 122, 255, 0.25)',
  violet100: 'rgba(0, 122, 255, 0.10)',
  violet50: 'rgba(0, 122, 255, 0.05)',
  bg: '#F6F6F6',
  surface: '#FFFFFF',
  teal600: '#248A3D',
  teal500: '#34C759',
  teal400: '#30D158',
  teal50: 'rgba(52, 199, 89, 0.12)',
  amber500: '#FF9500',
  amber50: 'rgba(255, 149, 0, 0.14)',
  text: '#1C1C1E',
  textMuted: '#6E6E73',
} as const

export const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: colors.violet600,
    primaryColorHover: colors.violet700,
    primaryColorPressed: colors.violet900,
    primaryColorSuppl: colors.violet500,
    successColor: colors.teal500,
    successColorHover: colors.teal600,
    successColorPressed: '#1E7A34',
    infoColor: colors.violet400,
    infoColorHover: colors.violet500,
    warningColor: colors.amber500,
    bodyColor: colors.bg,
    cardColor: colors.surface,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    dividerColor: 'rgba(0, 0, 0, 0.06)',
    textColor1: colors.text,
    textColor2: colors.textMuted,
    textColor3: '#8E8E93',
    borderRadius: '12px',
    borderRadiusSmall: '8px',
  },
  Menu: {
    itemColorActive: colors.violet100,
    itemColorActiveHover: colors.violet200,
    itemColorHover: 'rgba(0, 122, 255, 0.05)',
    itemTextColor: colors.textMuted,
    itemTextColorActive: colors.violet600,
    itemTextColorHover: colors.text,
    itemTextColorActiveHover: colors.violet600,
    arrowColor: colors.violet400,
    arrowColorActive: colors.violet600,
    arrowColorHover: colors.violet500,
  },
  Tag: {
    borderRadius: '20px',
  },
  Radio: {
    buttonTextColorActive: colors.violet600,
    buttonColorActive: colors.violet100,
    buttonBorderColorActive: colors.violet200,
  },
  Card: {
    borderRadius: '16px',
    color: colors.surface,
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },
  Button: {
    borderRadiusMedium: '10px',
  },
  Slider: {
    fillColor: colors.violet600,
    fillColorHover: colors.violet700,
    handleColor: colors.violet600,
  },
}

/** 暗色 naive-ui overrides，与 theme.css 的 [data-theme=dark] 对齐（macOS 深灰 + 系统蓝） */
export const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#0A84FF',
    primaryColorHover: '#409CFF',
    primaryColorPressed: '#64B5FF',
    primaryColorSuppl: '#409CFF',
    successColor: '#30D158',
    successColorHover: '#30D158',
    successColorPressed: '#248A3D',
    infoColor: '#7D7AFF',
    warningColor: '#FFD60A',
    errorColor: '#FF453A',
    bodyColor: '#1E1E1E',
    cardColor: '#2C2C2E',
    borderColor: 'rgba(255, 255, 255, 0.10)',
    dividerColor: 'rgba(255, 255, 255, 0.08)',
    textColor1: '#F2F2F7',
    textColor2: '#AEAEB2',
    textColor3: '#8E8E93',
    borderRadius: '12px',
    borderRadiusSmall: '8px',
  },
  Menu: {
    itemColorActive: 'rgba(10, 132, 255, 0.18)',
    itemColorActiveHover: 'rgba(10, 132, 255, 0.26)',
    itemColorHover: 'rgba(255, 255, 255, 0.05)',
    itemTextColor: '#AEAEB2',
    itemTextColorActive: '#409CFF',
    itemTextColorHover: '#F2F2F7',
    itemTextColorActiveHover: '#64B5FF',
    arrowColor: '#409CFF',
    arrowColorActive: '#64B5FF',
    arrowColorHover: '#409CFF',
  },
  Tag: {
    borderRadius: '20px',
  },
  Radio: {
    buttonTextColorActive: '#64B5FF',
    buttonColorActive: 'rgba(10, 132, 255, 0.18)',
    buttonBorderColorActive: 'rgba(10, 132, 255, 0.42)',
  },
  Card: {
    borderRadius: '16px',
    color: '#2C2C2E',
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  Button: {
    borderRadiusMedium: '10px',
  },
  Slider: {
    fillColor: '#0A84FF',
    fillColorHover: '#409CFF',
    handleColor: '#0A84FF',
  },
}

/** 亮色 overrides 的别名（语义清晰，供 useTheme 选用） */
export const lightThemeOverrides = themeOverrides
