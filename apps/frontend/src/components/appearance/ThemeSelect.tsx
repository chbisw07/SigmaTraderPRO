import { THEME_OPTIONS } from '@/app/theme'
import { cn } from '@/lib/utils'
import { useAppearanceStore, type ThemePreference } from '@/store/appearanceStore'

type ThemeSelectProps = {
  className?: string
  compact?: boolean
}

export function ThemeSelect({ className, compact = true }: ThemeSelectProps) {
  const theme = useAppearanceStore((s) => s.theme)
  const setTheme = useAppearanceStore((s) => s.setTheme)

  return (
    <label className={cn('flex items-center gap-2', className)}>
      <span className="sr-only">Theme</span>
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as ThemePreference)}
        className={cn(
          'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none',
          'shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          compact && 'h-8 text-xs',
        )}
        aria-label="Theme"
      >
        {THEME_OPTIONS.map((opt) => (
          <option key={opt.key} value={opt.key}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}
