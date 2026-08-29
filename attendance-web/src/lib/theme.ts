export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

const THEME_KEY = 'hrm-theme'

export function resolveTheme(theme: ThemePreference, systemDark: boolean): ResolvedTheme {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}

export function getStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(THEME_KEY)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

export function applyTheme(theme: ThemePreference) {
  if (typeof window === 'undefined') return
  const resolved = resolveTheme(theme, window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.documentElement.style.colorScheme = resolved
  window.localStorage.setItem(THEME_KEY, theme)
}

export function watchSystemTheme(getTheme: () => ThemePreference) {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const handleChange = () => { if (getTheme() === 'system') applyTheme('system') }
  media.addEventListener('change', handleChange)
  return () => media.removeEventListener('change', handleChange)
}
