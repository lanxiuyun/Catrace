import type { GlobalThemeOverrides } from 'naive-ui'

/** Catrace 统一色板 — lavender wellness */
export const colors = {
  violet900: '#4C1D95',
  violet700: '#6D28D9',
  violet600: '#7C3AED',
  violet500: '#8B5CF6',
  violet400: '#A78BFA',
  violet200: '#DDD6FE',
  violet100: '#EDE9FE',
  violet50: '#F5F3FF',
  bg: '#F7F5FA',
  surface: '#FFFFFF',
  teal600: '#0D9488',
  teal500: '#14B8A6',
  teal400: '#2DD4BF',
  teal50: '#F0FDFA',
  amber500: '#F59E0B',
  amber50: '#FFFBEB',
  text: '#3730A3',
  textMuted: '#7C7CAA',
} as const

export const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: colors.violet600,
    primaryColorHover: colors.violet700,
    primaryColorPressed: colors.violet900,
    primaryColorSuppl: colors.violet500,
    successColor: colors.teal500,
    successColorHover: colors.teal600,
    successColorPressed: '#0F766E',
    infoColor: colors.violet400,
    infoColorHover: colors.violet500,
    warningColor: colors.amber500,
    bodyColor: '#F7F5FA',
    cardColor: colors.surface,
    borderColor: colors.violet100,
    dividerColor: colors.violet100,
    textColor1: colors.violet900,
    textColor2: colors.textMuted,
    textColor3: colors.violet400,
    borderRadius: '12px',
    borderRadiusSmall: '8px',
  },
  Menu: {
    itemColorActive: colors.violet100,
    itemColorActiveHover: colors.violet200,
    itemColorHover: 'rgba(237, 233, 254, 0.6)',
    itemTextColor: colors.textMuted,
    itemTextColorActive: colors.violet700,
    itemTextColorHover: colors.violet900,
    itemTextColorActiveHover: colors.violet700,
    arrowColor: colors.violet400,
    arrowColorActive: colors.violet600,
    arrowColorHover: colors.violet500,
  },
  Tag: {
    borderRadius: '20px',
  },
  Radio: {
    buttonTextColorActive: colors.violet700,
    buttonColorActive: colors.violet100,
    buttonBorderColorActive: colors.violet200,
  },
  Card: {
    borderRadius: '16px',
    color: colors.surface,
    borderColor: colors.violet100,
  },
  Button: {
    borderRadiusMedium: '10px',
  },
  Slider: {
    fillColor: colors.violet500,
    fillColorHover: colors.violet600,
    handleColor: colors.violet600,
  },
}

/** 暗色 naive-ui overrides，与 theme.css 的 [data-theme=dark] 对齐 */
export const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#a78bfa',
    primaryColorHover: '#8b5cf6',
    primaryColorPressed: '#c4b5fd',
    primaryColorSuppl: '#a78bfa',
    successColor: '#34d399',
    successColorHover: '#6ee7b7',
    successColorPressed: '#059669',
    infoColor: '#60a5fa',
    warningColor: '#fbbf24',
    errorColor: '#f87171',
    bodyColor: '#1a1a1e',
    cardColor: '#232329',
    borderColor: '#35353d',
    dividerColor: '#35353d',
    textColor1: '#ececf0',
    textColor2: '#a1a1aa',
    textColor3: '#71717a',
    borderRadius: '12px',
    borderRadiusSmall: '8px',
  },
  Menu: {
    itemColorActive: '#2e2a45',
    itemColorActiveHover: '#3a3555',
    itemColorHover: 'rgba(46, 42, 69, 0.6)',
    itemTextColor: '#a1a1aa',
    itemTextColorActive: '#c4b5fd',
    itemTextColorHover: '#ececf0',
    itemTextColorActiveHover: '#c4b5fd',
    arrowColor: '#a78bfa',
    arrowColorActive: '#c4b5fd',
    arrowColorHover: '#a78bfa',
  },
  Tag: {
    borderRadius: '20px',
  },
  Radio: {
    buttonTextColorActive: '#c4b5fd',
    buttonColorActive: '#2e2a45',
    buttonBorderColorActive: '#4a4470',
  },
  Card: {
    borderRadius: '16px',
    color: '#232329',
    borderColor: '#35353d',
  },
  Button: {
    borderRadiusMedium: '10px',
  },
  Slider: {
    fillColor: '#a78bfa',
    fillColorHover: '#8b5cf6',
    handleColor: '#a78bfa',
  },
}

/** 亮色 overrides 的别名（语义清晰，供 useTheme 选用） */
export const lightThemeOverrides = themeOverrides
