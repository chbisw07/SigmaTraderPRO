import type { ThemePreference } from '@/store/appearanceStore'

export type ResolvedTheme = Exclude<ThemePreference, 'system'>

export type ThemeMeta = {
  key: ThemePreference
  label: string
  description: string
}

export const THEME_OPTIONS: ThemeMeta[] = [
  {
    key: 'system',
    label: 'System',
    description: 'Follow OS light/dark preference.',
  },
  {
    key: 'light',
    label: 'Light',
    description: 'Clean, professional light workspace.',
  },
  {
    key: 'light-soft',
    label: 'Light Soft',
    description: 'Softer light theme with reduced harshness.',
  },
  {
    key: 'dark',
    label: 'Dark',
    description: 'Neutral slate workspace for focus.',
  },
  {
    key: 'dark-trading',
    label: 'Dark Trading',
    description: 'Deeper dark, slightly higher contrast for long sessions.',
  },
]

export function isDarkResolvedTheme(theme: ResolvedTheme): boolean {
  return theme === 'dark' || theme === 'dark-trading'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference
  const isSystemDark =
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  return isSystemDark ? 'dark' : 'light'
}

