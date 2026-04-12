import { type ComponentProps, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Briefcase,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  Square,
  Settings,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import * as brokersApi from '@/lib/api/brokers'
import * as instrumentsApi from '@/lib/api/instruments'
import * as ordersApi from '@/lib/api/orders'
import * as positionsApi from '@/lib/api/positions'
import * as quotesApi from '@/lib/api/quotes'
import * as watchlistsApi from '@/lib/api/watchlists'
import { cn } from '@/lib/utils'
import { formatStrikeHuman } from '@/lib/format'
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

type WatchlistSearchScope = 'all' | 'cash' | 'fno' | 'indices'

function typeLabel(i: instrumentsApi.InstrumentOut | null, fallback: string | null) {
  const t = i?.instrument_type ?? fallback ?? '—'
  if (t === 'OPTION') return 'Option'
  if (t === 'FUTURE') return 'Future'
  if (t === 'ETF') return 'ETF'
  if (t === 'INDEX') return 'Index'
  if (t === 'EQUITY') return 'Equity'
  return t
}

function typeBadge(i: instrumentsApi.InstrumentOut): { label: string; className: string } {
  if (i.instrument_type === 'OPTION') return { label: 'OPT', className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' }
  if (i.instrument_type === 'FUTURE') return { label: 'FUT', className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
  if (i.instrument_type === 'INDEX') return { label: 'IDX', className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' }
  if (i.instrument_type === 'ETF') return { label: 'ETF', className: 'bg-teal-500/10 text-teal-700 dark:text-teal-300' }
  return { label: 'EQ', className: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }
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

function titleForInstrument(i: instrumentsApi.InstrumentOut) {
  const root = (i.underlying ?? i.symbol_root).toUpperCase()
  if (i.instrument_type === 'OPTION') {
    return `${root} ${formatExpiryHuman(i.expiry)} ${formatStrikeHuman(i.strike, root)} ${i.option_type ?? ''}`.trim()
  }
  if (i.instrument_type === 'FUTURE') {
    return `${root} ${formatExpiryHuman(i.expiry)} FUT`.trim()
  }
  return i.display_symbol
}

function formatLtp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toFixed(2)
}

function formatChangeLine(change: number | null | undefined, pct: number | null | undefined): string {
  const hasChange = change != null && Number.isFinite(change)
  const hasPct = pct != null && Number.isFinite(pct)
  if (!hasChange && !hasPct) return '—'

  const c = hasChange ? Number(change) : null
  const p = hasPct ? Number(pct) : null

  const sign = c != null && c > 0 ? '+' : ''
  const cStr = c != null ? `${sign}${c.toFixed(2)}` : '—'
  const pStr = p != null ? `${p > 0 ? '+' : ''}${p.toFixed(2)}%` : '—'
  return `${cStr} (${pStr})`
}

function titleForItem(item: watchlistsApi.WatchlistItemOut) {
  const inst = item.instrument
  if (!inst) return item.display_symbol
  const root = (inst.underlying ?? inst.symbol_root).toUpperCase()
  if (inst.instrument_type === 'OPTION') {
    return `${root} ${formatExpiryHuman(inst.expiry)} ${formatStrikeHuman(inst.strike, root)} ${inst.option_type ?? ''}`.trim()
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
    const strike = formatStrikeHuman(inst.strike, root)
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
  const [rowMenuOpenId, setRowMenuOpenId] = useState<number | null>(null)
  const [scope, setScope] = useState<WatchlistSearchScope>('all')

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
      if (['ACKNOWLEDGED', 'PENDING', 'OPEN', 'PARTIAL'].includes(s)) set.add(o.canonical_id)
    }
    return set
  }, [orders.data])

  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [searchFocused, setSearchFocused] = useState(false)

  const addSearch = useQuery({
    queryKey: ['watchlist', 'add', q, scope],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      const trimmed = q.trim()
      if (!trimmed) return { items: [] }

      if (scope === 'cash') {
        return instrumentsApi.searchInstruments(accessToken, { q: trimmed, limit: 25, segment: 'EQUITY' })
      }
      if (scope === 'indices') {
        return instrumentsApi.searchInstruments(accessToken, { q: trimmed, limit: 25, instrument_type: 'INDEX' })
      }
      if (scope === 'fno') {
        const [futs, opts, idx] = await Promise.all([
          instrumentsApi.searchInstruments(accessToken, { q: trimmed, limit: 15, instrument_type: 'FUTURE' }),
          instrumentsApi.searchInstruments(accessToken, { q: trimmed, limit: 20, instrument_type: 'OPTION' }),
          instrumentsApi.searchInstruments(accessToken, { q: trimmed, limit: 10, instrument_type: 'INDEX' }),
        ])
        const map = new Map<string, instrumentsApi.InstrumentOut>()
        for (const i of [...(futs.items ?? []), ...(opts.items ?? []), ...(idx.items ?? [])]) {
          map.set(i.canonical_id, i)
        }
        const items = Array.from(map.values())
        const order = (t: instrumentsApi.InstrumentType) =>
          t === 'FUTURE' ? 0 : t === 'OPTION' ? 1 : t === 'INDEX' ? 2 : 9
        items.sort((a, b) => {
          const t = order(a.instrument_type) - order(b.instrument_type)
          if (t) return t
          const ea = a.expiry ?? ''
          const eb = b.expiry ?? ''
          if (ea !== eb) return ea < eb ? -1 : 1
          const sa = a.strike ?? 0
          const sb = b.strike ?? 0
          if (sa !== sb) return sa - sb
          const oa = a.option_type ?? ''
          const ob = b.option_type ?? ''
          if (oa !== ob) return oa < ob ? -1 : 1
          return a.display_symbol.localeCompare(b.display_symbol)
        })
        return { items }
      }

      return instrumentsApi.searchInstruments(accessToken, { q: trimmed, limit: 25 })
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

  const openTradeInstrument = (inst: instrumentsApi.InstrumentOut, side: ordersApi.OrderSide) => {
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

    if (inst.instrument_type === 'INDEX') {
      const u = (inst.underlying ?? inst.symbol_root ?? inst.display_symbol).trim().toUpperCase()
      setFnoLaunch({ mode: 'manual', broker, prefill: { underlying: u, side } })
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
  const watchlistCanonicalSet = useMemo(() => {
    const set = new Set<string>()
    for (const i of items) if (i.canonical_id) set.add(i.canonical_id)
    return set
  }, [items])
  const brokerState = brokerStatus.data?.find((b) => b.broker === broker) ?? null
  const watchlistTabs = useMemo(() => watchlists.data?.items ?? [], [watchlists.data])

  const canonicalIds = useMemo(() => {
    const ids: string[] = []
    for (const item of items) {
      if (item.canonical_id) ids.push(item.canonical_id)
    }
    return ids
  }, [items])

  const quotes = useQuery({
    queryKey: ['quotes', broker, canonicalIds.join(',')],
    queryFn: async () => {
      if (!accessToken || !canonicalIds.length) return { broker, items: [], warning: null }
      return quotesApi.getQuotes(accessToken, { broker, canonical_ids: canonicalIds.slice(0, 60) })
    },
    enabled: Boolean(accessToken) && canonicalIds.length > 0 && Boolean(brokerState?.connected),
    refetchInterval: 7_000,
    retry: false,
  })

  const quoteByCanonicalId = useMemo(() => {
    const map = new Map<string, quotesApi.QuoteOut>()
    for (const q of quotes.data?.items ?? []) {
      map.set(q.canonical_id, q)
    }
    return map
  }, [quotes.data])

  const [newName, setNewName] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')

  const isCompact = watchlistMode === 'compact'

  const filteredItems = useMemo(() => {
    const needle = q.trim().toLowerCase()

    const byText = (item: watchlistsApi.WatchlistItemOut) => {
      if (!needle) return true
      const title = titleForItem(item).toLowerCase()
      const canon = (item.canonical_id ?? item.symbol_key).toLowerCase()
      const under = (item.underlying ?? '').toLowerCase()
      return title.includes(needle) || canon.includes(needle) || under.includes(needle)
    }

    return items.filter((i) => byText(i))
  }, [items, q])

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
            <div className="flex-1 min-w-[140px] space-y-1">
              <CardTitle className={cn('text-base', isCompact && 'text-sm')}>Watchlist</CardTitle>
              {!isCompact ? (
                <div className="text-xs text-muted-foreground truncate whitespace-nowrap">
                  Fast Buy/Sell actions. Quotes will layer in later.
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
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
                    isCompact && 'hidden',
                  )}
                >
                  {brokerState?.connected ? 'Connected' : 'Not connected'}
                </span>
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
                onChange={(e) => {
                  const next = e.target.value
                  setQ(next)
                  if (!next.trim()) setScope('all')
                }}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => {
                  window.setTimeout(() => setSearchFocused(false), 120)
                }}
                placeholder={
                  isCompact
                    ? 'Search…'
                    : 'Search watchlist / add instruments…'
                }
                aria-label="Watchlist add search"
              />
              {q.trim() ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Clear search"
                  onClick={() => {
                    setQ('')
                    inputRef.current?.focus()
                  }}
                >
                  ×
                </Button>
              ) : null}
            </div>

            {searchFocused && q.trim().length > 0 ? (
              <div className="mt-2 flex items-center gap-1">
                {(
                  [
                    { key: 'all', label: 'All' },
                    { key: 'indices', label: 'Indices' },
                    { key: 'cash', label: 'Cash' },
                    { key: 'fno', label: 'F&O' },
                  ] as const
                ).map((t) => (
                  <Button
                    key={t.key}
                    type="button"
                    size="sm"
                    variant={scope === t.key ? 'secondary' : 'ghost'}
                    onClick={() => setScope(t.key)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        </CardHeader>

        <CardContent>
          {searchFocused && q.trim().length > 0 ? (
            <div className="rounded-md border bg-card overflow-hidden">
              <div className="max-h-[420px] overflow-auto">
                {addSearch.isFetching ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">Searching…</div>
                ) : null}
                {(addSearch.data?.items ?? []).map((i) => {
                  const badge = typeBadge(i)
                  const already = watchlistCanonicalSet.has(i.canonical_id)
                  return (
                    <div
                      key={i.canonical_id}
                      className="group flex items-center justify-between gap-3 border-b px-3 py-2 hover:bg-accent/20"
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          if (!activeId) return
                          if (already) return
                          void addItem.mutate({ watchlistId: activeId, canonicalId: i.canonical_id })
                          setQ('')
                          inputRef.current?.focus()
                        }}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <div className={cn('flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold', badge.className)}>
                            {badge.label}
                          </div>
                          <div className="min-w-0">
                            <div
                              className="font-medium leading-tight break-words"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {titleForInstrument(i)}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {i.exchange} • {typeLabel(i, null)}
                            </div>
                          </div>
                        </div>
                      </button>

                      <div
                        className={cn(
                          'flex items-center gap-1 opacity-0 transition-opacity',
                          'group-hover:opacity-100 group-focus-within:opacity-100',
                        )}
                      >
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="h-7 w-7 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                          onClick={() => openTradeInstrument(i, 'BUY')}
                          aria-label="Buy"
                          title="Buy"
                        >
                          B
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="h-7 w-7 bg-red-500/10 hover:bg-red-500/15 text-red-800 dark:text-red-200"
                          onClick={() => openTradeInstrument(i, 'SELL')}
                          aria-label="Sell"
                          title="Sell"
                        >
                          S
                        </Button>
                      </div>

                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={already ? 'Already in watchlist' : 'Add to watchlist'}
                        disabled={already || !activeId}
                        onClick={() => {
                          if (!activeId) return
                          if (already) return
                          void addItem.mutate({ watchlistId: activeId, canonicalId: i.canonical_id })
                          setQ('')
                          inputRef.current?.focus()
                        }}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )
                })}

                {!addSearch.isFetching && (addSearch.data?.items ?? []).length === 0 ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground">No matches.</div>
                ) : null}

                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent/20"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (!activeId) return
                    const u = q.trim().toUpperCase()
                    if (!u) return
                    void addUnderlying.mutate({ watchlistId: activeId, underlying: u })
                    setQ('')
                    inputRef.current?.focus()
                  }}
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">Add instrument</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      Add “{q.trim().toUpperCase()}” as a symbol/underlying anchor
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                  </div>
                </button>
              </div>
            </div>
          ) : null}

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
                Clear the search box to see all items.
              </div>
              <div className="mt-3 flex gap-2">
                <Button type="button" variant="outline" onClick={() => setQ('')}>
                  Clear search
                </Button>
              </div>
            </div>
          ) : (
            <div data-testid="watchlist-items" className="divide-y rounded-md border bg-card">
              {filteredItems.map((item) => {
                const inst = item.instrument
                const canonicalId = item.canonical_id
                const hasPos = canonicalId ? positionSet.has(canonicalId) : false
                const hasOpenOrder = canonicalId ? openOrderSet.has(canonicalId) : false
                const q = canonicalId ? quoteByCanonicalId.get(canonicalId) : null
                const ltp = q?.ltp ?? null
                const chg = q?.change ?? null
                const chgPct = q?.change_percent ?? null
                const changeUp = (chgPct ?? chg ?? 0) > 0
                const changeDown = (chgPct ?? chg ?? 0) < 0

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
                    onMouseLeave={() => setRowMenuOpenId((v) => (v === item.id ? null : v))}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 truncate font-medium">
                          {isCompact ? compactTitleForItem(item) : titleForItem(item)}
                        </div>
                      </div>

                      {!isCompact ? (
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          <span className="mr-2">
                            {(inst?.exchange ?? item.exchange) ? (inst?.exchange ?? item.exchange) : '—'}
                          </span>
                          <span className="mr-2">{typeLabel(inst, item.instrument_type)}</span>
                          {inst?.expiry ? <span className="mr-2">• {formatExpiryHuman(inst.expiry)}</span> : null}
                          {inst?.strike != null ? (
                            <span className="mr-2">• {formatStrikeHuman(inst.strike, inst.underlying ?? inst.symbol_root)}</span>
                          ) : null}
                          {inst?.option_type ? <span className="mr-2">• {inst.option_type}</span> : null}
                          {hasPos ? <span className="mr-2">• POS</span> : null}
                          {hasOpenOrder ? <span className="mr-2">• ORD</span> : null}
                        </div>
                      ) : inst?.expiry ? (
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {formatExpiryHuman(inst.expiry)}
                        </div>
                      ) : null}
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      <div
                        className={cn(
                          'relative flex items-center gap-1 opacity-0 transition-opacity',
                          'group-hover:opacity-100 group-focus-within:opacity-100',
                        )}
                      >
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className={cn(
                            'h-7 w-7 text-emerald-800 dark:text-emerald-200',
                            'bg-emerald-500/10 hover:bg-emerald-500/15',
                          )}
                          onClick={() => openTrade(item, 'BUY')}
                          disabled={!item.instrument && !item.underlying}
                          aria-label="Buy"
                          title="Buy"
                        >
                          B
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className={cn(
                            'h-7 w-7 text-red-800 dark:text-red-200',
                            'bg-red-500/10 hover:bg-red-500/15',
                          )}
                          onClick={() => openTrade(item, 'SELL')}
                          disabled={!item.instrument && !item.underlying}
                          aria-label="Sell"
                          title="Sell"
                        >
                          S
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label="More"
                          title="More"
                          onClick={() => setRowMenuOpenId((v) => (v === item.id ? null : item.id))}
                          className="h-7 w-7"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>

                        {rowMenuOpenId === item.id ? (
                          <div
                            className="absolute right-0 top-[44px] z-20 w-44 rounded-md border bg-card p-1 shadow-sm"
                            onMouseDown={(e) => e.preventDefault()}
                          >
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent/20"
                              onClick={() => {
                                setRowMenuOpenId(null)
                                navigate(`/orders?q=${encodeURIComponent(item.display_symbol)}`)
                              }}
                            >
                              <ReceiptText className="h-4 w-4" />
                              Orders
                            </button>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent/20"
                              onClick={() => {
                                setRowMenuOpenId(null)
                                navigate(`/positions?q=${encodeURIComponent(item.display_symbol)}`)
                              }}
                            >
                              <Briefcase className="h-4 w-4" />
                              Positions
                            </button>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent/20"
                              onClick={() => {
                                setRowMenuOpenId(null)
                                if (!activeId) return
                                void removeItem.mutate({ watchlistId: activeId, itemId: item.id })
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              Remove
                            </button>
                          </div>
                        ) : null}
                      </div>

                      <div className={cn('w-[92px] text-right', isCompact && 'w-[70px]')}>
                        <div className="font-medium tabular-nums">{formatLtp(ltp)}</div>
                        {!isCompact ? (
                          <div
                            className={cn(
                              'text-[11px] tabular-nums',
                              changeUp && 'text-emerald-600',
                              changeDown && 'text-red-600',
                              !changeUp && !changeDown && 'text-muted-foreground',
                            )}
                          >
                            {formatChangeLine(chg, chgPct)}
                          </div>
                        ) : null}
                      </div>
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
              <div className="text-sm font-medium">Layout</div>
              <div className="flex items-center gap-1 rounded-md border bg-background p-1">
                <Button
                  type="button"
                  size="icon"
                  variant={watchlistMode === 'compact' ? 'secondary' : 'ghost'}
                  aria-label="Watchlist mode: compact"
                  title="Compact"
                  onClick={() => setWatchlistMode('compact')}
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
                >
                  <Maximize2 />
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Standard is the recommended daily mode. Compact reduces chrome; Wide reserves space for future quotes/metadata.
              </div>
            </div>
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
