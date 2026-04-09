import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { TopNav } from '@/components/shell/TopNav'
import { UserMenu } from '@/components/shell/UserMenu'
import { StatusBar } from '@/components/status/StatusBar'
import { ThemeSelect } from '@/components/appearance/ThemeSelect'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { NAV_ITEMS } from '@/routes/nav'
import { useUiStore } from '@/store/uiStore'

function useCurrentLabel(): string {
  const { pathname } = useLocation()
  const match = NAV_ITEMS.find((i) => i.to === pathname)
  return match?.label ?? 'SigmaTraderPRO'
}

export function RootLayout() {
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebarCollapsed = useUiStore((s) => s.toggleSidebarCollapsed)
  const pageLabel = useCurrentLabel()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            'hidden md:flex flex-col border-r bg-card/50',
            sidebarCollapsed ? 'w-16' : 'w-56',
          )}
        >
          <div className="flex h-14 items-center justify-between px-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-background text-sm font-semibold">
                Σ
              </div>
              {!sidebarCollapsed ? (
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">SigmaTraderPRO</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    ML1 • Shell
                  </div>
                </div>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle sidebar"
              onClick={toggleSidebarCollapsed}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
          </div>
          <nav className="flex-1 space-y-1 p-2">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground',
                    isActive &&
                      'bg-accent/60 font-medium text-foreground before:absolute before:left-0 before:top-1/2 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-r before:bg-primary',
                  )
                }
              >
                <span className="shrink-0">{item.icon}</span>
                {!sidebarCollapsed && <span>{item.label}</span>}
              </NavLink>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b bg-background px-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold">{pageLabel}</div>
                <div className="truncate text-xs text-muted-foreground">
                  SigmaTraderPRO • Workspace
                </div>
              </div>
              <TopNav />
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="hidden sm:inline-flex">
                Dev
              </Badge>
              <ThemeSelect />
              <UserMenu />
            </div>
          </header>

          <main className="flex-1 p-4">
            <Outlet />
          </main>

          <StatusBar />
        </div>
      </div>
    </div>
  )
}
