import { NavLink, Outlet } from 'react-router-dom'

import { cn } from '@/lib/utils'

export function SettingsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Foundation settings for the shell. No backend persistence yet.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <div className="flex items-center gap-1 rounded-md border bg-background p-1">
          <NavLink
            to="/settings/brokers"
            className={({ isActive }) =>
              cn(
                'inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors',
                isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
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
                isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
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
