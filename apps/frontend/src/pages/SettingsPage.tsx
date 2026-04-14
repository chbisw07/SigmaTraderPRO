import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'

import { THEME_OPTIONS, resolveTheme } from '@/app/theme'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppearanceStore } from '@/store/appearanceStore'

export function SettingsPage() {
  const preference = useAppearanceStore((s) => s.theme)
  const setTheme = useAppearanceStore((s) => s.setTheme)

  const resolved = typeof window === 'undefined' ? 'light' : resolveTheme(preference)
  const resolvedLabel = THEME_OPTIONS.find((t) => t.key === resolved)?.label ?? resolved

  const currentLabel =
    THEME_OPTIONS.find((t) => t.key === preference)?.label ?? preference
  const currentDescription =
    THEME_OPTIONS.find((t) => t.key === preference)?.description ?? ''

  const themeIcon = (key: string) => {
    if (key === 'system') return <Monitor className="h-4 w-4" />
    if (key.startsWith('dark')) return <Moon className="h-4 w-4" />
    return <Sun className="h-4 w-4" />
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Foundation settings for the shell. No backend persistence yet.
        </p>
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Appearance</h2>
          <p className="text-xs text-muted-foreground">
            Themes are token-driven via CSS variables and apply across the shell.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">Current theme</div>
              <div className="text-xs text-muted-foreground">
                {currentLabel}
                {preference === 'system' ? ` (resolved: ${resolvedLabel})` : null}
              </div>
              {currentDescription ? (
                <div className="mt-1 text-xs text-muted-foreground">
                  {currentDescription}
                </div>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTheme(preference === 'dark' ? 'light' : 'dark')}
            >
              Quick toggle
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THEME_OPTIONS.map((opt) => {
            const selected = opt.key === preference
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setTheme(opt.key)}
                className={cn(
                  'group rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected && 'border-ring',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className="text-muted-foreground">
                        {themeIcon(opt.key)}
                      </span>
                      <span>{opt.label}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {opt.description}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md border text-muted-foreground',
                      selected && 'border-primary text-primary',
                    )}
                    aria-hidden="true"
                  >
                    {selected ? <Check className="h-3.5 w-3.5" /> : null}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        <div className="rounded-lg border bg-card p-3">
          <div className="text-sm font-medium">Density</div>
          <div className="text-xs text-muted-foreground">
            Placeholder (will be introduced if needed). Default is compact.
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Integrations</h2>
          <p className="text-xs text-muted-foreground">
            Operational integrations managed server-side.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">TradingView</div>
              <div className="text-xs text-muted-foreground">
                Create route tokens and manage default execution policy for webhook signals.
              </div>
            </div>
            <Button asChild type="button" variant="outline" size="sm">
              <Link to="/settings/tradingview">Open</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
