import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'

import { TopNav } from '@/components/shell/TopNav'
import { MarketIndices } from '@/components/shell/MarketIndices'
import { UserMenu } from '@/components/shell/UserMenu'
import { StatusBar } from '@/components/status/StatusBar'
import { ThemeSelect } from '@/components/appearance/ThemeSelect'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { WatchlistPage } from '@/pages/WatchlistPage'
import { WATCHLIST_WIDTH_SPECS, clampWidth, useWatchlistLayoutStore } from '@/store/watchlistLayoutStore'

export function RootLayout() {
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  )

  const mode = useWatchlistLayoutStore((s) => s.mode)
  const widthByMode = useWatchlistLayoutStore((s) => s.widthByMode)
  const spec = WATCHLIST_WIDTH_SPECS[mode]
  const viewportCapPx = Math.floor(viewportWidth * 0.3)
  const maxPx = Math.min(spec.max, Math.max(spec.min, viewportCapPx))
  const minPx = spec.min
  const widthPx = clampWidth(widthByMode[mode] ?? spec.preset, minPx, maxPx)

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header
        className={cn(
          'flex h-16 items-center justify-between border-b px-4',
          'bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70',
          'shadow-sm',
        )}
      >
        <div className="flex min-w-0 items-center gap-4">
          <Link to="/search" className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-sm font-semibold text-primary">
              Σ
            </div>
            <div className="hidden sm:block min-w-0">
              <div className="truncate text-sm font-semibold tracking-tight">SigmaTraderPRO</div>
              <div className="truncate text-[11px] text-muted-foreground">
                ML1 • Terminal
              </div>
            </div>
          </Link>

          <MarketIndices />
        </div>

        <div className="flex flex-1 items-center justify-center px-4">
          <TopNav />
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden sm:inline-flex text-[10px] text-muted-foreground">
            Dev
          </Badge>
          <ThemeSelect />
          <UserMenu />
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside
          className={cn(
            'hidden md:block shrink-0 bg-background',
          )}
          style={{ width: widthPx, minWidth: minPx, maxWidth: maxPx }}
        >
          <div className="h-full min-h-0 overflow-auto p-3">
            <WatchlistPage />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 min-h-0 overflow-hidden p-3">
            <div className="h-full min-h-0 overflow-auto rounded-xl border bg-card shadow-sm px-3 pb-3 pt-2">
              <Outlet />
            </div>
          </main>
        </div>
      </div>

      <StatusBar />
    </div>
  )
}
