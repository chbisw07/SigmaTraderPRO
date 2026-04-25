import { type ComponentProps, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
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
import { Badge } from '@/components/ui/badge'
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
import { computeAtmStrike } from '@/lib/moneyness'
import { StockOrderDialog } from '@/features/orders/StockOrderDialog'
import { FnoOrderDialog } from '@/features/orders/FnoOrderDialog'
import { useAuthStore } from '@/store/authStore'
import { useQuoteStore } from '@/store/quoteStore'
import { useWatchlistLayoutStore } from '@/store/watchlistLayoutStore'
import { WATCHLIST_ENTRY_LIMIT, WATCHLIST_SLOT_COUNT, useWatchlistStructureStore } from '@/store/watchlistStructureStore'

const ACTIVE_WATCHLIST_KEY = 'sigmatraderpro.watchlist.active_id'

const BROKER_OPTIONS = [
  { key: 'angel', label: 'Angel One' },
  { key: 'zerodha', label: 'Zerodha' },
] as const

type BrokerKey = (typeof BROKER_OPTIONS)[number]['key']

type WatchlistAddMode = 'all' | 'cash' | 'fno'

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

function useDebounced(value: string, delayMs = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(handle)
  }, [value, delayMs])
  return debounced
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function isoDateToDate(iso: string): Date | null {
  const trimmed = iso.trim()
  if (!trimmed) return null
  const d = new Date(`${trimmed}T00:00:00Z`)
  return Number.isFinite(d.getTime()) ? d : null
}

function isNotPastIso(iso: string, today = startOfToday()): boolean {
  const d = isoDateToDate(iso)
  if (!d) return true
  return d.getTime() >= today.getTime()
}

export function WatchlistPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const updateLastUsedBroker = useAuthStore((s) => s.updateLastUsedBroker)
  const navigate = useNavigate()

  const watchlistMode = useWatchlistLayoutStore((s) => s.mode)
  const setWatchlistMode = useWatchlistLayoutStore((s) => s.setMode)

  const [banner, setBanner] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rowMenuOpenId, setRowMenuOpenId] = useState<number | null>(null)
  const [addMode, setAddMode] = useState<WatchlistAddMode>('all')

  const activeSlot = useWatchlistStructureStore((s) => s.activeSlot)
  const setActiveSlot = useWatchlistStructureStore((s) => s.setActiveSlot)
  const slotToWatchlistId = useWatchlistStructureStore((s) => s.slotToWatchlistId)
  const setSlotMap = useWatchlistStructureStore((s) => s.setSlotMap)

  const ensureDefaultGroup = useWatchlistStructureStore((s) => s.ensureDefaultGroup)
  const groupsByWatchlistId = useWatchlistStructureStore((s) => s.groupsByWatchlistId)
  const activeGroupByWatchlistId = useWatchlistStructureStore((s) => s.activeGroupByWatchlistId)
  const entryGroupByKeyByWatchlistId = useWatchlistStructureStore((s) => s.entryGroupByKeyByWatchlistId)
  const setActiveGroup = useWatchlistStructureStore((s) => s.setActiveGroup)
  const createGroup = useWatchlistStructureStore((s) => s.createGroup)
  const renameGroup = useWatchlistStructureStore((s) => s.renameGroup)
  const toggleGroupCollapsed = useWatchlistStructureStore((s) => s.toggleGroupCollapsed)
  const deleteGroup = useWatchlistStructureStore((s) => s.deleteGroup)
  const setEntryGroup = useWatchlistStructureStore((s) => s.setEntryGroup)
  const clearEntryGroup = useWatchlistStructureStore((s) => s.clearEntryGroup)

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

  const ensuringSlotsRef = useRef(false)

  useEffect(() => {
    if (!accessToken) return
    const token = accessToken
    const server = watchlists.data?.items
    if (!server) return

    const existingIds = new Set<number>(server.map((w) => w.id))
    const current = useWatchlistStructureStore.getState().slotToWatchlistId
    let needs = false
    for (let slot = 1; slot <= WATCHLIST_SLOT_COUNT; slot += 1) {
      const id = current[slot]
      if (id == null || !existingIds.has(id)) {
        needs = true
        break
      }
    }
    if (!needs) return
    if (ensuringSlotsRef.current) return
    ensuringSlotsRef.current = true

    void (async () => {
      try {
        const nameSet = new Set(server.map((w) => w.name.trim().toLowerCase()))
        const byIdAsc = [...server].sort((a, b) => a.id - b.id)

        const next: Record<number, number | null> = {}
        const used = new Set<number>()
        for (let slot = 1; slot <= WATCHLIST_SLOT_COUNT; slot += 1) {
          const id = current[slot]
          if (id != null && existingIds.has(id) && !used.has(id)) {
            next[slot] = id
            used.add(id)
          } else {
            next[slot] = null
          }
        }

        const pool: number[] = []
        for (const w of byIdAsc) if (!used.has(w.id)) pool.push(w.id)

        for (let slot = 1; slot <= WATCHLIST_SLOT_COUNT; slot += 1) {
          if (next[slot] != null) continue
          const id = pool.shift() ?? null
          if (id != null) {
            next[slot] = id
            used.add(id)
          }
        }

        async function createForSlot(slot: number): Promise<watchlistsApi.WatchlistOut> {
          const base = `Watchlist ${slot}`
          const candidates = [
            base,
            `WL ${slot}`,
            `Watchlist ${slot} (${Math.floor(Date.now() / 1000)})`,
          ]
          for (const name of candidates) {
            const key = name.trim().toLowerCase()
            if (nameSet.has(key)) continue
            try {
              const wl = await watchlistsApi.createWatchlist(token, { name })
              nameSet.add(key)
              return wl
            } catch {
              // try next candidate
            }
          }
          // last-resort unique name
          const name = `WL ${slot} ${Math.random().toString(16).slice(2, 6)}`
          const wl = await watchlistsApi.createWatchlist(token, { name })
          return wl
        }

        for (let slot = 1; slot <= WATCHLIST_SLOT_COUNT; slot += 1) {
          if (next[slot] != null) continue
          const created = await createForSlot(slot)
          next[slot] = created.id
        }

        setSlotMap(next)

        const stored = safeStoredActiveId()
        let nextActiveSlot = activeSlot
        if (stored != null) {
          for (let slot = 1; slot <= WATCHLIST_SLOT_COUNT; slot += 1) {
            if (next[slot] === stored) nextActiveSlot = slot
          }
        }
        if (next[nextActiveSlot] == null) nextActiveSlot = 1
        setActiveSlot(nextActiveSlot)

        const nextId = next[nextActiveSlot] ?? next[1]
        if (nextId != null) setStoredActiveId(nextId)
      } catch {
        setBanner('Watchlist init failed')
      } finally {
        ensuringSlotsRef.current = false
      }
    })()
  }, [accessToken, watchlists.data, activeSlot, setActiveSlot, setSlotMap])

  const watchlistById = useMemo(() => {
    const map = new Map<number, watchlistsApi.WatchlistOut>()
    for (const w of watchlists.data?.items ?? []) map.set(w.id, w)
    return map
  }, [watchlists.data])

  const activeId = useMemo(() => {
    const id = slotToWatchlistId[activeSlot] ?? null
    if (id != null && watchlistById.has(id)) return id
    for (let slot = 1; slot <= WATCHLIST_SLOT_COUNT; slot += 1) {
      const v = slotToWatchlistId[slot]
      if (v != null && watchlistById.has(v)) return v
    }
    const first = watchlists.data?.items?.[0]?.id ?? null
    return first
  }, [activeSlot, slotToWatchlistId, watchlistById, watchlists.data])

  useEffect(() => {
    if (activeId != null) setStoredActiveId(activeId)
  }, [activeId])

  useEffect(() => {
    if (activeId != null) ensureDefaultGroup(activeId)
  }, [activeId, ensureDefaultGroup])

  const watchlistItems = useQuery({
    queryKey: ['watchlists', 'items', activeId],
    queryFn: async () => {
      if (!accessToken || !activeId) return null
      return watchlistsApi.listWatchlistItems(accessToken, activeId)
    },
    enabled: Boolean(accessToken) && Boolean(activeId),
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

  const addItem = useMutation({
    mutationFn: async ({ watchlistId, canonicalId }: { watchlistId: number; canonicalId: string; groupId: string }) => {
      if (!accessToken) throw new Error('no auth')
      return watchlistsApi.addWatchlistItem(accessToken, watchlistId, { canonical_id: canonicalId })
    },
    onSuccess: async (_created, vars) => {
      setEntryGroup(vars.watchlistId, vars.canonicalId, vars.groupId)
      await watchlistItems.refetch()
      setBanner('Added to watchlist')
    },
    onError: () => setBanner('Add failed'),
  })

  const addUnderlying = useMutation({
    mutationFn: async ({ watchlistId, underlying }: { watchlistId: number; underlying: string; groupId: string }) => {
      if (!accessToken) throw new Error('no auth')
      return watchlistsApi.addWatchlistItem(accessToken, watchlistId, { underlying })
    },
    onSuccess: async (created, vars) => {
      const key = created.canonical_id ?? created.symbol_key
      if (key) setEntryGroup(vars.watchlistId, key, vars.groupId)
      await watchlistItems.refetch()
      setBanner('Added underlying')
    },
    onError: () => setBanner('Add failed'),
  })

  const removeItem = useMutation({
    mutationFn: async ({ watchlistId, itemId }: { watchlistId: number; itemId: number; entryKey: string }) => {
      if (!accessToken) throw new Error('no auth')
      await watchlistsApi.removeWatchlistItem(accessToken, watchlistId, itemId)
    },
    onSuccess: async (_v, vars) => {
      clearEntryGroup(vars.watchlistId, vars.entryKey)
      await watchlistItems.refetch()
      setBanner('Removed')
    },
    onError: () => setBanner('Remove failed'),
  })

  const syncFnoUnderlyings = useMutation({
    mutationFn: async ({ underlyings }: { underlyings: string[] }) => {
      if (!accessToken) throw new Error('no auth')
      return instrumentsApi.syncAngelMaster(accessToken, { scope: 'fno_underlyings', underlyings })
    },
    onSuccess: async (_res, vars) => {
      await addFnoContracts.refetch()
      setBanner(`Synced F&O: ${vars.underlyings.join(', ')}`)
    },
    onError: () => setBanner('F&O sync failed'),
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
  const searchFiltersRef = useRef<HTMLDivElement | null>(null)
  const searchPanelRef = useRef<HTMLDivElement | null>(null)

  const debouncedAddQ = useDebounced(q.trim(), 250)
  const showAddPanel = searchFocused && q.trim().length > 0

  useEffect(() => {
    if (!showAddPanel) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (inputRef.current?.contains(target)) return
      if (searchFiltersRef.current?.contains(target)) return
      if (searchPanelRef.current?.contains(target)) return
      setSearchFocused(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [showAddPanel])

  const getSpot = useQuoteStore((s) => s.getSpot)
  const setSpot = useQuoteStore((s) => s.setSpot)

  const [expandedUnderlying, setExpandedUnderlying] = useState<string | null>(null)
  const [previewUnderlying, setPreviewUnderlying] = useState<string | null>(null)
  const [previewExpiry, setPreviewExpiry] = useState<string | null>(null)
  const [strikeWindow, setStrikeWindow] = useState(10)

  useEffect(() => {
    if (!showAddPanel) {
      setExpandedUnderlying(null)
      setPreviewUnderlying(null)
      setPreviewExpiry(null)
      setStrikeWindow(10)
    }
  }, [showAddPanel])

  const addCashSearch = useQuery({
    queryKey: ['watchlist', 'add', 'cash', debouncedAddQ, addMode],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      if (!debouncedAddQ.trim()) return { items: [] }
      if (addMode === 'fno') return { items: [] }
      return instrumentsApi.searchInstruments(accessToken, { q: debouncedAddQ.trim(), limit: 80 })
    },
    enabled: Boolean(accessToken) && debouncedAddQ.trim().length > 0 && addMode !== 'fno' && showAddPanel,
  })

  const addFnoContracts = useQuery({
    queryKey: ['watchlist', 'add', 'fno', debouncedAddQ, addMode],
    queryFn: async () => {
      if (!accessToken) return { futs: [], opts: [] }
      if (!debouncedAddQ.trim()) return { futs: [], opts: [] }
      if (addMode !== 'fno' && addMode !== 'all') return { futs: [], opts: [] }
      const [futs, opts] = await Promise.all([
        instrumentsApi.searchInstruments(accessToken, { q: debouncedAddQ.trim(), limit: 50, instrument_type: 'FUTURE' }),
        instrumentsApi.searchInstruments(accessToken, { q: debouncedAddQ.trim(), limit: 80, instrument_type: 'OPTION' }),
      ])
      return { futs: futs.items ?? [], opts: opts.items ?? [] }
    },
    enabled: Boolean(accessToken) && debouncedAddQ.trim().length > 0 && (addMode === 'fno' || addMode === 'all') && showAddPanel,
  })

  const cashSections = useMemo(() => {
    const items = addCashSearch.data?.items ?? []
    const equities: instrumentsApi.InstrumentOut[] = []
    const indices: instrumentsApi.InstrumentOut[] = []
    const etfs: instrumentsApi.InstrumentOut[] = []
    for (const i of items) {
      if (i.instrument_type === 'EQUITY') equities.push(i)
      else if (i.instrument_type === 'INDEX') indices.push(i)
      else if (i.instrument_type === 'ETF') etfs.push(i)
    }
    const byName = (a: instrumentsApi.InstrumentOut, b: instrumentsApi.InstrumentOut) =>
      a.display_symbol.localeCompare(b.display_symbol)
    equities.sort(byName)
    indices.sort(byName)
    etfs.sort(byName)
    return { equities, indices, etfs }
  }, [addCashSearch.data])

  const fnoUnderlyings = useMemo(() => {
    const items = [...(addFnoContracts.data?.futs ?? []), ...(addFnoContracts.data?.opts ?? [])]
    const map = new Map<string, { underlying: string; hasOptions: boolean; hasFutures: boolean }>()
    for (const i of items) {
      const raw = (i.underlying ?? i.symbol_root ?? '').trim().toUpperCase()
      if (!raw) continue
      const prev = map.get(raw) ?? { underlying: raw, hasOptions: false, hasFutures: false }
      if (i.instrument_type === 'OPTION') prev.hasOptions = true
      if (i.instrument_type === 'FUTURE') prev.hasFutures = true
      map.set(raw, prev)
    }
    return Array.from(map.values())
      .sort((a, b) => a.underlying.localeCompare(b.underlying))
      .slice(0, 15)
  }, [addFnoContracts.data])

  const fnoSyncSuggestions = useMemo(() => {
    const needle = q.trim().toUpperCase()
    if (!needle) return []
    const candidates: string[] = []
    for (const i of cashSections.equities) candidates.push((i.symbol_root ?? i.display_symbol).trim().toUpperCase())
    for (const i of cashSections.indices) candidates.push((i.symbol_root ?? i.display_symbol).trim().toUpperCase())
    candidates.push(needle)
    const unique = Array.from(new Set(candidates)).filter(Boolean)
    const scored = unique
      .map((u) => {
        const score =
          u === needle ? 0 : u.startsWith(needle) ? 1 : u.includes(needle) ? 2 : 3
        return { u, score }
      })
      .sort((a, b) => (a.score !== b.score ? a.score - b.score : a.u.length - b.u.length))
      .map((x) => x.u)
    return scored.slice(0, 3)
  }, [cashSections.equities, cashSections.indices, q])

  const previewExpiries = useQuery({
    queryKey: ['watchlist', 'add', 'derivatives', 'expiries', previewUnderlying],
    queryFn: async () => {
      if (!accessToken || !previewUnderlying) return null
      return instrumentsApi.derivativeExpiries(accessToken, {
        underlying: previewUnderlying,
        exchange: 'NSE_FNO',
        instrument_type: 'OPTION',
      })
    },
    enabled: Boolean(accessToken) && Boolean(previewUnderlying) && showAddPanel,
  })

  const validPreviewExpiries = useMemo(() => {
    const today = startOfToday()
    return (previewExpiries.data?.expiries ?? []).filter((d) => isNotPastIso(d, today))
  }, [previewExpiries.data])

  useEffect(() => {
    if (!previewUnderlying) return
    if (previewExpiry) return
    const first = validPreviewExpiries[0] ?? null
    if (first) setPreviewExpiry(first)
  }, [previewExpiry, previewUnderlying, validPreviewExpiries])

  const previewSpot = useMemo(() => (previewUnderlying ? getSpot(previewUnderlying) : null), [getSpot, previewUnderlying])
  const brokerConnected = Boolean(brokerStatus.data?.find((b) => b.broker === broker)?.connected)

  const spotFetch = useQuery({
    queryKey: ['watchlist', 'add', 'spot', broker, previewUnderlying],
    queryFn: async () => {
      if (!accessToken || !previewUnderlying) return null
      const candidates = await instrumentsApi.searchInstruments(accessToken, { q: previewUnderlying, limit: 8 })
      const best =
        candidates.items.find((c) => c.instrument_type === 'INDEX') ??
        candidates.items.find((c) => c.instrument_type === 'EQUITY') ??
        candidates.items.find((c) => c.instrument_type === 'ETF') ??
        candidates.items[0] ??
        null
      if (!best) return null
      const quotes = await quotesApi.getQuotes(accessToken, { broker, canonical_ids: [best.canonical_id] })
      const ltp = quotes.items?.[0]?.ltp ?? null
      if (ltp != null && Number.isFinite(ltp) && ltp > 0) return ltp
      return null
    },
    enabled: Boolean(accessToken) && Boolean(previewUnderlying) && showAddPanel && brokerConnected && previewSpot == null,
    staleTime: 10_000,
    retry: false,
  })

  useEffect(() => {
    if (!previewUnderlying) return
    const v = spotFetch.data
    if (v != null) setSpot(previewUnderlying, v)
  }, [previewUnderlying, setSpot, spotFetch.data])

  const previewCe = useQuery({
    queryKey: ['watchlist', 'add', 'options', previewUnderlying, previewExpiry, 'CE'],
    queryFn: async () => {
      if (!accessToken || !previewUnderlying || !previewExpiry) return { items: [] }
      return instrumentsApi.derivativeOptions(accessToken, {
        underlying: previewUnderlying,
        expiry: previewExpiry,
        exchange: 'NSE_FNO',
        option_type: 'CE',
        limit: 800,
      })
    },
    enabled: Boolean(accessToken) && Boolean(previewUnderlying) && Boolean(previewExpiry) && showAddPanel,
  })

  const previewPe = useQuery({
    queryKey: ['watchlist', 'add', 'options', previewUnderlying, previewExpiry, 'PE'],
    queryFn: async () => {
      if (!accessToken || !previewUnderlying || !previewExpiry) return { items: [] }
      return instrumentsApi.derivativeOptions(accessToken, {
        underlying: previewUnderlying,
        expiry: previewExpiry,
        exchange: 'NSE_FNO',
        option_type: 'PE',
        limit: 800,
      })
    },
    enabled: Boolean(accessToken) && Boolean(previewUnderlying) && Boolean(previewExpiry) && showAddPanel,
  })

  const previewFutures = useQuery({
    queryKey: ['watchlist', 'add', 'futures', previewUnderlying],
    queryFn: async () => {
      if (!accessToken || !previewUnderlying) return { items: [] }
      return instrumentsApi.searchInstruments(accessToken, { q: previewUnderlying, limit: 20, instrument_type: 'FUTURE' })
    },
    enabled: Boolean(accessToken) && Boolean(previewUnderlying) && showAddPanel,
  })

  const previewChain = useMemo(() => {
    const ceItems = previewCe.data?.items ?? []
    const peItems = previewPe.data?.items ?? []
    const ceByStrike = new Map<number, instrumentsApi.InstrumentOut>()
    const peByStrike = new Map<number, instrumentsApi.InstrumentOut>()
    const strikes: number[] = []
    for (const i of ceItems) {
      if (typeof i.strike !== 'number' || !Number.isFinite(i.strike)) continue
      ceByStrike.set(i.strike, i)
      strikes.push(i.strike)
    }
    for (const i of peItems) {
      if (typeof i.strike !== 'number' || !Number.isFinite(i.strike)) continue
      peByStrike.set(i.strike, i)
      strikes.push(i.strike)
    }
    const uniqueStrikes = Array.from(new Set(strikes)).sort((a, b) => a - b)
    const atm = computeAtmStrike(uniqueStrikes, { spot: previewSpot, anchorStrike: null })
    const idx = atm != null ? uniqueStrikes.findIndex((s) => s === atm) : -1
    const anchor = idx >= 0 ? idx : Math.floor((uniqueStrikes.length - 1) / 2)
    const start = Math.max(0, anchor - strikeWindow)
    const end = Math.min(uniqueStrikes.length, anchor + strikeWindow + 1)
    return {
      ceByStrike,
      peByStrike,
      strikes: uniqueStrikes.slice(start, end),
      atmStrike: atm,
    }
  }, [previewCe.data, previewPe.data, previewSpot, strikeWindow])

  const previewFuturesList = useMemo(() => {
    const today = startOfToday()
    const items = previewFutures.data?.items ?? []
    const u = (previewUnderlying ?? '').trim().toUpperCase()
    return items
      .filter((i) => i.instrument_type === 'FUTURE')
      .filter((i) => (i.underlying ?? i.symbol_root ?? '').trim().toUpperCase() === u)
      .filter((i) => (i.expiry ? isNotPastIso(i.expiry, today) : true))
      .sort((a, b) => {
        const ea = a.expiry ?? ''
        const eb = b.expiry ?? ''
        if (ea !== eb) return ea < eb ? -1 : 1
        return a.display_symbol.localeCompare(b.display_symbol)
      })
      .slice(0, 6)
  }, [previewFutures.data, previewUnderlying])

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

  const slotTabs = useMemo(() => {
    const tabs: Array<{ slot: number; watchlistId: number | null; name: string }> = []
    for (let slot = 1; slot <= WATCHLIST_SLOT_COUNT; slot += 1) {
      const watchlistId = slotToWatchlistId[slot] ?? null
      const wl = watchlistId != null ? watchlistById.get(watchlistId) ?? null : null
      tabs.push({ slot, watchlistId, name: wl?.name ?? `Watchlist ${slot}` })
    }
    return tabs
  }, [slotToWatchlistId, watchlistById])

  const activeWatchlist = useMemo(() => {
    if (!activeId) return null
    return watchlistById.get(activeId) ?? null
  }, [activeId, watchlistById])

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

  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')

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

  const activeGroupId = useMemo(() => {
    if (!activeId) return 'default'
    return activeGroupByWatchlistId[activeId] ?? 'default'
  }, [activeGroupByWatchlistId, activeId])

  const groups = useMemo(() => {
    if (!activeId) return []
    const raw = groupsByWatchlistId[activeId] ?? []
    const hasDefault = raw.some((g) => g.id === 'default')
    const next = hasDefault ? raw : [{ id: 'default', name: 'Default', collapsed: false, sort_order: 0 }, ...raw]
    return [...next].sort((a, b) => a.sort_order - b.sort_order)
  }, [activeId, groupsByWatchlistId])

  const entryGroupMap = useMemo(() => {
    if (!activeId) return {}
    return entryGroupByKeyByWatchlistId[activeId] ?? {}
  }, [activeId, entryGroupByKeyByWatchlistId])

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      const key = item.canonical_id ?? item.symbol_key
      const gid = (key ? entryGroupMap[key] : null) ?? 'default'
      counts.set(gid, (counts.get(gid) ?? 0) + 1)
    }
    return counts
  }, [entryGroupMap, items])

  const groupedFilteredItems = useMemo(() => {
    const buckets = new Map<string, watchlistsApi.WatchlistItemOut[]>()
    for (const g of groups) buckets.set(g.id, [])
    if (!buckets.has('default')) buckets.set('default', [])

    for (const item of filteredItems) {
      const key = item.canonical_id ?? item.symbol_key
      const gid = (key ? entryGroupMap[key] : null) ?? 'default'
      const bucket = buckets.get(gid) ?? buckets.get('default')
      if (bucket) bucket.push(item)
    }
    return buckets
  }, [entryGroupMap, filteredItems, groups])

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
		              <CardTitle className={cn(isCompact && 'text-xs')}>
		                {activeWatchlist?.name ?? `Watchlist ${activeSlot}`}
		              </CardTitle>
		            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex items-center gap-2 text-sm">
                <select
                  value={broker}
                  onChange={(e) => void updateLastUsedBroker(e.target.value)}
                  className={cn(
                    'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
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
	                  if (!next.trim()) setAddMode('all')
	                }}
	                onFocus={() => setSearchFocused(true)}
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
	              <div
	                ref={searchFiltersRef}
	                className="mt-2 flex items-center justify-between gap-2 rounded-md border bg-muted/40 p-1 shadow-sm"
	              >
	                <div className="flex items-center gap-1">
	                <Button
	                  type="button"
	                  size="sm"
	                  variant={addMode === 'all' ? 'secondary' : 'ghost'}
	                  onClick={() => setAddMode('all')}
                >
                  All
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={addMode === 'cash' ? 'secondary' : 'ghost'}
                  onClick={() => setAddMode('cash')}
                >
                  Stocks/ETF/Indices
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={addMode === 'fno' ? 'secondary' : 'ghost'}
	                  onClick={() => setAddMode('fno')}
	                >
	                  F&amp;O
	                </Button>
	                </div>
	                <Button
	                  type="button"
	                  size="sm"
	                  variant="ghost"
	                  onClick={() => {
	                    setQ('')
	                    setAddMode('all')
	                    inputRef.current?.focus()
	                  }}
	                >
	                  Clear
	                </Button>
	              </div>
	            ) : null}
	          </div>
	        </CardHeader>

        <CardContent>
	          {searchFocused && q.trim().length > 0 ? (
	            <div ref={searchPanelRef} className="rounded-md border bg-card overflow-hidden">
              <div className="max-h-[420px] overflow-auto">
                {addCashSearch.isFetching || addFnoContracts.isFetching ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">Searching…</div>
                ) : null}
                {addMode !== 'fno' ? (
                  <div className="divide-y">
                    {cashSections.equities.length ? (
                      <div>
                        <div className="bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">Equity</div>
                        {cashSections.equities.slice(0, 18).map((i) => {
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
                                  if (items.length >= WATCHLIST_ENTRY_LIMIT) {
                                    setBanner(`Max ${WATCHLIST_ENTRY_LIMIT} entries per watchlist`)
                                    return
                                  }
                                  void addItem.mutate({ watchlistId: activeId, canonicalId: i.canonical_id, groupId: activeGroupId })
                                  setQ('')
                                  inputRef.current?.focus()
                                }}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <div className={cn('flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold', badge.className)}>
                                    {badge.label}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate font-medium">{i.display_symbol}</div>
                                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                      {i.exchange} • {typeLabel(i, null)}
                                    </div>
                                  </div>
                                </div>
                              </button>

                              <div className={cn('flex items-center gap-1 opacity-0 transition-opacity', 'group-hover:opacity-100 group-focus-within:opacity-100')}>
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
                                  if (items.length >= WATCHLIST_ENTRY_LIMIT) {
                                    setBanner(`Max ${WATCHLIST_ENTRY_LIMIT} entries per watchlist`)
                                    return
                                  }
                                  void addItem.mutate({ watchlistId: activeId, canonicalId: i.canonical_id, groupId: activeGroupId })
                                  setQ('')
                                  inputRef.current?.focus()
                                }}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}

                    {cashSections.indices.length ? (
                      <div>
                        <div className="bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">Index</div>
                        {cashSections.indices.slice(0, 10).map((i) => {
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
                                  if (items.length >= WATCHLIST_ENTRY_LIMIT) {
                                    setBanner(`Max ${WATCHLIST_ENTRY_LIMIT} entries per watchlist`)
                                    return
                                  }
                                  void addItem.mutate({ watchlistId: activeId, canonicalId: i.canonical_id, groupId: activeGroupId })
                                  setQ('')
                                  inputRef.current?.focus()
                                }}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <div className={cn('flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold', badge.className)}>
                                    {badge.label}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate font-medium">{i.display_symbol}</div>
                                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                      {i.exchange} • {typeLabel(i, null)}
                                    </div>
                                  </div>
                                </div>
                              </button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label={already ? 'Already in watchlist' : 'Add to watchlist'}
                                disabled={already || !activeId}
                                onClick={() => {
                                  if (!activeId) return
                                  if (already) return
                                  if (items.length >= WATCHLIST_ENTRY_LIMIT) {
                                    setBanner(`Max ${WATCHLIST_ENTRY_LIMIT} entries per watchlist`)
                                    return
                                  }
                                  void addItem.mutate({ watchlistId: activeId, canonicalId: i.canonical_id, groupId: activeGroupId })
                                  setQ('')
                                  inputRef.current?.focus()
                                }}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}

                    {cashSections.etfs.length ? (
                      <div>
                        <div className="bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">ETF</div>
                        {cashSections.etfs.slice(0, 10).map((i) => {
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
                                  if (items.length >= WATCHLIST_ENTRY_LIMIT) {
                                    setBanner(`Max ${WATCHLIST_ENTRY_LIMIT} entries per watchlist`)
                                    return
                                  }
                                  void addItem.mutate({ watchlistId: activeId, canonicalId: i.canonical_id, groupId: activeGroupId })
                                  setQ('')
                                  inputRef.current?.focus()
                                }}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <div className={cn('flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold', badge.className)}>
                                    {badge.label}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate font-medium">{i.display_symbol}</div>
                                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                      {i.exchange} • {typeLabel(i, null)}
                                    </div>
                                  </div>
                                </div>
                              </button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label={already ? 'Already in watchlist' : 'Add to watchlist'}
                                disabled={already || !activeId}
                                onClick={() => {
                                  if (!activeId) return
                                  if (already) return
                                  if (items.length >= WATCHLIST_ENTRY_LIMIT) {
                                    setBanner(`Max ${WATCHLIST_ENTRY_LIMIT} entries per watchlist`)
                                    return
                                  }
                                  void addItem.mutate({ watchlistId: activeId, canonicalId: i.canonical_id, groupId: activeGroupId })
                                  setQ('')
                                  inputRef.current?.focus()
                                }}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {addMode !== 'cash' ? (
                  <div className="mt-2 border-t">
                    <div className="bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">F&amp;O underlyings</div>
                    <div className="divide-y">
                      {fnoUnderlyings.map((u) => {
                        const open = expandedUnderlying === u.underlying
                        return (
                          <div key={u.underlying} className="px-3 py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <button
                                type="button"
                                className="min-w-0 truncate font-medium text-left hover:underline"
                                onClick={() => {
                                  const next = u.underlying
                                  const opening = expandedUnderlying !== next
                                  setExpandedUnderlying(opening ? next : null)
                                  if (opening) {
                                    setPreviewUnderlying(next)
                                    setPreviewExpiry(null)
                                    setStrikeWindow(10)
                                  } else {
                                    setPreviewUnderlying(null)
                                    setPreviewExpiry(null)
                                  }
                                }}
                              >
                                {u.underlying}
                              </button>
                              <div className="flex items-center gap-2">
                                {u.hasFutures ? <Badge variant="outline">FUT</Badge> : null}
                                {u.hasOptions ? <Badge variant="outline">OPT</Badge> : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    if (!activeId) return
                                    if (items.length >= WATCHLIST_ENTRY_LIMIT) {
                                      setBanner(`Max ${WATCHLIST_ENTRY_LIMIT} entries per watchlist`)
                                      return
                                    }
                                    void addUnderlying.mutate({ watchlistId: activeId, underlying: u.underlying, groupId: activeGroupId })
                                    setQ('')
                                    inputRef.current?.focus()
                                  }}
                                >
                                  Add underlying
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openUnderlyingTicket(u.underlying)}
                                >
                                  Trade
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    const next = u.underlying
                                    const opening = expandedUnderlying !== next
                                    setExpandedUnderlying(opening ? next : null)
                                    if (opening) {
                                      setPreviewUnderlying(next)
                                      setPreviewExpiry(null)
                                      setStrikeWindow(10)
                                    } else {
                                      setPreviewUnderlying(null)
                                      setPreviewExpiry(null)
                                    }
                                  }}
                                >
                                  {open ? 'Hide' : 'Show'}
                                </Button>
                              </div>
                            </div>

                            {open && previewUnderlying === u.underlying ? (
                              <div className="mt-3 rounded-md border bg-muted/10 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="text-xs text-muted-foreground">
                                    {previewSpot != null ? (
                                      <>
                                        Spot <span className="font-medium tabular-nums">{previewSpot}</span>
                                      </>
                                    ) : (
                                      'Spot: —'
                                    )}{' '}
                                    {previewChain.atmStrike != null ? (
                                      <>
                                        • ATM <span className="font-medium tabular-nums">{previewChain.atmStrike}</span>
                                      </>
                                    ) : null}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <select
                                      aria-label="Expiry"
                                      value={previewExpiry ?? ''}
                                      onChange={(e) => setPreviewExpiry(e.target.value || null)}
                                      disabled={!previewUnderlying || previewExpiries.isFetching}
                                      className={cn(
                                        'h-8 rounded-md border border-input bg-card px-2 text-xs outline-none shadow-sm',
                                        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                      )}
                                    >
                                      <option value="">Expiry</option>
                                      {validPreviewExpiries.map((d) => (
                                        <option key={d} value={d}>
                                          {d}
                                        </option>
                                      ))}
                                    </select>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setStrikeWindow((w) => (w === 10 ? 20 : 10))}
                                      disabled={!previewExpiry}
                                    >
                                      {strikeWindow === 10 ? 'More' : 'Less'}
                                    </Button>
                                  </div>
                                </div>

                                {previewFuturesList.length ? (
                                  <div className="mt-3">
                                    <div className="text-xs font-medium text-muted-foreground">Futures (upcoming)</div>
                                    <div className="mt-2 flex flex-col gap-2">
                                      {previewFuturesList.map((f) => {
                                        const already = watchlistCanonicalSet.has(f.canonical_id)
                                        return (
                                          <div key={f.canonical_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-2 py-2">
                                            <div className="min-w-0">
                                              <div className="font-medium">{titleForInstrument(f)}</div>
                                              <div className="mt-0.5 text-xs text-muted-foreground">
                                                {f.expiry ?? '—'} • lot {f.lot_size ?? '—'}
                                              </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={already || !activeId}
                                                onClick={() => {
                                                  if (!activeId) return
                                                  if (already) return
                                                  if (items.length >= WATCHLIST_ENTRY_LIMIT) {
                                                    setBanner(`Max ${WATCHLIST_ENTRY_LIMIT} entries per watchlist`)
                                                    return
                                                  }
                                                  void addItem.mutate({ watchlistId: activeId, canonicalId: f.canonical_id, groupId: activeGroupId })
                                                  setQ('')
                                                  inputRef.current?.focus()
                                                }}
                                              >
                                                Add
                                              </Button>
                                              <Button
                                                type="button"
                                                size="icon"
                                                variant="secondary"
                                                className="h-7 w-7 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                                                onClick={() => openTradeInstrument(f, 'BUY')}
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
                                                onClick={() => openTradeInstrument(f, 'SELL')}
                                                aria-label="Sell"
                                                title="Sell"
                                              >
                                                S
                                              </Button>
                                            </div>
                                          </div>
                                        )
                                      })}
                                    </div>
                                  </div>
                                ) : null}

                                {previewExpiry && previewChain.strikes.length ? (
                                  <div className="mt-4">
                                    <div className="text-xs font-medium text-muted-foreground">
                                      Options (±{strikeWindow} around ATM) • {previewExpiry}
                                    </div>
                                    <div className="mt-2 overflow-auto rounded-md border bg-card">
                                      <div className="grid grid-cols-[1fr_auto_1fr] gap-0 text-xs">
                                        <div className="border-b px-3 py-2 font-medium text-muted-foreground">Calls</div>
                                        <div className="border-b px-3 py-2 font-medium text-muted-foreground text-center">Strike</div>
                                        <div className="border-b px-3 py-2 font-medium text-muted-foreground text-right">Puts</div>
                                        {previewChain.strikes.map((s) => {
                                          const ce = previewChain.ceByStrike.get(s) ?? null
                                          const pe = previewChain.peByStrike.get(s) ?? null
                                          const ceAlready = ce ? watchlistCanonicalSet.has(ce.canonical_id) : false
                                          const peAlready = pe ? watchlistCanonicalSet.has(pe.canonical_id) : false
                                          return (
                                            <div key={s} className="contents">
                                              <div className="border-b px-3 py-2">
                                                {ce ? (
                                                  <div className="flex items-center gap-2">
                                                    <Badge variant="outline">CE</Badge>
                                                    <Button
                                                      type="button"
                                                      size="sm"
                                                      variant="outline"
                                                      disabled={ceAlready || !activeId}
                                                      onClick={() => {
                                                        if (!activeId) return
                                                        if (ceAlready) return
                                                        if (items.length >= WATCHLIST_ENTRY_LIMIT) {
                                                          setBanner(`Max ${WATCHLIST_ENTRY_LIMIT} entries per watchlist`)
                                                          return
                                                        }
                                                        void addItem.mutate({ watchlistId: activeId, canonicalId: ce.canonical_id, groupId: activeGroupId })
                                                        setQ('')
                                                        inputRef.current?.focus()
                                                      }}
                                                    >
                                                      Add
                                                    </Button>
                                                    <Button
                                                      type="button"
                                                      size="icon"
                                                      variant="secondary"
                                                      className="h-7 w-7 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                                                      onClick={() => openTradeInstrument(ce, 'BUY')}
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
                                                      onClick={() => openTradeInstrument(ce, 'SELL')}
                                                      aria-label="Sell"
                                                      title="Sell"
                                                    >
                                                      S
                                                    </Button>
                                                  </div>
                                                ) : (
                                                  <span className="text-muted-foreground">—</span>
                                                )}
                                              </div>
                                              <div className="border-b px-3 py-2 text-center tabular-nums">
                                                {formatStrikeHuman(s, previewUnderlying)}
                                                {previewChain.atmStrike != null && s === previewChain.atmStrike ? (
                                                  <span className="ml-2 text-[11px] text-muted-foreground">ATM</span>
                                                ) : null}
                                              </div>
                                              <div className="border-b px-3 py-2 flex justify-end">
                                                {pe ? (
                                                  <div className="flex items-center gap-2">
                                                    <Button
                                                      type="button"
                                                      size="sm"
                                                      variant="outline"
                                                      disabled={peAlready || !activeId}
                                                      onClick={() => {
                                                        if (!activeId) return
                                                        if (peAlready) return
                                                        if (items.length >= WATCHLIST_ENTRY_LIMIT) {
                                                          setBanner(`Max ${WATCHLIST_ENTRY_LIMIT} entries per watchlist`)
                                                          return
                                                        }
                                                        void addItem.mutate({ watchlistId: activeId, canonicalId: pe.canonical_id, groupId: activeGroupId })
                                                        setQ('')
                                                        inputRef.current?.focus()
                                                      }}
                                                    >
                                                      Add
                                                    </Button>
                                                    <Button
                                                      type="button"
                                                      size="icon"
                                                      variant="secondary"
                                                      className="h-7 w-7 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                                                      onClick={() => openTradeInstrument(pe, 'BUY')}
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
                                                      onClick={() => openTradeInstrument(pe, 'SELL')}
                                                      aria-label="Sell"
                                                      title="Sell"
                                                    >
                                                      S
                                                    </Button>
                                                    <Badge variant="outline">PE</Badge>
                                                  </div>
                                                ) : (
                                                  <span className="text-muted-foreground">—</span>
                                                )}
                                              </div>
                                            </div>
                                          )
                                        })}
                                      </div>
                                    </div>
                                    <div className="mt-2 text-xs text-muted-foreground">
                                      Need deeper strikes? Use “More”, or add the underlying and use Order/Strike discovery.
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}

	                      {!addFnoContracts.isFetching && fnoUnderlyings.length === 0 ? (
	                        <div className="px-3 py-4 text-sm text-muted-foreground space-y-2">
	                          <div>No underlyings found. Sync F&amp;O (underlyings) first.</div>
	                          {fnoSyncSuggestions.length ? (
	                            <div className="flex flex-wrap items-center gap-2">
	                              {fnoSyncSuggestions.map((u) => (
	                                <Button
	                                  key={u}
	                                  type="button"
	                                  size="sm"
	                                  variant="outline"
	                                  disabled={!accessToken || syncFnoUnderlyings.isPending}
	                                  onClick={() => void syncFnoUnderlyings.mutate({ underlyings: [u] })}
	                                >
	                                  Sync {u}
	                                </Button>
	                              ))}
	                            </div>
	                          ) : null}
	                          <div className="text-xs text-muted-foreground/80">
	                            Tip: add the symbol in the “NIFTY,BANKNIFTY…” box (Instrument registry sync) and click “Sync F&amp;O (underlyings)”.
	                          </div>
	                        </div>
	                      ) : null}
	                    </div>
	                  </div>
	                ) : null}

                {!addCashSearch.isFetching &&
                !addFnoContracts.isFetching &&
                addMode !== 'fno' &&
                cashSections.equities.length === 0 &&
                cashSections.indices.length === 0 &&
                cashSections.etfs.length === 0 &&
                (addMode === 'cash' || fnoUnderlyings.length === 0) ? (
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
                    if (items.length >= WATCHLIST_ENTRY_LIMIT) {
                      setBanner(`Max ${WATCHLIST_ENTRY_LIMIT} entries per watchlist`)
                      return
                    }
                    void addUnderlying.mutate({ watchlistId: activeId, underlying: u, groupId: activeGroupId })
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
            <div data-testid="watchlist-items" className="rounded-md border bg-card overflow-hidden">
              <div className="divide-y">
                {(q.trim() ? groups.filter((g) => (groupedFilteredItems.get(g.id)?.length ?? 0) > 0) : groups).map((g) => {
                  const total = groupCounts.get(g.id) ?? 0
                  const filtered = groupedFilteredItems.get(g.id)?.length ?? 0
                  const activeGroup = activeId != null && activeGroupId === g.id
                  const countLabel = q.trim() ? `${filtered}/${total}` : String(total)
                  const bucket = groupedFilteredItems.get(g.id) ?? []

                  return (
                    <div key={g.id}>
                      <div
                        className={cn(
                          'flex items-center justify-between gap-2 px-3 py-2',
                          'border-b bg-muted/20',
                          activeGroup && 'bg-accent/30',
                        )}
                      >
                        <button
                          type="button"
                          className="h-6 w-6 rounded-md hover:bg-accent/30 flex items-center justify-center"
                          aria-label={g.collapsed ? 'Expand group' : 'Collapse group'}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!activeId) return
                            toggleGroupCollapsed(activeId, g.id)
                          }}
                        >
                          {g.collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          className={cn('min-w-0 flex-1 truncate text-left text-sm', activeGroup ? 'font-semibold' : 'font-medium')}
                          onClick={() => {
                            if (!activeId) return
                            setActiveGroup(activeId, g.id)
                          }}
                          title={g.name}
                        >
                          {g.name}{' '}
                          <span className="text-[11px] font-normal text-muted-foreground">({countLabel})</span>
                        </button>
                        {activeGroup ? <span className="text-[11px] text-muted-foreground">Active</span> : null}
                      </div>

                      {!g.collapsed
                        ? bucket.map((item) => {
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
	                                  'group flex items-center justify-between gap-3 px-3 py-2 text-sm',
	                                  'hover:bg-accent/20',
	                                  isCompact && 'py-1.5 text-xs',
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
	                                      aria-label="Remove"
	                                      title="Remove"
	                                      className="h-7 w-7 text-muted-foreground hover:text-red-600"
	                                      onClick={() => {
	                                        if (!activeId) return
	                                        const entryKey = item.canonical_id ?? item.symbol_key
	                                        if (!entryKey) return
	                                        setRowMenuOpenId(null)
	                                        void removeItem.mutate({ watchlistId: activeId, itemId: item.id, entryKey })
	                                      }}
	                                    >
	                                      <Trash2 className="h-4 w-4" />
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
                                            const entryKey = item.canonical_id ?? item.symbol_key
                                            if (!entryKey) return
                                            void removeItem.mutate({ watchlistId: activeId, itemId: item.id, entryKey })
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
                          })
                        : null}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="sticky bottom-0 -mx-4 mt-3 border-t bg-card/95 px-4 py-2 backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-1 items-center justify-between gap-1">
                {slotTabs.map((t) => {
                  const active = t.slot === activeSlot
                  const disabled = !t.watchlistId
                  return (
                    <button
                      key={t.slot}
                      type="button"
                      aria-label={`Watchlist slot ${t.slot}`}
                      title={t.name}
                      disabled={disabled}
	                      onClick={() => {
	                        if (!t.watchlistId) return
	                        setActiveSlot(t.slot)
	                        setStoredActiveId(t.watchlistId)
	                        setRowMenuOpenId(null)
	                        setQ('')
	                        setAddMode('all')
	                      }}
                      className={cn(
                        'h-8 w-8 rounded-md text-sm tabular-nums transition-colors',
                        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/30 hover:text-foreground',
                        disabled && 'opacity-50 pointer-events-none',
                      )}
                    >
                      {t.slot}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Watchlist settings</DialogTitle>
            <DialogDescription>
              Manage watchlists (slots) and groups. Display/market columns will expand in later milestones.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="text-sm font-medium">Layout</div>
              <div className="flex items-center gap-1 rounded-md border bg-muted/40 p-1 shadow-sm">
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
                {slotTabs.map((t) => {
                  const wlId = t.watchlistId
                  const active = t.slot === activeSlot
                  const isEditing = wlId != null && editingId === wlId
                  return (
                    <div key={t.slot} className="flex items-center justify-between gap-2 rounded-md border px-2 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className={cn('w-5 text-sm tabular-nums', active ? 'text-foreground' : 'text-muted-foreground')}>
                            {t.slot}
                          </div>
                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <Input
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                  if (!wlId) return
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    void updateWl.mutate({ id: wlId, name: editingName.trim() })
                                    setEditingId(null)
                                    setEditingName('')
                                  }
                                  if (e.key === 'Escape') {
                                    e.preventDefault()
                                    setEditingId(null)
                                    setEditingName('')
                                  }
                                }}
                              />
                            ) : (
                              <button
                                type="button"
                                className="w-full truncate text-left font-medium hover:underline"
                                disabled={!wlId}
                                onClick={() => {
                                  if (!wlId) return
                                  setActiveSlot(t.slot)
                                  setStoredActiveId(wlId)
                                  setSettingsOpen(false)
                                }}
                              >
                                {t.name}
                              </button>
                            )}
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {active ? `Active • ${items.length} / ${WATCHLIST_ENTRY_LIMIT}` : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {wlId != null && isEditing ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                if (!wlId) return
                                void updateWl.mutate({ id: wlId, name: editingName.trim() })
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
                                if (!wlId) return
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
                            disabled={wlId == null}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              if (!wlId) return
                              setEditingId(wlId)
                              setEditingName(t.name)
                            }}
                          >
                            <Pencil />
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">Groups</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {items.length} / {WATCHLIST_ENTRY_LIMIT}
                </div>
              </div>
              <div className="space-y-2">
                {(groups.length ? groups : [{ id: 'default', name: 'Default', collapsed: false, sort_order: 0 }]).map((g) => {
                  const total = groupCounts.get(g.id) ?? 0
                  const groupActive = activeGroupId === g.id
                  const isEditing = editingGroupId === g.id
                  const disableDelete = g.id === 'default' || total > 0

                  return (
                    <div key={g.id} className={cn('flex items-center justify-between gap-2 rounded-md border px-2 py-2', groupActive && 'bg-accent/20')}>
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <Input value={editingGroupName} onChange={(e) => setEditingGroupName(e.target.value)} />
                        ) : (
                          <button
                            type="button"
                            className="truncate font-medium text-left"
                            onClick={() => {
                              if (!activeId) return
                              setActiveGroup(activeId, g.id)
                            }}
                            title="Set active group"
                          >
                            {g.name}
                          </button>
                        )}
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {groupActive ? 'Active • ' : ''}{total} items {g.collapsed ? '• Collapsed' : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={g.collapsed ? 'Expand group' : 'Collapse group'}
                          onClick={() => {
                            if (!activeId) return
                            toggleGroupCollapsed(activeId, g.id)
                          }}
                        >
                          {g.collapsed ? 'Expand' : 'Collapse'}
                        </Button>
                        {isEditing ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => {
                                if (!activeId) return
                                renameGroup(activeId, g.id, editingGroupName)
                                setEditingGroupId(null)
                                setEditingGroupName('')
                              }}
                            >
                              Save
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingGroupId(null)
                                setEditingGroupName('')
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
                            aria-label="Rename group"
                            onClick={() => {
                              setEditingGroupId(g.id)
                              setEditingGroupName(g.name)
                            }}
                          >
                            <Pencil />
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          aria-label="Delete group"
                          disabled={disableDelete}
                          onClick={() => {
                            if (!activeId) return
                            if (disableDelete) {
                              setBanner('Group must be empty to delete')
                              return
                            }
                            deleteGroup(activeId, g.id)
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-2">
                <Input value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="New group name" />
                <Button
                  type="button"
                  onClick={() => {
                    if (!activeId) return
                    const name = newGroupName.trim()
                    if (!name) return
                    createGroup(activeId, name)
                    setNewGroupName('')
                  }}
                >
                  Create group
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Delete is allowed only when a group has 0 items. Default group cannot be deleted.
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
