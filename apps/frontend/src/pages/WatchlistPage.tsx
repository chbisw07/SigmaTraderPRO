import { type ComponentProps, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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

function titleForItem(item: watchlistsApi.WatchlistItemOut) {
  const inst = item.instrument
  if (!inst) return item.display_symbol
  const root = (inst.underlying ?? inst.symbol_root).toUpperCase()
  if (inst.instrument_type === 'OPTION') {
    return `${root} ${inst.expiry ?? '—'} ${inst.strike ?? '—'} ${inst.option_type ?? ''}`.trim()
  }
  if (inst.instrument_type === 'FUTURE') {
    return `${root} ${inst.expiry ?? '—'} FUT`.trim()
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

  const [activeIdOverride, setActiveIdOverride] = useState<number | null>(() =>
    safeStoredActiveId(),
  )
  const [banner, setBanner] = useState<string | null>(null)

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
    mutationFn: async (name: string) => {
      if (!accessToken) throw new Error('no auth')
      return watchlistsApi.createWatchlist(accessToken, { name })
    },
    onSuccess: async () => {
      await watchlists.refetch()
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

  const [createName, setCreateName] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameId, setRenameId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [addQ, setAddQ] = useState('')
  const addSearch = useQuery({
    queryKey: ['watchlist', 'add', addQ],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      return instrumentsApi.searchInstruments(accessToken, { q: addQ, limit: 20 })
    },
    enabled: Boolean(accessToken) && addOpen && addQ.trim().length > 0,
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

  const openTrade = (item: watchlistsApi.WatchlistItemOut, side: ordersApi.OrderSide) => {
    const inst = item.instrument
    if (!inst) return
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

  const openUnderlyingTicket = (underlying: string) => {
    const u = underlying.trim().toUpperCase()
    if (!u) return
    setDialogKey([u, broker, 'underlying'].join(':'))
    setFnoLaunch({ mode: 'manual', broker, prefill: { underlying: u } })
    setFnoDialogOpen(true)
  }

  const active = watchlistItems.data?.watchlist ?? null
  const items = watchlistItems.data?.items ?? []
  const brokerState = brokerStatus.data?.find((b) => b.broker === broker) ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Watchlist</h1>
          <p className="text-sm text-muted-foreground">Daily working set for quick trade actions (canonical-first).</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-muted-foreground">Broker</span>
            <select
              value={broker}
              onChange={(e) => void updateLastUsedBroker(e.target.value)}
              className={cn('h-9 rounded-md border bg-background px-2 text-sm outline-none', 'focus-visible:ring-2 focus-visible:ring-ring')}
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
          <Button type="button" variant="outline" size="sm" onClick={() => void watchlists.refetch()}>
            Refresh
          </Button>
        </div>
      </div>

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

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lists</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(watchlists.data?.items ?? []).map((wl) => (
              <div
                key={wl.id}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-md border px-2 py-2',
                  activeId === wl.id ? 'bg-accent/20' : 'bg-background',
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left text-sm"
                  onClick={() => {
                    setActiveIdOverride(wl.id)
                    setStoredActiveId(wl.id)
                  }}
                >
                  <div className="truncate font-medium">{wl.name}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{wl.is_default ? 'Default' : '—'}</div>
                </button>
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
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRenameId(wl.id)
                      setRenameValue(wl.name)
                      setRenameOpen(true)
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void deleteWl.mutate(wl.id)}
                    disabled={(watchlists.data?.items ?? []).length <= 1}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}

            <div className="mt-3 flex gap-2">
              <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="New watchlist name" />
              <Button
                type="button"
                onClick={() => {
                  const name = createName.trim()
                  if (!name) return
                  void createWl.mutate(name)
                  setCreateName('')
                }}
              >
                Create
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{active ? active.name : 'Watchlist'}</CardTitle>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)} disabled={!activeId}>
                Add instrument
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void watchlistItems.refetch()} disabled={!activeId}>
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!items.length ? (
              <div className="rounded-md border bg-muted/20 p-4 text-sm">
                <div className="font-medium">Empty watchlist</div>
                <div className="mt-1 text-muted-foreground">Add instruments from Search or use “Add instrument”.</div>
                <div className="mt-3 flex gap-2">
                  <Button type="button" variant="outline" onClick={() => navigate('/search')}>
                    Go to Search
                  </Button>
                  <Button type="button" onClick={() => setAddOpen(true)}>
                    Add instrument
                  </Button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-2 py-2 text-left">Symbol</th>
                      <th className="px-2 py-2 text-left">Type</th>
                      <th className="px-2 py-2 text-left">Ctx</th>
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
                          <td className="px-2 py-2">
                            <div className="flex items-center gap-2">
                              <div className="font-medium">{titleForItem(item)}</div>
                              {hasPos ? <Badge variant="outline">POS</Badge> : null}
                              {hasOpenOrder ? <Badge variant="outline">ORD</Badge> : null}
                            </div>
                            <div className="mt-0.5 break-all text-[11px] text-muted-foreground">{item.canonical_id ?? item.symbol_key}</div>
                          </td>
                          <td className="px-2 py-2">
                            <Badge variant="outline">{typeLabel(item.instrument, item.instrument_type)}</Badge>
                          </td>
                          <td className="px-2 py-2 text-xs text-muted-foreground">{broker}</td>
                          <td className="px-2 py-2 text-right">
                            <div className="flex justify-end gap-2">
                              <Button type="button" size="sm" variant="outline" onClick={() => openTrade(item, 'BUY')} disabled={!item.instrument}>
                                Buy
                              </Button>
                              <Button type="button" size="sm" variant="outline" onClick={() => openTrade(item, 'SELL')} disabled={!item.instrument}>
                                Sell
                              </Button>
                              {!item.instrument && item.underlying ? (
                                <Button type="button" size="sm" variant="outline" onClick={() => openUnderlyingTicket(item.underlying ?? '')}>
                                  F&amp;O ticket
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => navigate(`/orders?q=${encodeURIComponent(item.display_symbol)}`)}
                              >
                                Orders
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => navigate(`/positions?q=${encodeURIComponent(item.display_symbol)}`)}
                              >
                                Positions
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (!activeId) return
                                  void removeItem.mutate({ watchlistId: activeId, itemId: item.id })
                                }}
                              >
                                Remove
                              </Button>
                              <div className="ml-2 flex items-center gap-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={idx === 0}
                                  onClick={() => {
                                    if (!activeId) return
                                    const next = items.map((i) => i.id)
                                    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
                                    void reorder.mutate({ watchlistId: activeId, itemIds: next })
                                  }}
                                >
                                  ↑
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={idx === items.length - 1}
                                  onClick={() => {
                                    if (!activeId) return
                                    const next = items.map((i) => i.id)
                                    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
                                    void reorder.mutate({ watchlistId: activeId, itemIds: next })
                                  }}
                                >
                                  ↓
                                </Button>
                              </div>
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
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename watchlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="Name" />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!renameId) return
                  void updateWl.mutate({ id: renameId, name: renameValue.trim() })
                  setRenameOpen(false)
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add instrument</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input value={addQ} onChange={(e) => setAddQ(e.target.value)} placeholder="Search instruments or type an underlying…" />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!activeId) return
                  const u = addQ.trim().toUpperCase()
                  if (!u) return
                  void addUnderlying.mutate({ watchlistId: activeId, underlying: u })
                }}
                disabled={!activeId || !addQ.trim()}
              >
                Add underlying
              </Button>
            </div>
            <div className="max-h-[320px] overflow-auto rounded-md border">
              {(addSearch.data?.items ?? []).map((i) => (
                <button
                  key={i.canonical_id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm hover:bg-accent/20"
                  onClick={() => {
                    if (!activeId) return
                    if (i.instrument_type === 'INDEX') {
                      const u = (i.underlying ?? i.symbol_root ?? i.display_symbol).trim().toUpperCase()
                      void addUnderlying.mutate({ watchlistId: activeId, underlying: u })
                      return
                    }
                    void addItem.mutate({ watchlistId: activeId, canonicalId: i.canonical_id })
                  }}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{i.display_symbol}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{i.canonical_id}</div>
                  </div>
                  <Badge variant="outline">{typeLabel(i, null)}</Badge>
                </button>
              ))}
              {!addSearch.isFetching && (addSearch.data?.items ?? []).length === 0 && addQ.trim().length > 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">No matches.</div>
              ) : null}
              {addQ.trim().length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">Type to search canonical instruments.</div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                Close
              </Button>
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
