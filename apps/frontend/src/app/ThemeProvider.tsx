import { type ReactNode, useEffect, useMemo, useState } from 'react'

import {
  isDarkResolvedTheme,
  resolveTheme,
  type ResolvedTheme,
} from '@/app/theme'
import { useAppearanceStore } from '@/store/appearanceStore'

type ThemeProviderProps = {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const preference = useAppearanceStore((s) => s.theme)
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    typeof window === 'undefined' ? 'light' : resolveTheme(preference),
  )

  const shouldTrackSystem = useMemo(() => preference === 'system', [preference])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const apply = (theme: ResolvedTheme) => {
      setResolved(theme)
      const root = document.documentElement
      root.dataset.theme = theme
      root.classList.toggle('dark', isDarkResolvedTheme(theme))
    }

    if (!shouldTrackSystem) {
      apply(resolveTheme(preference))
      return
    }

    const mql = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onChange = () => apply(resolveTheme('system'))
    onChange()

    if (!mql) return
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [preference, shouldTrackSystem])

  return (
    <div data-resolved-theme={resolved} className="contents">
      {children}
    </div>
  )
}
