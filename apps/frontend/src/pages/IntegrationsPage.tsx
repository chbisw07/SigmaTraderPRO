import { NavLink, Outlet } from 'react-router-dom'

import { cn } from '@/lib/utils'

export function IntegrationsPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <div className="flex items-center gap-1 rounded-md border bg-background p-1">
          <NavLink
            to="/settings/integrations/tradingview"
            className={({ isActive }) =>
              cn(
                'inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors',
                isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )
            }
            end
          >
            TradingView
          </NavLink>
        </div>
      </div>

      <Outlet />
    </div>
  )
}
