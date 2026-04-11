import { type ComponentProps, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
  Filter,
  MoreHorizontal,
  Maximize2,
  Minimize2,
  Pencil,
  Plus,
  ReceiptText,
  Square,
  Settings,
  Trash2,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import * as brokersApi from '@/lib/api/brokers'
import * as instrumentsApi from '@/lib/api/instruments'
import * as ordersApi from '@/lib/api/orders'
import * as positionsApi from '@/lib/api/positions'
import * as watchlistsApi from '@/lib/api/watchlists'
import { cn } from '@/lib/utils'
import { StockOrderDialog } from '@/features/orders/StockOrderDialog'
import { FnoOrderDialog } from '@/features/orders/FnoOrderDialog'
import { useAuthStore } from '@/store/authStore'
import { useWatchlistLayoutStore } from '@/store/watchlistLayoutStore'
import { useWatchlistViewStore } from '@/store/watchlistViewStore'
import { useQuoteStore } from '@/store/quoteStore'

const ACTIVE_WATCHLIST_KEY = 'sigmatraderpro.watchlist.active_id'

const BROKER_OPTIONS = [
  { key: 'angel', label: 'Angel One' },
  { key: 'zerodha', label: 'Zerodha' },
] as const

type BrokerKey = (typeof BROKER_OPTIONS)[number]['key']

function typeLabel(i: instrumentsApi.InstrumentOut | null, fallback: string | null) {
  const t = i?.instrument_type ?? fallback ?? '—'
  if (t === 'OPTION') return 'Option'
  if (t === 'FUTURE') return 'Future'
  if (t === 'ETF') return 'ETF'
  if (t === 'INDEX') return 'Index'
  if (t === 'EQUITY') return 'Equity'
  return t
}

function formatExpiryHuman(iso: string | null): string {
  if (!iso) return '—'
  try {
    const d = new Date(`${iso}T00:00:00Z`)
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d)
  } catch {
    return iso
  }
}

function formatStrikeHuman(strike: number | null): string {
  if (strike == null) return '—'
  if (strike >= 100_000) {
    const v = strike / 100
    return Number.isInteger(v) ? String(v) : v.toFixed(2)
  }
  return String(strike)
}

function titleForItem(item: watchlistsApi.WatchlistItemOut) {
  const inst = item.instrument
  if (!inst) return item.display_symbol
  const root = (inst.underlying ?? inst.symbol_root).toUpperCase()
  if (inst.instrument_type === 'OPTION') {
    return `${root} ${formatExpiryHuman(inst.expiry)} ${formatStrikeHuman(inst.strike)} ${inst.option_type ?? ''}`.trim()
  }
  if (inst.instrument_type === 'FUTURE') {
    return `${root} ${formatExpiryHuman(inst.expiry)} FUT`.trim()
  }
  return inst.display_symbol
}

function compactTitleForItem(item: watchlistsApi.WatchlistItemOut) {
  const inst = item.instrument
  if (!inst) return item.display_symbol
  const root = (inst.underlying ?? inst.symbol_root).toUpperCase()
  if (inst.instrument_type === 'OPTION') {
    const strike = formatStrikeHuman(inst.strike)
    return `${root} ${strike} ${inst.option_type ?? ''}`.trim()
  }
  if (inst.instrument_type === 'FUTURE') {
    return `${root} FUT`.trim()
  }
  return inst.display_symbol
}

function isDerivativeType(t: string | null) {
  return t === 'OPTION' || t === 'FUTURE'
}

function exchangeGroup(exchange: string | null): 'nse' | 'bse' | null {
  if (!exchange) return null
  const x = exchange.toUpperCase()
  if (x.startsWith('BSE')) return 'bse'
  if (x.startsWith('NSE')) return 'nse'
  return null
}

function safeStoredActiveId(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ACTIVE_WATCHLIST_KEY)
    if (!raw) return null
    const v = Number(raw)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

function setStoredActiveId(id: number) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ACTIVE_WATCHLIST_KEY, String(id))
  } catch {
    // ignore
  }
}

export function WatchlistPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const updateLastUsedBroker = useAuthStore((s) => s.updateLastUsedBroker)
  const navigate = useNavigate()

  const watchlistMode = useWatchlistLayoutStore((s) => s.mode)
  const setWatchlistMode = useWatchlistLayoutStore((s) => s.setMode)

  const filterType = useWatchlistViewStore((s) => s.filterType)
  const filterExchange = useWatchlistViewStore((s) => s.filterExchange)
  const sort = useWatchlistViewStore((s) => s.sort)
  const setFilterType = useWatchlistViewStore((s) => s.setFilterType)
  const setFilterExchange = useWatchlistViewStore((s) => s.setFilterExchange)
  const setSort = useWatchlistViewStore((s) => s.setSort)
  const resetView = useWatchlistViewStore((s) => s.reset)

  const getPremium = useQuoteStore((s) => s.getPremium)
  const getSpot = useQuoteStore((s) => s.getSpot)

  const [activeIdOverride, setActiveIdOverride] = useState<number | null>(() => safeStoredActiveId())
  const [banner, setBanner] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeRowId, setActiveRowId] = useState<number | null>(null)
  const [controlsOpen, setControlsOpen] = useState(false)

  const selectedBroker = (user?.last_used_broker as BrokerKey | null) ?? null
  const broker = selectedBroker ?? 'angel'

  const watchlists = useQuery({
    queryKey: ['watchlists', 'list'],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      return watchlistsApi.listWatchlists(accessToken)
    },
    enabled: Boolean(accessToken),
  })

  const activeId = useMemo(() => {
    const items = watchlists.data?.items ?? []
    if (!items.length) return null
    const validOverride =
      activeIdOverride != null && items.some((w) => w.id === activeIdOverride)
    if (validOverride) return activeIdOverride
    const stored = safeStoredActiveId()
    const storedValid = stored != null && items.some((w) => w.id === stored)
    if (storedValid) return stored
    const def = items.find((w) => w.is_default) ?? items[0]
    return def.id
  }, [activeIdOverride, watchlists.data])

  useEffect(() => {
    if (activeId != null) setStoredActiveId(activeId)
  }, [activeId])

  const watchlistItems = useQuery({
    queryKey: ['watchlists', 'items', activeId],
    queryFn: async () => {
      if (!accessToken || !activeId) return null
      return watchlistsApi.listWatchlistItems(accessToken, activeId)
    },
    enabled: Boolean(accessToken) && Boolean(activeId),
  })

  const createWl = useMutation({
    mutationFn: async ({ name, make_default }: { name: string; make_default?: boolean }) => {
      if (!accessToken) throw new Error('no auth')
      return watchlistsApi.createWatchlist(accessToken, { name, make_default })
    },
    onSuccess: async (wl) => {
      await watchlists.refetch()
      setActiveIdOverride(wl.id)
      setStoredActiveId(wl.id)
      setBanner('Watchlist created')
    },
    onError: () => setBanner('Create failed'),
  })

  const updateWl = useMutation({
    mutationFn: async ({ id, name, is_default }: { id: number; name?: string; is_default?: boolean }) => {
      if (!accessToken) throw new Error('no auth')
      return watchlistsApi.updateWatchlist(accessToken, id, { name, is_default })
    },
    onSuccess: async (wl) => {
      await watchlists.refetch()
      if (wl.is_default) setBanner('Default watchlist updated')
    },
    onError: () => setBanner('Update failed'),
  })

  const deleteWl = useMutation({
    mutationFn: async (id: number) => {
      if (!accessToken) throw new Error('no auth')
      await watchlistsApi.deleteWatchlist(accessToken, id)
    },
    onSuccess: async () => {
      await watchlists.refetch()
      setBanner('Watchlist deleted')
    },
    onError: () => setBanner('Delete failed'),
  })

  const addItem = useMutation({
    mutationFn: async ({ watchlistId, canonicalId }: { watchlistId: number; canonicalId: string }) => {
      if (!accessToken) throw new Error('no auth')
      return watchlistsApi.addWatchlistItem(accessToken, watchlistId, { canonical_id: canonicalId })
    },
    onSuccess: async () => {
      await watchlistItems.refetch()
      setBanner('Added to watchlist')
    },
    onError: () => setBanner('Add failed'),
  })

  const addUnderlying = useMutation({
    mutationFn: async ({ watchlistId, underlying }: { watchlistId: number; underlying: string }) => {
      if (!accessToken) throw new Error('no auth')
      return watchlistsApi.addWatchlistItem(accessToken, watchlistId, { underlying })
    },
    onSuccess: async () => {
      await watchlistItems.refetch()
      setBanner('Added underlying')
    },
    onError: () => setBanner('Add failed'),
  })

  const removeItem = useMutation({
    mutationFn: async ({ watchlistId, itemId }: { watchlistId: number; itemId: number }) => {
      if (!accessToken) throw new Error('no auth')
      await watchlistsApi.removeWatchlistItem(accessToken, watchlistId, itemId)
    },
    onSuccess: async () => {
      await watchlistItems.refetch()
      setBanner('Removed')
    },
    onError: () => setBanner('Remove failed'),
  })

  const reorder = useMutation({
    mutationFn: async ({ watchlistId, itemIds }: { watchlistId: number; itemIds: number[] }) => {
      if (!accessToken) throw new Error('no auth')
      await watchlistsApi.reorderWatchlistItems(accessToken, watchlistId, itemIds)
    },
    onSuccess: async () => {
      await watchlistItems.refetch()
    },
  })

  const brokerStatus = useQuery({
    queryKey: ['brokers', 'status'],
    queryFn: async () => {
      if (!accessToken) return []
      return brokersApi.listBrokerStatus(accessToken)
    },
    enabled: Boolean(accessToken),
    refetchInterval: 30_000,
  })

  const positions = useQuery({
    queryKey: ['positions', 'all'],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      return positionsApi.listPositions(accessToken, { limit: 500 })
    },
    enabled: Boolean(accessToken),
    refetchInterval: 30_000,
  })

  const orders = useQuery({
    queryKey: ['orders', 'workspace', 'summary'],
    queryFn: async () => {
      if (!accessToken) return { items: [], meta: { include_broker_orders: true, mode: 'merged', broker_errors: {} } }
      return ordersApi.listOrdersWorkspace(accessToken, { mode: 'merged', limit: 500 })
    },
    enabled: Boolean(accessToken),
    refetchInterval: 30_000,
  })

  const positionSet = useMemo(() => {
    const set = new Set<string>()
    for (const p of positions.data?.items ?? []) set.add(p.canonical_id)
    return set
  }, [positions.data])

  const openOrderSet = useMemo(() => {
    const set = new Set<string>()
    for (const o of orders.data?.items ?? []) {
      if (!o.canonical_id) continue
      const s = (o.status ?? '').toUpperCase()
      if (['PENDING', 'OPEN', 'PARTIAL'].includes(s)) set.add(o.canonical_id)
    }
    return set
  }, [orders.data])

  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const addSearch = useQuery({
    queryKey: ['watchlist', 'add', q],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      return instrumentsApi.searchInstruments(accessToken, { q, limit: 20 })
    },
    enabled: Boolean(accessToken) && q.trim().length > 0,
  })

  const [stockDialogOpen, setStockDialogOpen] = useState(false)
  const [stockLaunch, setStockLaunch] = useState<ComponentProps<typeof StockOrderDialog>['launch'] | null>(null)
  const [fnoDialogOpen, setFnoDialogOpen] = useState(false)
  const [fnoLaunch, setFnoLaunch] = useState<ComponentProps<typeof FnoOrderDialog>['launch'] | null>(null)
  const [dialogKey, setDialogKey] = useState('wl')

  const closeDialogs = () => {
    setStockDialogOpen(false)
    setFnoDialogOpen(false)
    setStockLaunch(null)
    setFnoLaunch(null)
  }

  const openUnderlyingTicket = (underlying: string, side?: ordersApi.OrderSide) => {
    const u = underlying.trim().toUpperCase()
    if (!u) return
    setDialogKey([u, broker, side ?? 'BUY', 'underlying'].join(':'))
    setFnoLaunch({ mode: 'manual', broker, prefill: { underlying: u, side } })
    setFnoDialogOpen(true)
  }

  const openTrade = (item: watchlistsApi.WatchlistItemOut, side: ordersApi.OrderSide) => {
    const inst = item.instrument
    if (!inst) {
      if (item.underlying) openUnderlyingTicket(item.underlying, side)
      return
    }
    const keyBits = [inst.canonical_id, broker, side].join(':')
    setDialogKey(keyBits)
    if (inst.segment === 'EQUITY' && (inst.instrument_type === 'EQUITY' || inst.instrument_type === 'ETF')) {
      setStockLaunch({
        mode: 'contract',
        instrument: inst,
        broker,
        prefill: { side, quantity: 1 },
      })
      setStockDialogOpen(true)
      return
    }

    // INDEX rows represent F&O underlyings (not a specific contract). Open a prefilled manual ticket.
    if (inst.instrument_type === 'INDEX') {
      const u = (inst.underlying ?? inst.symbol_root ?? inst.display_symbol).trim().toUpperCase()
      setFnoLaunch({
        mode: 'manual',
        broker,
        prefill: { underlying: u, side },
      })
      setFnoDialogOpen(true)
      return
    }

    setFnoLaunch({
      mode: 'contract',
      instrument: inst,
      broker,
      prefill: { side, lots: 1 },
    })
    setFnoDialogOpen(true)
  }

  const items = useMemo(() => watchlistItems.data?.items ?? [], [watchlistItems.data])
  const brokerState = brokerStatus.data?.find((b) => b.broker === broker) ?? null
  const watchlistTabs = useMemo(() => watchlists.data?.items ?? [], [watchlists.data])

  const [newName, setNewName] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')

  const isCompact = watchlistMode === 'compact'
  const isWide = watchlistMode === 'wide'
  const canReorder =
    isWide &&
    sort === 'manual' &&
    filterType === 'all' &&
    filterExchange === 'all' &&
    q.trim().length === 0

  const filteredItems = useMemo(() => {
    const needle = q.trim().toLowerCase()

    const byText = (item: watchlistsApi.WatchlistItemOut) => {
      if (!needle) return true
      const title = titleForItem(item).toLowerCase()
      const canon = (item.canonical_id ?? item.symbol_key).toLowerCase()
      const under = (item.underlying ?? '').toLowerCase()
      return title.includes(needle) || canon.includes(needle) || under.includes(needle)
    }

    const byType = (item: watchlistsApi.WatchlistItemOut) => {
      if (filterType === 'all') return true
      const instType = item.instrument?.instrument_type ?? item.instrument_type
      if (!instType) return filterType === 'derivatives'
      if (filterType === 'equity') return instType === 'EQUITY' || instType === 'ETF'
      if (filterType === 'index') return instType === 'INDEX'
      if (filterType === 'derivatives') return isDerivativeType(instType) || Boolean(item.underlying)
      return true
    }

    const byExchange = (item: watchlistsApi.WatchlistItemOut) => {
      if (filterExchange === 'all') return true
      const g = exchangeGroup(item.instrument?.exchange ?? item.exchange)
      return g === filterExchange
    }

    const filtered = items.filter((i) => byText(i) && byType(i) && byExchange(i))

    if (sort === 'alpha') {
      return [...filtered].sort((a, b) => titleForItem(a).localeCompare(titleForItem(b)))
    }
    return filtered
  }, [filterExchange, filterType, items, q, sort])

  useEffect(() => {
    if (!controlsOpen) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-watchlist-controls]')) return
      setControlsOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [controlsOpen])

  return (
    <div className={cn('space-y-6', isCompact && 'space-y-3')}>
      {banner ? (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div>{banner}</div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setBanner(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader className={cn('space-y-4', isCompact && 'space-y-3')}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <CardTitle className={cn('text-base', isCompact && 'text-sm')}>Watchlist</CardTitle>
              {!isCompact ? (
                <div className="text-xs text-muted-foreground">
                  Compact working set. Rows are optimized for fast Buy/Sell; quotes will layer in later.
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 text-sm">
                <select
                  value={broker}
                  onChange={(e) => void updateLastUsedBroker(e.target.value)}
                  className={cn(
                    'h-9 rounded-md border bg-background px-2 text-sm outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring',
                    isCompact && 'h-8 text-xs',
                  )}
                  aria-label="Broker"
                >
                  {BROKER_OPTIONS.map((b) => (
                    <option key={b.key} value={b.key}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <span
                  className={cn(
                    'text-[11px]',
                    brokerState?.connected ? 'text-emerald-600' : 'text-muted-foreground',
                  )}
                >
                  {brokerState?.connected ? 'Connected' : 'Not connected'}
                </span>
              </div>

              <div className="flex items-center gap-1 rounded-md border bg-background p-1">
                <Button
                  type="button"
                  size="icon"
                  variant={watchlistMode === 'compact' ? 'secondary' : 'ghost'}
                  aria-label="Watchlist mode: compact"
                  title="Compact"
                  onClick={() => setWatchlistMode('compact')}
                  className="h-8 w-8"
                >
                  <Minimize2 />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant={watchlistMode === 'standard' ? 'secondary' : 'ghost'}
                  aria-label="Watchlist mode: standard"
                  title="Standard"
                  onClick={() => setWatchlistMode('standard')}
                  className="h-8 w-8"
                >
                  <Square />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant={watchlistMode === 'wide' ? 'secondary' : 'ghost'}
                  aria-label="Watchlist mode: wide"
                  title="Wide"
                  onClick={() => setWatchlistMode('wide')}
                  className="h-8 w-8"
                >
                  <Maximize2 />
                </Button>
              </div>

              <div className="relative" data-watchlist-controls>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Watchlist filters"
                  onClick={() => setControlsOpen((v) => !v)}
                >
                  <Filter />
                </Button>
                {controlsOpen ? (
                  <div className="absolute right-0 top-[44px] z-20 w-64 rounded-md border bg-card p-3 shadow-sm">
                    <div className="space-y-3 text-sm">
                      <div className="font-medium">View</div>
                      <div className="space-y-2">
                        <label className="block text-xs text-muted-foreground">Type</label>
                        <select
                          value={filterType}
                          onChange={(e) => setFilterType(e.target.value as typeof filterType)}
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="all">All</option>
                          <option value="equity">Equity</option>
                          <option value="index">Index</option>
                          <option value="derivatives">Derivatives</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="block text-xs text-muted-foreground">Exchange</label>
                        <select
                          value={filterExchange}
                          onChange={(e) => setFilterExchange(e.target.value as typeof filterExchange)}
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="all">All</option>
                          <option value="nse">NSE</option>
                          <option value="bse">BSE</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="block text-xs text-muted-foreground">Sort</label>
                        <select
                          value={sort}
                          onChange={(e) => setSort(e.target.value as typeof sort)}
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="manual">Watchlist order</option>
                          <option value="alpha">Alphabetical</option>
                        </select>
                      </div>
                      <div className="flex items-center justify-between gap-2 pt-2">
                        <Button type="button" size="sm" variant="outline" onClick={resetView}>
                          Reset
                        </Button>
                        <Button type="button" size="sm" onClick={() => setControlsOpen(false)}>
                          Done
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Watchlist settings"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Refresh watchlist"
                onClick={() => void watchlistItems.refetch()}
                disabled={!activeId}
              >
                <span className="text-xs font-semibold">↻</span>
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-1 overflow-x-auto">
              {watchlistTabs.map((wl) => {
                const activeTab = activeId === wl.id
                return (
                  <button
                    key={wl.id}
                    type="button"
                    onClick={() => {
                      setActiveIdOverride(wl.id)
                      setStoredActiveId(wl.id)
                    }}
                    className={cn(
                      'rounded-md px-3 py-1 text-sm whitespace-nowrap',
                      activeTab ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
                    )}
                  >
                    <span className="font-medium">{wl.name}</span>
                    {wl.is_default ? <span className="ml-1 text-[11px] text-muted-foreground/80">★</span> : null}
                  </button>
                )
              })}
              <Button type="button" size="icon" variant="ghost" aria-label="New watchlist" onClick={() => setSettingsOpen(true)}>
                <Plus />
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="flex items-center gap-2">
              <Input
                ref={(el) => {
                  inputRef.current = el
                }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => setSearchFocused(false), 120)
                }}
                placeholder={
                  isCompact
                    ? 'Search…'
                    : 'Search watchlist / add instruments… (e.g. INFY, NIFTY, NIFTY 24150 CE)'
                }
                aria-label="Watchlist add search"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!activeId) return
                  const u = q.trim().toUpperCase()
                  if (!u) return
                  void addUnderlying.mutate({ watchlistId: activeId, underlying: u })
                  setQ('')
                  inputRef.current?.focus()
                }}
                disabled={!activeId || !q.trim()}
                className={cn(isCompact && 'hidden')}
              >
                Add underlying
              </Button>
              {isCompact ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Add underlying"
                  onClick={() => {
                    if (!activeId) return
                    const u = q.trim().toUpperCase()
                    if (!u) return
                    void addUnderlying.mutate({ watchlistId: activeId, underlying: u })
                    setQ('')
                    inputRef.current?.focus()
                  }}
                  disabled={!activeId || !q.trim()}
                >
                  <Plus />
                </Button>
              ) : null}
            </div>

            {searchFocused && q.trim().length > 0 ? (
              <div
                className="absolute left-0 right-0 top-[46px] z-10 max-h-[320px] overflow-auto rounded-md border bg-card shadow-sm"
                onMouseDown={(e) => e.preventDefault()}
              >
                {addSearch.isFetching ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">Searching…</div>
                ) : null}
                {(addSearch.data?.items ?? []).map((i) => (
                  <button
                    key={i.canonical_id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm hover:bg-accent/20"
                    onClick={() => {
                      if (!activeId) return
                      void addItem.mutate({ watchlistId: activeId, canonicalId: i.canonical_id })
                      setQ('')
                      inputRef.current?.focus()
                    }}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{i.display_symbol}</div>
                      {!isCompact ? (
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{i.canonical_id}</div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{typeLabel(i, null)}</Badge>
                      <Badge variant="outline">{i.exchange}</Badge>
                    </div>
                  </button>
                ))}
                {!addSearch.isFetching && (addSearch.data?.items ?? []).length === 0 ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground">No matches.</div>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardHeader>

        <CardContent>
          {!items.length ? (
            <div className="rounded-md border bg-muted/20 p-4 text-sm">
              <div className="font-medium">Empty watchlist</div>
              <div className="mt-1 text-muted-foreground">
                Use the embedded search above to add instruments, or discover in Search and add from there.
              </div>
              <div className="mt-3 flex gap-2">
                <Button type="button" variant="outline" onClick={() => navigate('/search')}>
                  Go to Search
                </Button>
                <Button type="button" onClick={() => setSettingsOpen(true)}>
                  Manage watchlists
                </Button>
              </div>
            </div>
          ) : !filteredItems.length ? (
            <div className="rounded-md border bg-muted/20 p-4 text-sm">
              <div className="font-medium">No matches</div>
              <div className="mt-1 text-muted-foreground">
                Adjust filters or clear the search box to see all items.
              </div>
              <div className="mt-3 flex gap-2">
                <Button type="button" variant="outline" onClick={() => setQ('')}>
                  Clear search
                </Button>
                <Button type="button" variant="outline" onClick={resetView}>
                  Reset filters
                </Button>
              </div>
            </div>
          ) : (
            <div data-testid="watchlist-items" className="divide-y rounded-md border bg-card">
              {filteredItems.map((item, idx) => {
                const inst = item.instrument
                const canonicalId = item.canonical_id
                const hasPos = canonicalId ? positionSet.has(canonicalId) : false
                const hasOpenOrder = canonicalId ? openOrderSet.has(canonicalId) : false
                const ltp = canonicalId ? getPremium(canonicalId) : null
                const u = (inst?.underlying ?? item.underlying ?? inst?.symbol_root ?? '').trim().toUpperCase()
                const spot = u ? getSpot(u) : null
                const showActions = activeRowId === item.id || isWide

                return (
                  <div
                    key={item.id}
                    data-testid={`watchlist-row-${item.id}`}
                    className={cn(
                      'group flex items-center justify-between gap-3 px-3 py-2',
                      'hover:bg-accent/20',
                      isCompact && 'py-1.5',
                    )}
                    tabIndex={0}
                    onMouseEnter={() => setActiveRowId(item.id)}
                    onMouseLeave={() => setActiveRowId((v) => (v === item.id ? null : v))}
                    onFocus={() => setActiveRowId(item.id)}
                    onBlur={() => setActiveRowId((v) => (v === item.id ? null : v))}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 truncate font-medium">
                          {isCompact ? compactTitleForItem(item) : titleForItem(item)}
                        </div>
                        {!isCompact ? (
                          <div className="flex items-center gap-1">
                            <Badge variant="outline">{typeLabel(inst, item.instrument_type)}</Badge>
                            {(inst?.exchange ?? item.exchange) ? (
                              <Badge variant="outline">{inst?.exchange ?? item.exchange}</Badge>
                            ) : null}
                            {hasPos ? <Badge variant="outline">POS</Badge> : null}
                            {hasOpenOrder ? <Badge variant="outline">ORD</Badge> : null}
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground">
                            {typeLabel(inst, item.instrument_type)}
                          </div>
                        )}
                      </div>

                      {!isCompact ? (
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {inst?.instrument_type === 'OPTION' || inst?.instrument_type === 'FUTURE'
                            ? `${u}${inst.expiry ? ` • ${formatExpiryHuman(inst.expiry)}` : ''}`
                            : item.canonical_id ?? item.symbol_key}
                        </div>
                      ) : inst?.expiry ? (
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {formatExpiryHuman(inst.expiry)}
                        </div>
                      ) : null}
                    </div>

                    {!isCompact ? (
                      <div className="hidden sm:flex w-20 shrink-0 flex-col items-end">
                        <div className="font-medium tabular-nums">
                          {ltp != null ? ltp.toFixed(2) : '—'}
                        </div>
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          {spot != null ? `Spot ${spot.toFixed(0)}` : '—'}
                        </div>
                      </div>
                    ) : null}

                    <div className="shrink-0">
                      {showActions ? (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-emerald-700 dark:text-emerald-300"
                            onClick={() => openTrade(item, 'BUY')}
                            disabled={!item.instrument && !item.underlying}
                            aria-label="Buy"
                          >
                            {isWide ? 'Buy' : 'B'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="text-red-700 dark:text-red-300"
                            onClick={() => openTrade(item, 'SELL')}
                            disabled={!item.instrument && !item.underlying}
                            aria-label="Sell"
                          >
                            {isWide ? 'Sell' : 'S'}
                          </Button>

                          {!isCompact ? (
                            <>
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                aria-label="View orders"
                                onClick={() => navigate(`/orders?q=${encodeURIComponent(item.display_symbol)}`)}
                              >
                                <ReceiptText />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                aria-label="View positions"
                                onClick={() => navigate(`/positions?q=${encodeURIComponent(item.display_symbol)}`)}
                              >
                                <Briefcase />
                              </Button>
                            </>
                          ) : null}

                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            aria-label="Remove from watchlist"
                            onClick={() => {
                              if (!activeId) return
                              void removeItem.mutate({ watchlistId: activeId, itemId: item.id })
                            }}
                          >
                            <Trash2 />
                          </Button>

                          {isWide && !isDerivativeType(inst?.instrument_type ?? item.instrument_type) ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="outline"
                              aria-label="More actions"
                              onClick={() => navigate(`/search?q=${encodeURIComponent(item.display_symbol)}`)}
                            >
                              <MoreHorizontal />
                            </Button>
                          ) : null}

                          {canReorder ? (
                            <div className="ml-1 flex items-center gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label="Move up"
                                disabled={idx === 0}
                                onClick={() => {
                                  if (!activeId) return
                                  const next = filteredItems.map((i) => i.id)
                                  ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
                                  void reorder.mutate({ watchlistId: activeId, itemIds: next })
                                }}
                              >
                                <ArrowUp />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label="Move down"
                                disabled={idx === filteredItems.length - 1}
                                onClick={() => {
                                  if (!activeId) return
                                  const next = filteredItems.map((i) => i.id)
                                  ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
                                  void reorder.mutate({ watchlistId: activeId, itemIds: next })
                                }}
                              >
                                <ArrowDown />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="Focus row actions"
                          onClick={() => setActiveRowId(item.id)}
                        >
                          <MoreHorizontal />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Watchlist settings</DialogTitle>
            <DialogDescription>
              Manage watchlists and defaults. Display/market columns will expand in later milestones.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="text-sm font-medium">Watchlists</div>
              <div className="space-y-2">
                {watchlistTabs.map((wl) => (
                  <div key={wl.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-2">
                    <div className="min-w-0 flex-1">
                      {editingId === wl.id ? (
                        <Input value={editingName} onChange={(e) => setEditingName(e.target.value)} />
                      ) : (
                        <div className="truncate font-medium">{wl.name}</div>
                      )}
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {wl.is_default ? 'Default' : '—'} {activeId === wl.id ? '• Active' : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void updateWl.mutate({ id: wl.id, is_default: true })}
                        disabled={wl.is_default}
                      >
                        ★
                      </Button>
                      {editingId === wl.id ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              void updateWl.mutate({ id: wl.id, name: editingName.trim() })
                              setEditingId(null)
                              setEditingName('')
                            }}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingId(null)
                              setEditingName('')
                            }}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          aria-label="Rename watchlist"
                          onClick={() => {
                            setEditingId(wl.id)
                            setEditingName(wl.name)
                          }}
                        >
                          <Pencil />
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        aria-label="Delete watchlist"
                        onClick={() => void deleteWl.mutate(wl.id)}
                        disabled={watchlistTabs.length <= 1}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-medium">Create</div>
              <div className="flex flex-wrap items-center gap-2">
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New watchlist name" />
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={makeDefault}
                    onChange={(e) => setMakeDefault(e.target.checked)}
                  />
                  Make default
                </label>
                <Button
                  type="button"
                  onClick={() => {
                    const name = newName.trim()
                    if (!name) return
                    void createWl.mutate({ name, make_default: makeDefault })
                    setNewName('')
                    setMakeDefault(false)
                  }}
                >
                  Create
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {stockLaunch ? (
        <StockOrderDialog key={dialogKey} open={stockDialogOpen} onOpenChange={(v) => (v ? setStockDialogOpen(true) : closeDialogs())} launch={stockLaunch} />
      ) : null}
      {fnoLaunch ? (
        <FnoOrderDialog key={dialogKey} open={fnoDialogOpen} onOpenChange={(v) => (v ? setFnoDialogOpen(true) : closeDialogs())} launch={fnoLaunch} />
      ) : null}
    </div>
  )
}
