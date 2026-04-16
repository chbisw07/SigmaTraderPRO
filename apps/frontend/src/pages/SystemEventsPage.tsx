import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { SlidersHorizontal } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import * as systemEventsApi from '@/lib/api/systemEvents'

const EMPTY_EVENTS: systemEventsApi.SystemEvent[] = []

function LevelBadge({ level }: { level: string }) {
  const l = (level || 'INFO').toUpperCase()
  const cls =
    l === 'ERROR'
      ? 'border-destructive/30 bg-destructive/10 text-destructive'
      : l === 'WARNING'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
        : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'
  return (
    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium', cls)}>
      {l}
    </span>
  )
}

export function SystemEventsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)

  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [level, setLevel] = useState('')
  const [keepDays, setKeepDays] = useState(7)

  const activeFilterCount = useMemo(() => {
    return (q.trim() ? 1 : 0) + (category.trim() ? 1 : 0) + (level.trim() ? 1 : 0)
  }, [category, level, q])

  const clearAllFilters = () => {
    setQ('')
    setCategory('')
    setLevel('')
  }

  const events = useQuery<systemEventsApi.SystemEventsListResponse>({
    queryKey: ['system-events', { q, category, level }],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      return systemEventsApi.listSystemEvents(accessToken, {
        q: q.trim() || undefined,
        category: category.trim() || undefined,
        level: level.trim() || undefined,
        limit: 500,
      })
    },
    enabled: Boolean(accessToken),
    refetchInterval: 30_000,
  })

  const cleanupMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Not authenticated')
      return systemEventsApi.cleanupSystemEvents(accessToken, keepDays)
    },
    onSuccess: async () => {
      await events.refetch()
    },
  })

  const rows = events.data?.items ?? EMPTY_EVENTS

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const e of rows) if (e.category) set.add(e.category)
    return Array.from(set).sort()
  }, [rows])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3 shadow-sm">
        <h1 className="sr-only">System Events</h1>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search message / correlation id…"
            className="h-9 w-[420px] max-w-full"
          />
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="h-9">
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {activeFilterCount ? (
                  <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 text-[11px] font-medium text-foreground">
                    {activeFilterCount}
                  </span>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[520px] max-w-[92vw] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Filters</div>
                <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs text-muted-foreground" onClick={clearAllFilters}>
                  Clear all
                </Button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Category</div>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className={cn(
                      'h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    )}
                  >
                    <option value="">All</option>
                    <option value="order_dispatch">order_dispatch</option>
                    {categories
                      .filter((c) => c !== 'order_dispatch')
                      .slice(0, 50)
                      .map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Level</div>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    className={cn(
                      'h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    )}
                  >
                    <option value="">All</option>
                    {['INFO', 'WARNING', 'ERROR'].map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex items-center gap-2">
          <Input
            aria-label="Keep last (days)"
            className="h-9 w-[120px]"
            type="number"
            min={1}
            max={365}
            value={keepDays}
            onChange={(e) => setKeepDays(Math.max(1, Math.min(365, Number(e.target.value || 7))))}
            placeholder="Days"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void cleanupMutation.mutateAsync()}
            disabled={!accessToken || cleanupMutation.isPending}
          >
            {cleanupMutation.isPending ? 'Cleaning…' : 'Cleanup now'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void events.refetch()} disabled={!accessToken}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <div className="text-sm font-medium">Latest first</div>
          <div className="text-xs text-muted-foreground">{rows.length} events</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/95 text-[11px] font-semibold text-muted-foreground backdrop-blur">
              <tr className="border-b">
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Level</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Message</th>
                <th className="px-3 py-2 text-left">Correlation ID</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((e) => (
                <tr key={e.id} className="transition-colors hover:bg-accent/30">
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {e.created_at ? new Date(e.created_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <LevelBadge level={e.level} />
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{e.category}</Badge>
                  </td>
                  <td className="px-3 py-2">{e.message}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {e.correlation_id ? <span className="font-mono">{e.correlation_id}</span> : '—'}
                  </td>
                </tr>
              ))}
              {!rows.length && !events.isFetching ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={5}>
                    No events yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
