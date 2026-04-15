import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'

export function SettingsPage() {
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
