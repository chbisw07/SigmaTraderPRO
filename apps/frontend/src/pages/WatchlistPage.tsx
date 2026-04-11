import { type ComponentProps, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  Briefcase,
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

  const [activeIdOverride, setActiveIdOverride] = useState<number | null>(() => safeStoredActiveId())
  const [banner, setBanner] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  const [addQ, setAddQ] = useState('')
  const addSearch = useQuery({
    queryKey: ['watchlist', 'add', addQ],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      return instrumentsApi.searchInstruments(accessToken, { q: addQ, limit: 20 })
    },
    enabled: Boolean(accessToken) && addQ.trim().length > 0,
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

  const items = watchlistItems.data?.items ?? []
  const brokerState = brokerStatus.data?.find((b) => b.broker === broker) ?? null
  const watchlistTabs = watchlists.data?.items ?? []

  const [newName, setNewName] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')

  const isCompact = watchlistMode === 'compact'
  const isWide = watchlistMode === 'wide'

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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className={cn('text-base', isCompact && 'text-sm')}>Watchlist</CardTitle>
              {!isCompact ? (
                <div className="text-xs text-muted-foreground">
                  Broker-style working set with embedded search and quick trade actions.
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 text-sm">
                {!isCompact ? <span className="text-xs text-muted-foreground">Broker</span> : null}
                <select
                  value={broker}
                  onChange={(e) => void updateLastUsedBroker(e.target.value)}
                  className={cn(
                    'h-9 rounded-md border bg-background px-2 text-sm outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring',
                    isCompact && 'h-8 text-xs',
                  )}
                >
                  {BROKER_OPTIONS.map((b) => (
                    <option key={b.key} value={b.key}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <span className={cn('ml-2 text-xs', brokerState?.connected ? 'text-emerald-600' : 'text-muted-foreground')}>
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
              <Button type="button" size="icon" variant="outline" aria-label="Watchlist settings" onClick={() => setSettingsOpen(true)}>
                <Settings />
              </Button>
              <Button type="button" size="icon" variant="outline" aria-label="Refresh watchlist" onClick={() => void watchlistItems.refetch()} disabled={!activeId}>
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
                value={addQ}
                onChange={(e) => setAddQ(e.target.value)}
                placeholder={
                  isCompact
                    ? 'Search to add…'
                    : 'Search instruments to add… (e.g. INFY, NIFTY, NIFTY 24150 CE)'
                }
                aria-label="Watchlist add search"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!activeId) return
                  const u = addQ.trim().toUpperCase()
                  if (!u) return
                  void addUnderlying.mutate({ watchlistId: activeId, underlying: u })
                  setAddQ('')
                }}
                disabled={!activeId || !addQ.trim()}
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
                    const u = addQ.trim().toUpperCase()
                    if (!u) return
                    void addUnderlying.mutate({ watchlistId: activeId, underlying: u })
                    setAddQ('')
                  }}
                  disabled={!activeId || !addQ.trim()}
                >
                  <Plus />
                </Button>
              ) : null}
            </div>

            {addQ.trim().length > 0 ? (
              <div className="absolute left-0 right-0 top-[46px] z-10 max-h-[320px] overflow-auto rounded-md border bg-card shadow-sm">
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
                      setAddQ('')
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
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left">Instrument</th>
                    <th className="px-2 py-2 text-left">Type</th>
                    <th className="px-2 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item, idx) => {
                    const canonicalId = item.canonical_id
                    const hasPos = canonicalId ? positionSet.has(canonicalId) : false
                    const hasOpenOrder = canonicalId ? openOrderSet.has(canonicalId) : false
                    return (
                      <tr key={item.id} className="hover:bg-accent/20">
                        <td className={cn('px-2 py-2', isCompact && 'py-1.5')}>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium">
                              {isCompact ? compactTitleForItem(item) : titleForItem(item)}
                            </div>
                            {!isCompact && hasPos ? <Badge variant="outline">POS</Badge> : null}
                            {!isCompact && hasOpenOrder ? <Badge variant="outline">ORD</Badge> : null}
                            {!isCompact && item.exchange ? <Badge variant="outline">{item.exchange}</Badge> : null}
                            {isCompact && (hasPos || hasOpenOrder) ? (
                              <span className="text-[11px] text-muted-foreground">
                                {hasPos ? '• POS' : ''} {hasOpenOrder ? '• ORD' : ''}
                              </span>
                            ) : null}
                          </div>
                          {!isCompact ? (
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {item.canonical_id ?? item.symbol_key}
                            </div>
                          ) : item.instrument?.expiry ? (
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {formatExpiryHuman(item.instrument.expiry)}
                            </div>
                          ) : null}
                        </td>
                        <td className={cn('px-2 py-2', isCompact && 'py-1.5')}>
                          <Badge variant="outline">{typeLabel(item.instrument, item.instrument_type)}</Badge>
                        </td>
                        <td className={cn('px-2 py-2 text-right', isCompact && 'py-1.5')}>
                          <div className="flex justify-end gap-2">
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
                            {!isCompact ? (
                              <div className="ml-2 flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  aria-label="Move up"
                                  disabled={idx === 0}
                                  onClick={() => {
                                    if (!activeId) return
                                    const next = items.map((i) => i.id)
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
                                  disabled={idx === items.length - 1}
                                  onClick={() => {
                                    if (!activeId) return
                                    const next = items.map((i) => i.id)
                                    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
                                    void reorder.mutate({ watchlistId: activeId, itemIds: next })
                                  }}
                                >
                                  <ArrowDown />
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
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
