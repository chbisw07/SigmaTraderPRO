import { NavLink, Outlet } from 'react-router-dom'

import { cn } from '@/lib/utils'

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="sr-only">Settings</h1>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-sm">
        <div className="flex items-center gap-1 rounded-md bg-muted/40 p-1">
          <NavLink
            to="/settings/brokers"
            className={({ isActive }) =>
              cn(
                'inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors',
                isActive ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )
            }
            end
          >
            Brokers
          </NavLink>
          <NavLink
            to="/settings/integrations"
            className={({ isActive }) =>
              cn(
                'inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors',
                isActive ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            Integrations
          </NavLink>
        </div>
      </div>

      <Outlet />
    </div>
  )
}
