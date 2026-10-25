import type { GlobalThemeOverrides } from 'naive-ui'

/**
 * Catrace 统一色板 — 对齐 catrace-ui-concept.html 的白色主题：
 * slate 中性色 + indigo 强调（变量名沿用历史的 violet* 前缀，值已换成 indigo）。
 */
export const colors = {
  violet900: '#3730A3',
  violet700: '#4338CA',
  violet600: '#4F46E5',
  violet500: '#6366F1',
  violet400: '#818CF8',
  violet200: '#C7D2FE',
  violet100: '#EEF2FF',
  violet50: '#F5F6FF',
  bg: '#F8FAFC',
  surface: '#FFFFFF',
  teal600: '#047857',
  teal500: '#059669',
  teal400: '#34D399',
  teal50: '#ECFDF5',
  amber500: '#A16207',
  amber50: '#FEF9C3',
  text: '#0F172A',
  textMuted: '#64748B',
} as const

export const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: colors.violet600,
    primaryColorHover: colors.violet700,
    primaryColorPressed: colors.violet900,
    primaryColorSuppl: colors.violet500,
    successColor: colors.teal500,
    successColorHover: colors.teal600,
    successColorPressed: '#065F46',
    infoColor: colors.violet400,
    infoColorHover: colors.violet500,
    warningColor: colors.amber500,
    bodyColor: colors.bg,
    cardColor: colors.surface,
    borderColor: '#E2E8F0',
    dividerColor: '#F1F5F9',
    textColor1: colors.text,
    textColor2: colors.textMuted,
    textColor3: '#94A3B8',
    borderRadius: '12px',
    borderRadiusSmall: '8px',
  },
  Menu: {
    itemColorActive: colors.violet100,
    itemColorActiveHover: colors.violet200,
    itemColorHover: 'rgba(238, 242, 255, 0.6)',
    itemTextColor: colors.textMuted,
    itemTextColorActive: colors.violet700,
    itemTextColorHover: colors.text,
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
    borderColor: '#E2E8F0',
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

/** 暗色 naive-ui overrides，与 theme.css 的 [data-theme=dark] 对齐（中性灰 + indigo） */
export const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#6366F1',
    primaryColorHover: '#818CF8',
    primaryColorPressed: '#A5B4FC',
    primaryColorSuppl: '#818CF8',
    successColor: '#34D399',
    successColorHover: '#6EE7B7',
    successColorPressed: '#059669',
    infoColor: '#60A5FA',
    warningColor: '#FACC15',
    errorColor: '#F87171',
    bodyColor: '#141414',
    cardColor: '#1C1C1C',
    borderColor: '#343434',
    dividerColor: '#2A2A2A',
    textColor1: '#EDEDED',
    textColor2: '#ABABAB',
    textColor3: '#8A8A8A',
    borderRadius: '12px',
    borderRadiusSmall: '8px',
  },
  Menu: {
    itemColorActive: '#282828',
    itemColorActiveHover: '#303030',
    itemColorHover: 'rgba(48, 48, 48, 0.6)',
    itemTextColor: '#ABABAB',
    itemTextColorActive: '#A5B4FC',
    itemTextColorHover: '#EDEDED',
    itemTextColorActiveHover: '#A5B4FC',
    arrowColor: '#818CF8',
    arrowColorActive: '#A5B4FC',
    arrowColorHover: '#818CF8',
  },
  Tag: {
    borderRadius: '20px',
  },
  Radio: {
    buttonTextColorActive: '#A5B4FC',
    buttonColorActive: '#282828',
    buttonBorderColorActive: '#454545',
  },
  Card: {
    borderRadius: '16px',
    color: '#1C1C1C',
    borderColor: '#343434',
  },
  Button: {
    borderRadiusMedium: '10px',
  },
  Slider: {
    fillColor: '#818CF8',
    fillColorHover: '#A5B4FC',
    handleColor: '#818CF8',
  },
}

/** 亮色 overrides 的别名（语义清晰，供 useTheme 选用） */
export const lightThemeOverrides = themeOverrides
