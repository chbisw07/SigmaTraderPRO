import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import * as instrumentsApi from '@/lib/api/instruments'
import * as quotesApi from '@/lib/api/quotes'
import * as watchlistsApi from '@/lib/api/watchlists'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useQuoteStore } from '@/store/quoteStore'
import { WATCHLIST_ENTRY_LIMIT } from '@/store/watchlistStructureStore'
import { useWatchlistStructureStore } from '@/store/watchlistStructureStore'
import { computeAtmStrike, computeMoneyness, moneynessBadgeClasses } from '@/lib/moneyness'
import { formatStrikeHuman } from '@/lib/format'
import { StockOrderDialog } from '@/features/orders/StockOrderDialog'
import { FnoOrderDialog } from '@/features/orders/FnoOrderDialog'

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

function TypeBadge({
  instrument,
}: {
  instrument: instrumentsApi.InstrumentOut
}) {
  const label =
    instrument.instrument_type === 'OPTION'
      ? 'Option'
      : instrument.instrument_type === 'FUTURE'
        ? 'Future'
        : instrument.instrument_type === 'INDEX'
          ? 'Index'
          : instrument.instrument_type === 'ETF'
            ? 'ETF'
            : 'Equity'
  return <Badge variant="outline">{label}</Badge>
}

function formatDerivativeSuffix(i: instrumentsApi.InstrumentOut) {
  const bits: string[] = []
  if (i.expiry) bits.push(i.expiry)
  if (i.strike != null) bits.push(formatStrikeHuman(i.strike, i.underlying ?? i.symbol_root))
  if (i.option_type) bits.push(i.option_type)
  return bits.length ? bits.join(' • ') : null
}

function formatExpiryHuman(iso: string | null): string {
  if (!iso) return '—'
  try {
    // iso is YYYY-MM-DD from backend (date). Force UTC so date doesn't shift.
    const d = new Date(`${iso}T00:00:00Z`)
    // Example: 05 May 2026
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(d)
  } catch {
    return iso
  }
}

function formatInstrumentTitle(i: instrumentsApi.InstrumentOut): string {
  const root = (i.underlying ?? i.symbol_root).toUpperCase()

  if (i.instrument_type === 'OPTION') {
    return `${root} ${formatExpiryHuman(i.expiry)} ${formatStrikeHuman(i.strike, root)} ${i.option_type ?? ''}`.trim()
  }
  if (i.instrument_type === 'FUTURE') {
    return `${root} ${formatExpiryHuman(i.expiry)} FUT`.trim()
  }
  return i.display_symbol
}

function MoneynessPill({ label }: { label: 'ATM' | 'ITM' | 'OTM' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium',
        moneynessBadgeClasses(label),
      )}
    >
      {label}
    </span>
  )
}

const BROKER_OPTIONS = [
  { key: 'angel', label: 'Angel One' },
  { key: 'zerodha', label: 'Zerodha' },
] as const

type BrokerKey = (typeof BROKER_OPTIONS)[number]['key']

const EMPTY_INSTRUMENTS: instrumentsApi.InstrumentOut[] = []

const ACTIVE_WATCHLIST_KEY = 'sigmatraderpro.watchlist.active_id'

const COMMON_FNO_UNDERLYINGS = [
  'NIFTY',
  'BANKNIFTY',
  'FINNIFTY',
  'MIDCPNIFTY',
  'HDFCBANK',
  'RELIANCE',
  'INFY',
  'TCS',
  'ICICIBANK',
  'SBIN',
  'AXISBANK',
  'KOTAKBANK',
  'LT',
  'ITC',
  'BHARTIARTL',
  'HINDUNILVR',
  'ADANIENT',
  'TATAMOTORS',
  'BAJFINANCE',
  'BAJAJFINSV',
  'ASIANPAINT',
  'HCLTECH',
  'ONGC',
  'POWERGRID',
  'NTPC',
  'SUNPHARMA',
  'DRREDDY',
  'INDUSINDBK',
  'ULTRACEMCO',
  'TITAN',
  'MARUTI',
  'JSWSTEEL',
  'TATASTEEL',
  'COALINDIA',
].join(',')

function safeStoredActiveWatchlistId(): number | null {
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

export function SearchPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const updateLastUsedBroker = useAuthStore((s) => s.updateLastUsedBroker)
  const queryClient = useQueryClient()

  const getPremium = useQuoteStore((s) => s.getPremium)
  const getSpot = useQuoteStore((s) => s.getSpot)
  const setSpot = useQuoteStore((s) => s.setSpot)

  const selectedBroker = (user?.last_used_broker as BrokerKey | null) ?? null

  const [brokerBusy, setBrokerBusy] = useState(false)

  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [watchlistMsg, setWatchlistMsg] = useState<string | null>(null)
  const [syncUnderlyings, setSyncUnderlyings] = useState('NIFTY,BANKNIFTY')
  const [stockDialogOpen, setStockDialogOpen] = useState(false)
  const [stockLaunch, setStockLaunch] = useState<
    | { mode: 'manual'; broker?: BrokerKey | null }
    | {
        mode: 'contract'
        instrument: instrumentsApi.InstrumentOut
        broker?: BrokerKey | null
        referencePrice?: number | null
      }
    | null
  >(null)
  const [fnoDialogOpen, setFnoDialogOpen] = useState(false)
  const [fnoLaunch, setFnoLaunch] = useState<
    | { mode: 'manual'; broker?: BrokerKey | null; prefill?: { underlying?: string; side?: 'BUY' | 'SELL' } }
    | {
        mode: 'contract'
        instrument: instrumentsApi.InstrumentOut
        broker?: BrokerKey | null
        referencePrice?: number | null
      }
    | null
  >(null)

  const [q, setQ] = useState('')
  const [searchMode, setSearchMode] = useState<'all' | 'cash' | 'fno'>('all')
  const debouncedQ = useDebounced(q.trim(), 300)

  const setEntryGroup = useWatchlistStructureStore((s) => s.setEntryGroup)

  const addToWatchlist = useMutation({
    mutationFn: async (payload: { canonical_id?: string | null; underlying?: string | null }) => {
      if (!accessToken) throw new Error('no auth')
      const activeId = safeStoredActiveWatchlistId()
      if (activeId) {
        const cached = queryClient.getQueryData<watchlistsApi.WatchlistItemsResponse | null>([
          'watchlists',
          'items',
          activeId,
        ])
        const count = cached?.items?.length ?? null
        if (count != null && count >= WATCHLIST_ENTRY_LIMIT) {
          throw new Error('WATCHLIST_LIMIT')
        }
        try {
          return await watchlistsApi.addWatchlistItem(accessToken, activeId, payload)
        } catch {
          // Fall back to default watchlist if active is stale/missing.
        }
      }
      return watchlistsApi.addWatchlistItemDefault(accessToken, payload)
    },
    onSuccess: async (created) => {
      setWatchlistMsg('Added to watchlist')
      const activeId = safeStoredActiveWatchlistId()
      if (activeId) {
        const groupId = useWatchlistStructureStore.getState().activeGroupByWatchlistId[activeId] ?? 'default'
        const entryKey = created.canonical_id ?? created.symbol_key
        if (entryKey) setEntryGroup(activeId, entryKey, groupId)
      }
      await queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'WATCHLIST_LIMIT') {
        setWatchlistMsg(`Max ${WATCHLIST_ENTRY_LIMIT} entries per watchlist`)
        return
      }
      setWatchlistMsg('Add to watchlist failed')
    },
  })

  const rawSearch = useQuery({
    queryKey: ['instruments', 'search', debouncedQ, searchMode],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      if (searchMode === 'fno') return { items: [] }
      return instrumentsApi.searchInstruments(accessToken, {
        q: debouncedQ,
        limit: 80,
      })
    },
    enabled: Boolean(accessToken) && debouncedQ.length > 0,
  })

  const fnoContracts = useQuery({
    queryKey: ['instruments', 'search', 'fno', debouncedQ, searchMode],
    queryFn: async () => {
      if (!accessToken) return { futs: EMPTY_INSTRUMENTS, opts: EMPTY_INSTRUMENTS }
      if (searchMode !== 'fno' && searchMode !== 'all') return { futs: EMPTY_INSTRUMENTS, opts: EMPTY_INSTRUMENTS }
      const [futs, opts] = await Promise.all([
        instrumentsApi.searchInstruments(accessToken, { q: debouncedQ, limit: 50, instrument_type: 'FUTURE' }),
        instrumentsApi.searchInstruments(accessToken, { q: debouncedQ, limit: 80, instrument_type: 'OPTION' }),
      ])
      return { futs: futs.items ?? EMPTY_INSTRUMENTS, opts: opts.items ?? EMPTY_INSTRUMENTS }
    },
    enabled: Boolean(accessToken) && debouncedQ.length > 0 && (searchMode === 'fno' || searchMode === 'all'),
  })

  const rawResults = rawSearch.data?.items ?? EMPTY_INSTRUMENTS

  const cashSections = useMemo(() => {
    const equities: instrumentsApi.InstrumentOut[] = []
    const indices: instrumentsApi.InstrumentOut[] = []
    const etfs: instrumentsApi.InstrumentOut[] = []
    for (const i of rawResults) {
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
  }, [rawResults])

  const fnoUnderlyings = useMemo(() => {
    const items = [...(fnoContracts.data?.futs ?? []), ...(fnoContracts.data?.opts ?? [])]
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
  }, [fnoContracts.data])

  const [underlyingQ, setUnderlyingQ] = useState('')
  const debouncedUnderlying = useDebounced(underlyingQ.trim(), 250)

  const underlyingSearch = useQuery({
    queryKey: ['instruments', 'underlyings', debouncedUnderlying],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      return instrumentsApi.searchInstruments(accessToken, {
        q: debouncedUnderlying,
        limit: 10,
      })
    },
    enabled: Boolean(accessToken) && debouncedUnderlying.length > 0,
  })

  const underlyingCandidates = useMemo(() => {
    const items = underlyingSearch.data?.items ?? []
    const candidates = new Set<string>()
    for (const item of items) {
      const raw =
        item.underlying ??
        (item.instrument_type === 'OPTION' || item.instrument_type === 'FUTURE'
          ? item.symbol_root
          : item.symbol_root)
      const normalized = (raw ?? '').trim().toUpperCase()
      if (!normalized) continue
      candidates.add(normalized)
    }
    return Array.from(candidates).sort().slice(0, 8)
  }, [underlyingSearch.data])

  const [underlying, setUnderlying] = useState<string | null>(null)
  const [expiry, setExpiry] = useState<string | null>(null)
  const [optionType, setOptionType] = useState<instrumentsApi.OptionType>('CE')
  const [expandedUnderlying, setExpandedUnderlying] = useState<string | null>(null)
  const [strikeWindow, setStrikeWindow] = useState(10)

  useEffect(() => {
    setExpiry(null)
  }, [underlying])

  useEffect(() => {
    if (searchMode === 'cash') setExpandedUnderlying(null)
  }, [searchMode])

  const expiries = useQuery({
    queryKey: ['instruments', 'derivatives', 'expiries', underlying],
    queryFn: async () => {
      if (!accessToken || !underlying) return null
      return instrumentsApi.derivativeExpiries(accessToken, {
        underlying,
        exchange: 'NSE_FNO',
        instrument_type: 'OPTION',
      })
    },
    enabled: Boolean(accessToken) && Boolean(underlying),
  })

  const validExpiries = useMemo(() => {
    const today = startOfToday()
    const list = expiries.data?.expiries ?? []
    return list.filter((d) => isNotPastIso(d, today))
  }, [expiries.data])

  useEffect(() => {
    if (!underlying) return
    if (expiry) return
    const first = validExpiries[0] ?? null
    if (first) setExpiry(first)
  }, [expiry, underlying, validExpiries])

  const optionChain = useQuery({
    queryKey: ['instruments', 'derivatives', 'options', underlying, expiry, optionType],
    queryFn: async () => {
      if (!accessToken || !underlying || !expiry) return { items: [] }
      return instrumentsApi.derivativeOptions(accessToken, {
        underlying,
        expiry,
        exchange: 'NSE_FNO',
        option_type: optionType,
      })
    },
    enabled: Boolean(accessToken) && Boolean(underlying) && Boolean(expiry),
  })

  const chainItems = optionChain.data?.items ?? EMPTY_INSTRUMENTS
  const formatStrikeDisplay = (strike: number | null | undefined) => formatStrikeHuman(strike, underlying ?? null)
  const chainSpot = useMemo(() => (underlying ? getSpot(underlying) : null), [getSpot, underlying])
  const chainAtmStrike = useMemo(() => {
    const strikes = chainItems
      .map((i) => i.strike)
      .filter((s): s is number => typeof s === 'number' && Number.isFinite(s))
    return computeAtmStrike(strikes, { spot: chainSpot, anchorStrike: null })
  }, [chainItems, chainSpot])

  const showPreview = Boolean(expandedUnderlying && underlying && expandedUnderlying === underlying)

  const spotFetch = useQuery({
    queryKey: ['quotes', 'spot', selectedBroker, underlying],
    queryFn: async () => {
      if (!accessToken || !selectedBroker || !underlying) return null
      const candidates = await instrumentsApi.searchInstruments(accessToken, { q: underlying, limit: 8 })
      const best =
        candidates.items.find((c) => c.instrument_type === 'INDEX') ??
        candidates.items.find((c) => c.instrument_type === 'EQUITY') ??
        candidates.items.find((c) => c.instrument_type === 'ETF') ??
        candidates.items[0] ??
        null
      if (!best) return null
      const quotes = await quotesApi.getQuotes(accessToken, { broker: selectedBroker, canonical_ids: [best.canonical_id] })
      const ltp = quotes.items?.[0]?.ltp ?? null
      if (ltp != null && Number.isFinite(ltp) && ltp > 0) return ltp
      return null
    },
    enabled: Boolean(accessToken) && Boolean(selectedBroker) && Boolean(underlying) && showPreview && chainSpot == null,
    staleTime: 10_000,
  })

  useEffect(() => {
    if (!underlying) return
    const v = spotFetch.data
    if (v != null) setSpot(underlying, v)
  }, [setSpot, spotFetch.data, underlying])

  const previewCe = useQuery({
    queryKey: ['instruments', 'derivatives', 'options', 'preview', underlying, expiry, 'CE', showPreview],
    queryFn: async () => {
      if (!accessToken || !underlying || !expiry || !showPreview) return { items: [] }
      return instrumentsApi.derivativeOptions(accessToken, {
        underlying,
        expiry,
        exchange: 'NSE_FNO',
        option_type: 'CE',
        limit: 800,
      })
    },
    enabled: Boolean(accessToken) && Boolean(underlying) && Boolean(expiry) && showPreview,
  })

  const previewPe = useQuery({
    queryKey: ['instruments', 'derivatives', 'options', 'preview', underlying, expiry, 'PE', showPreview],
    queryFn: async () => {
      if (!accessToken || !underlying || !expiry || !showPreview) return { items: [] }
      return instrumentsApi.derivativeOptions(accessToken, {
        underlying,
        expiry,
        exchange: 'NSE_FNO',
        option_type: 'PE',
        limit: 800,
      })
    },
    enabled: Boolean(accessToken) && Boolean(underlying) && Boolean(expiry) && showPreview,
  })

  const previewFutures = useQuery({
    queryKey: ['instruments', 'search', 'futures', underlying, showPreview],
    queryFn: async () => {
      if (!accessToken || !underlying || !showPreview) return { items: [] }
      return instrumentsApi.searchInstruments(accessToken, { q: underlying, limit: 20, instrument_type: 'FUTURE' })
    },
    enabled: Boolean(accessToken) && Boolean(underlying) && showPreview,
  })

  const previewChain = useMemo(() => {
    const ceItems = previewCe.data?.items ?? EMPTY_INSTRUMENTS
    const peItems = previewPe.data?.items ?? EMPTY_INSTRUMENTS
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
    const atm = computeAtmStrike(uniqueStrikes, { spot: chainSpot, anchorStrike: null })
    const idx = atm != null ? uniqueStrikes.findIndex((s) => s === atm) : -1
    const anchor = idx >= 0 ? idx : Math.floor((uniqueStrikes.length - 1) / 2)
    const start = Math.max(0, anchor - strikeWindow)
    const end = Math.min(uniqueStrikes.length, anchor + strikeWindow + 1)
    const windowStrikes = uniqueStrikes.slice(start, end)

    return { ceByStrike, peByStrike, strikes: windowStrikes, atmStrike: atm }
  }, [chainSpot, previewCe.data, previewPe.data, strikeWindow])

  const previewFuturesList = useMemo(() => {
    const today = startOfToday()
    const items = previewFutures.data?.items ?? EMPTY_INSTRUMENTS
    return items
      .filter((i) => i.instrument_type === 'FUTURE')
      .filter((i) => (i.underlying ?? i.symbol_root ?? '').trim().toUpperCase() === (underlying ?? '').trim().toUpperCase())
      .filter((i) => (i.expiry ? isNotPastIso(i.expiry, today) : true))
      .sort((a, b) => {
        const ea = a.expiry ?? ''
        const eb = b.expiry ?? ''
        if (ea !== eb) return ea < eb ? -1 : 1
        return a.display_symbol.localeCompare(b.display_symbol)
      })
      .slice(0, 6)
  }, [previewFutures.data, underlying])

  const onBrokerChange = async (next: string) => {
    const nextValue = next === '' ? null : next
    if (nextValue === selectedBroker) return
    setBrokerBusy(true)
    try {
      await updateLastUsedBroker(nextValue)
    } finally {
      setBrokerBusy(false)
    }
  }

  const onStockDialogOpenChange = (next: boolean) => {
    setStockDialogOpen(next)
    if (!next) setStockLaunch(null)
  }

  const onFnoDialogOpenChange = (next: boolean) => {
    setFnoDialogOpen(next)
    if (!next) setFnoLaunch(null)
  }

  const applyUnderlyingFromInput = () => {
    const next = underlyingQ.trim().toUpperCase()
    if (!next) {
      setUnderlying(null)
      return
    }
    setUnderlying(next)
  }

  const onSyncEquities = async () => {
    if (!accessToken) return
    setSyncBusy(true)
    setSyncMsg(null)
    try {
      const res = await instrumentsApi.syncAngelMaster(accessToken, { scope: 'equity' })
      setSyncMsg(`Equity sync complete. ingested=${res.ingested} (processed=${res.processed}, skipped=${res.skipped})`)
    } catch (e) {
      setSyncMsg(
        typeof e === 'object' && e && 'message' in e
          ? String((e as { message?: unknown }).message ?? 'Sync failed')
          : 'Sync failed',
      )
    } finally {
      setSyncBusy(false)
    }
  }

  const onSyncFno = async () => {
    if (!accessToken) return
    const underlyings = syncUnderlyings
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    if (!underlyings.length) {
      setSyncMsg('Enter at least one underlying (e.g. NIFTY,BANKNIFTY) to sync F&O.')
      return
    }
    setSyncBusy(true)
    setSyncMsg(null)
    try {
      const res = await instrumentsApi.syncAngelMaster(accessToken, {
        scope: 'fno_underlyings',
        underlyings,
      })
      setSyncMsg(`F&O sync complete. ingested=${res.ingested} (processed=${res.processed}, skipped=${res.skipped})`)
    } catch (e) {
      setSyncMsg(
        typeof e === 'object' && e && 'message' in e
          ? String((e as { message?: unknown }).message ?? 'Sync failed')
          : 'Sync failed',
      )
    } finally {
      setSyncBusy(false)
    }
  }

  const onSyncZerodhaNfo = async () => {
    if (!accessToken) return
    const underlyings = syncUnderlyings
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    if (!underlyings.length) {
      setSyncMsg('Enter at least one underlying (e.g. NIFTY,BANKNIFTY) to sync Zerodha F&O mappings.')
      return
    }
    setSyncBusy(true)
    setSyncMsg(null)
    try {
      const res = await instrumentsApi.syncZerodhaNfo(accessToken, { underlyings })
      setSyncMsg(`Zerodha NFO sync complete. ingested=${res.ingested} (processed=${res.processed}, skipped=${res.skipped})`)
    } catch (e) {
      setSyncMsg(
        typeof e === 'object' && e && 'message' in e
          ? String((e as { message?: unknown }).message ?? 'Sync failed')
          : 'Sync failed',
      )
    } finally {
      setSyncBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <h1 className="sr-only">Search</h1>
        <div className="text-xs text-muted-foreground">Broker context</div>
        <select
          aria-label="Broker context"
          value={selectedBroker ?? ''}
          onChange={(e) => void onBrokerChange(e.target.value)}
          disabled={brokerBusy}
          className={cn(
            'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
            'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          )}
        >
          <option value="">None</option>
          {BROKER_OPTIONS.map((b) => (
            <option key={b.key} value={b.key}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Instrument registry sync</CardTitle>
          <CardDescription>
            Search works only after the canonical registry has been populated. For now, sync uses Angel’s public scrip master.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => void onSyncEquities()} disabled={syncBusy}>
              Sync equities (NSE/BSE)
            </Button>
            <div className="flex flex-wrap items-center gap-2">
	              <Input
	                value={syncUnderlyings}
	                onChange={(e) => setSyncUnderlyings(e.target.value)}
	                placeholder="NIFTY,BANKNIFTY"
	                className="w-64"
	                aria-label="F&O underlyings to sync"
	              />
	              <Button
	                type="button"
	                size="sm"
	                variant="outline"
	                onClick={() => setSyncUnderlyings(COMMON_FNO_UNDERLYINGS)}
	                disabled={syncBusy}
	              >
	                Common list
	              </Button>
	              <Button type="button" size="sm" variant="outline" onClick={() => void onSyncFno()} disabled={syncBusy}>
	                Sync F&amp;O (underlyings)
	              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void onSyncZerodhaNfo()} disabled={syncBusy}>
                Sync Zerodha NFO mappings
              </Button>
            </div>
          </div>
          {syncMsg ? (
            <div className={cn('text-xs', syncMsg.toLowerCase().includes('fail') ? 'text-destructive' : 'text-muted-foreground')}>
              {syncMsg}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Tip: start with equities, then sync F&amp;O for NIFTY/BANKNIFTY. For Zerodha F&amp;O orders, also sync Zerodha NFO mappings.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Instrument search</CardTitle>
          <CardDescription>
            Search equities, indices, futures, and options using canonical registry fields.
          </CardDescription>
	        </CardHeader>
	        <CardContent className="space-y-3">
	          <div className="flex flex-wrap items-center gap-2">
	            <Input
	              value={q}
	              onChange={(e) => setQ(e.target.value)}
	              placeholder="Search: INFY, RELIANCE, NIFTY, BANKNIFTY…"
	              className="max-w-xl"
	              aria-label="Instrument search query"
	            />
	            <div className="flex items-center gap-1 rounded-md border bg-muted/40 p-1 shadow-sm">
	              <Button
	                type="button"
	                size="sm"
	                variant={searchMode === 'all' ? 'secondary' : 'ghost'}
	                onClick={() => setSearchMode('all')}
	              >
	                All
	              </Button>
	              <Button
	                type="button"
	                size="sm"
	                variant={searchMode === 'cash' ? 'secondary' : 'ghost'}
	                onClick={() => setSearchMode('cash')}
	              >
	                Stocks/ETF/Indices
	              </Button>
	              <Button
	                type="button"
	                size="sm"
	                variant={searchMode === 'fno' ? 'secondary' : 'ghost'}
	                onClick={() => setSearchMode('fno')}
	              >
	                F&amp;O
	              </Button>
	            </div>
	            <Button
	              type="button"
	              variant="outline"
	              size="sm"
	              onClick={() => setQ('')}
	              disabled={!q.trim()}
	            >
	              Clear
	            </Button>
	          </div>

	          {rawSearch.isFetching || fnoContracts.isFetching ? (
	            <div className="text-xs text-muted-foreground">Searching…</div>
	          ) : null}

	          {rawSearch.isError || fnoContracts.isError ? (
	            <div className="text-xs text-destructive">
	              Search failed. Open DevTools → Network → <span className="font-mono">/api/v1/instruments/search</span> for details.
	            </div>
	          ) : null}

	          {debouncedQ &&
	          (searchMode === 'cash' || (searchMode === 'all' && fnoUnderlyings.length === 0)) &&
	          cashSections.equities.length === 0 &&
	          cashSections.indices.length === 0 &&
	          cashSections.etfs.length === 0 &&
	          !rawSearch.isFetching &&
	          !rawSearch.isError ? (
	            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
	              <span>No matches.</span>
	              <span className="text-muted-foreground/80">
	                If you reset the DB, run Sync equities (stocks/ETFs) and Sync F&amp;O (underlyings) for options/futures.
	              </span>
	            </div>
	          ) : null}

	          {debouncedQ &&
	          searchMode === 'fno' &&
	          fnoUnderlyings.length === 0 &&
	          !fnoContracts.isFetching &&
	          !fnoContracts.isError ? (
	            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
	              <span>No F&amp;O underlyings found.</span>
	              <span className="text-muted-foreground/80">
	                Run Sync F&amp;O (underlyings) first for this symbol.
	              </span>
	            </div>
	          ) : null}

	          {searchMode !== 'fno' ? (
	            <div className="space-y-3">
	              {cashSections.equities.length ? (
	                <div className="rounded-lg border bg-card overflow-hidden">
	                  <div className="bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">Equity</div>
	                  <div className="divide-y">
	                    {cashSections.equities.slice(0, 25).map((i) => {
	                      const suffix = formatDerivativeSuffix(i)
	                      return (
	                        <div key={i.canonical_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
	                          <div className="min-w-0">
	                            <div className="flex flex-wrap items-center gap-2">
	                              <div className="font-medium">{formatInstrumentTitle(i)}</div>
	                              <TypeBadge instrument={i} />
	                              <Badge variant="outline">{i.exchange}</Badge>
	                            </div>
	                            {suffix ? <div className="mt-1 text-xs text-muted-foreground">{suffix}</div> : null}
	                            <div className="mt-1 break-all text-xs text-muted-foreground">{i.canonical_id}</div>
	                          </div>
	                          <div className="flex items-center gap-2">
	                            <Button
	                              type="button"
	                              size="sm"
	                              variant="outline"
	                              onClick={() => void addToWatchlist.mutate({ canonical_id: i.canonical_id })}
	                              disabled={!accessToken}
	                            >
	                              Add
	                            </Button>
	                            <Button
	                              type="button"
	                              size="sm"
	                              variant="outline"
	                              onClick={() => {
	                                setStockLaunch({ mode: 'contract', instrument: i, broker: selectedBroker })
	                                setStockDialogOpen(true)
	                              }}
	                            >
	                              Trade
	                            </Button>
	                          </div>
	                        </div>
	                      )
	                    })}
	                  </div>
	                </div>
	              ) : null}

	              {cashSections.indices.length ? (
	                <div className="rounded-lg border bg-card overflow-hidden">
	                  <div className="bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">Index</div>
	                  <div className="divide-y">
	                    {cashSections.indices.slice(0, 15).map((i) => {
	                      const suffix = formatDerivativeSuffix(i)
	                      return (
	                        <div key={i.canonical_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
	                          <div className="min-w-0">
	                            <div className="flex flex-wrap items-center gap-2">
	                              <div className="font-medium">{formatInstrumentTitle(i)}</div>
	                              <TypeBadge instrument={i} />
	                              <Badge variant="outline">{i.exchange}</Badge>
	                            </div>
	                            {suffix ? <div className="mt-1 text-xs text-muted-foreground">{suffix}</div> : null}
	                            <div className="mt-1 break-all text-xs text-muted-foreground">{i.canonical_id}</div>
	                          </div>
	                          <div className="flex items-center gap-2">
	                            <Button
	                              type="button"
	                              size="sm"
	                              variant="outline"
	                              onClick={() => void addToWatchlist.mutate({ canonical_id: i.canonical_id })}
	                              disabled={!accessToken}
	                            >
	                              Add
	                            </Button>
	                          </div>
	                        </div>
	                      )
	                    })}
	                  </div>
	                </div>
	              ) : null}

	              {cashSections.etfs.length ? (
	                <div className="rounded-lg border bg-card overflow-hidden">
	                  <div className="bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">ETF</div>
	                  <div className="divide-y">
	                    {cashSections.etfs.slice(0, 15).map((i) => {
	                      const suffix = formatDerivativeSuffix(i)
	                      return (
	                        <div key={i.canonical_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
	                          <div className="min-w-0">
	                            <div className="flex flex-wrap items-center gap-2">
	                              <div className="font-medium">{formatInstrumentTitle(i)}</div>
	                              <TypeBadge instrument={i} />
	                              <Badge variant="outline">{i.exchange}</Badge>
	                            </div>
	                            {suffix ? <div className="mt-1 text-xs text-muted-foreground">{suffix}</div> : null}
	                            <div className="mt-1 break-all text-xs text-muted-foreground">{i.canonical_id}</div>
	                          </div>
	                          <div className="flex items-center gap-2">
	                            <Button
	                              type="button"
	                              size="sm"
	                              variant="outline"
	                              onClick={() => void addToWatchlist.mutate({ canonical_id: i.canonical_id })}
	                              disabled={!accessToken}
	                            >
	                              Add
	                            </Button>
	                            <Button
	                              type="button"
	                              size="sm"
	                              variant="outline"
	                              onClick={() => {
	                                setStockLaunch({ mode: 'contract', instrument: i, broker: selectedBroker })
	                                setStockDialogOpen(true)
	                              }}
	                            >
	                              Trade
	                            </Button>
	                          </div>
	                        </div>
	                      )
	                    })}
	                  </div>
	                </div>
	              ) : null}

	              {searchMode === 'all' && fnoUnderlyings.length ? (
	                <div className="rounded-lg border bg-card overflow-hidden">
	                  <div className="bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">F&amp;O</div>
	                  <div className="divide-y">
	                    {fnoUnderlyings.map((u) => (
	                      <div key={u.underlying} className="p-3">
	                        <div className="flex flex-wrap items-center justify-between gap-3">
	                          <button
	                            type="button"
	                            className="min-w-0 truncate font-medium text-left hover:underline"
	                            onClick={() => {
	                              const next = u.underlying
	                              const opening = expandedUnderlying !== next
	                              setExpandedUnderlying(opening ? next : null)
	                              if (opening) {
	                                setStrikeWindow(10)
	                                setUnderlying(next)
	                                setUnderlyingQ(next)
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
	                              onClick={() => void addToWatchlist.mutate({ underlying: u.underlying })}
	                              disabled={!accessToken}
	                            >
	                              Add underlying
	                            </Button>
	                            <Button
	                              type="button"
	                              size="sm"
	                              variant="outline"
	                              onClick={() => {
	                                setFnoLaunch({ mode: 'manual', broker: selectedBroker, prefill: { underlying: u.underlying } })
	                                setUnderlying(u.underlying)
	                                setUnderlyingQ(u.underlying)
	                                setFnoDialogOpen(true)
	                              }}
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
	                                  setStrikeWindow(10)
	                                  setUnderlying(next)
	                                  setUnderlyingQ(next)
	                                }
	                              }}
	                            >
	                              {expandedUnderlying === u.underlying ? 'Hide' : 'Show'}
	                            </Button>
	                          </div>
	                        </div>

	                        {expandedUnderlying === u.underlying && underlying === u.underlying ? (
	                          <div className="mt-3 rounded-md border bg-muted/10 p-3">
	                            <div className="flex flex-wrap items-center justify-between gap-3">
	                              <div className="text-xs text-muted-foreground">
	                                {chainSpot != null ? (
	                                  <>
	                                    Spot <span className="font-medium tabular-nums">{chainSpot}</span>
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
	                                  value={expiry ?? ''}
	                                  onChange={(e) => setExpiry(e.target.value || null)}
	                                  disabled={!underlying || expiries.isFetching}
	                                  className={cn(
	                                    'h-8 rounded-md border border-input bg-card px-2 text-xs outline-none shadow-sm',
	                                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
	                                  )}
	                                >
	                                  <option value="">Expiry</option>
	                                  {validExpiries.map((d) => (
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
	                                  disabled={!expiry}
	                                >
	                                  {strikeWindow === 10 ? 'More' : 'Less'}
	                                </Button>
	                              </div>
	                            </div>

	                            {previewFuturesList.length ? (
	                              <div className="mt-3">
	                                <div className="text-xs font-medium text-muted-foreground">Futures (upcoming)</div>
	                                <div className="mt-2 flex flex-col gap-2">
	                                  {previewFuturesList.map((f) => (
	                                    <div key={f.canonical_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-2 py-2">
	                                      <div className="min-w-0">
	                                        <div className="font-medium">{formatInstrumentTitle(f)}</div>
	                                        <div className="mt-0.5 text-xs text-muted-foreground">
	                                          {f.expiry ?? '—'} • lot {f.lot_size ?? '—'}
	                                        </div>
	                                      </div>
	                                      <div className="flex items-center gap-2">
	                                        <Button
	                                          type="button"
	                                          size="sm"
	                                          variant="outline"
	                                          onClick={() => void addToWatchlist.mutate({ canonical_id: f.canonical_id })}
	                                        >
	                                          Add
	                                        </Button>
	                                        <Button
	                                          type="button"
	                                          size="sm"
	                                          variant="outline"
	                                          onClick={() => {
	                                            const ref = getPremium(f.canonical_id)
	                                            setFnoLaunch({ mode: 'contract', instrument: f, broker: selectedBroker, referencePrice: ref })
	                                            setFnoDialogOpen(true)
	                                          }}
	                                        >
	                                          Trade
	                                        </Button>
	                                      </div>
	                                    </div>
	                                  ))}
	                                </div>
	                              </div>
	                            ) : null}

	                            {expiry && previewChain.strikes.length ? (
	                              <div className="mt-4">
	                                <div className="text-xs font-medium text-muted-foreground">
	                                  Options (±{strikeWindow} around ATM) • {expiry}
	                                </div>
	                                <div className="mt-2 overflow-auto rounded-md border bg-card">
	                                  <div className="grid grid-cols-[1fr_auto_1fr] gap-0 text-xs">
	                                    <div className="border-b px-3 py-2 font-medium text-muted-foreground">Calls</div>
	                                    <div className="border-b px-3 py-2 font-medium text-muted-foreground text-center">Strike</div>
	                                    <div className="border-b px-3 py-2 font-medium text-muted-foreground text-right">Puts</div>
	                                    {previewChain.strikes.map((s) => {
	                                      const ce = previewChain.ceByStrike.get(s) ?? null
	                                      const pe = previewChain.peByStrike.get(s) ?? null
	                                      return (
	                                        <div key={s} className="contents">
	                                          <div className="border-b px-3 py-2">
	                                            {ce ? (
	                                              <div className="flex items-center gap-2">
	                                                <Badge variant="outline">CE</Badge>
	                                                <Button type="button" size="sm" variant="outline" onClick={() => void addToWatchlist.mutate({ canonical_id: ce.canonical_id })}>
	                                                  Add
	                                                </Button>
	                                                <Button
	                                                  type="button"
	                                                  size="sm"
	                                                  variant="outline"
	                                                  onClick={() => {
	                                                    const ref = getPremium(ce.canonical_id)
	                                                    setFnoLaunch({ mode: 'contract', instrument: ce, broker: selectedBroker, referencePrice: ref })
	                                                    setFnoDialogOpen(true)
	                                                  }}
	                                                >
	                                                  Trade
	                                                </Button>
	                                              </div>
	                                            ) : (
	                                              <span className="text-muted-foreground">—</span>
	                                            )}
	                                          </div>
	                                          <div className="border-b px-3 py-2 text-center tabular-nums">
	                                            {formatStrikeDisplay(s)}
	                                            {previewChain.atmStrike != null && s === previewChain.atmStrike ? (
	                                              <span className="ml-2 text-[11px] text-muted-foreground">ATM</span>
	                                            ) : null}
	                                          </div>
	                                          <div className="border-b px-3 py-2 flex justify-end">
	                                            {pe ? (
	                                              <div className="flex items-center gap-2">
	                                                <Button type="button" size="sm" variant="outline" onClick={() => void addToWatchlist.mutate({ canonical_id: pe.canonical_id })}>
	                                                  Add
	                                                </Button>
	                                                <Button
	                                                  type="button"
	                                                  size="sm"
	                                                  variant="outline"
	                                                  onClick={() => {
	                                                    const ref = getPremium(pe.canonical_id)
	                                                    setFnoLaunch({ mode: 'contract', instrument: pe, broker: selectedBroker, referencePrice: ref })
	                                                    setFnoDialogOpen(true)
	                                                  }}
	                                                >
	                                                  Trade
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
	                                  Need deeper strikes? Use “More” or the Strike discovery section below.
	                                </div>
	                              </div>
	                            ) : null}
	                          </div>
	                        ) : null}
	                      </div>
	                    ))}
	                  </div>
	                </div>
	              ) : null}
	            </div>
	          ) : null}

	          {searchMode === 'fno' && fnoUnderlyings.length ? (
	            <div className="rounded-lg border bg-card overflow-hidden">
	              <div className="bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">F&amp;O underlyings</div>
	              <div className="divide-y">
	                {fnoUnderlyings.map((u) => (
	                  <div key={u.underlying} className="p-3">
	                    <div className="flex flex-wrap items-center justify-between gap-3">
	                      <button
	                        type="button"
	                        className="min-w-0 truncate font-medium text-left hover:underline"
	                        onClick={() => {
	                          const next = u.underlying
	                          const opening = expandedUnderlying !== next
	                          setExpandedUnderlying(opening ? next : null)
	                          if (opening) {
	                            setStrikeWindow(10)
	                            setUnderlying(next)
	                            setUnderlyingQ(next)
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
	                          onClick={() => void addToWatchlist.mutate({ underlying: u.underlying })}
	                          disabled={!accessToken}
	                        >
	                          Add underlying
	                        </Button>
	                        <Button
	                          type="button"
	                          size="sm"
	                          variant="outline"
	                          onClick={() => {
	                            setFnoLaunch({ mode: 'manual', broker: selectedBroker, prefill: { underlying: u.underlying } })
	                            setUnderlying(u.underlying)
	                            setUnderlyingQ(u.underlying)
	                            setFnoDialogOpen(true)
	                          }}
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
	                              setStrikeWindow(10)
	                              setUnderlying(next)
	                              setUnderlyingQ(next)
	                            }
	                          }}
	                        >
	                          {expandedUnderlying === u.underlying ? 'Hide' : 'Show'}
	                        </Button>
	                      </div>
	                    </div>

	                    {expandedUnderlying === u.underlying && underlying === u.underlying ? (
	                      <div className="mt-3 rounded-md border bg-muted/10 p-3">
	                        <div className="flex flex-wrap items-center justify-between gap-3">
	                          <div className="text-xs text-muted-foreground">
	                            {chainSpot != null ? (
	                              <>
	                                Spot <span className="font-medium tabular-nums">{chainSpot}</span>
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
	                              value={expiry ?? ''}
	                              onChange={(e) => setExpiry(e.target.value || null)}
	                              disabled={!underlying || expiries.isFetching}
	                              className={cn(
	                                'h-8 rounded-md border border-input bg-card px-2 text-xs outline-none shadow-sm',
	                                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
	                              )}
	                            >
	                              <option value="">Expiry</option>
	                              {validExpiries.map((d) => (
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
	                              disabled={!expiry}
	                            >
	                              {strikeWindow === 10 ? 'More' : 'Less'}
	                            </Button>
	                          </div>
	                        </div>

	                        {previewFuturesList.length ? (
	                          <div className="mt-3">
	                            <div className="text-xs font-medium text-muted-foreground">Futures (upcoming)</div>
	                            <div className="mt-2 flex flex-col gap-2">
	                              {previewFuturesList.map((f) => (
	                                <div key={f.canonical_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-2 py-2">
	                                  <div className="min-w-0">
	                                    <div className="font-medium">{formatInstrumentTitle(f)}</div>
	                                    <div className="mt-0.5 text-xs text-muted-foreground">
	                                      {f.expiry ?? '—'} • lot {f.lot_size ?? '—'}
	                                    </div>
	                                  </div>
	                                  <div className="flex items-center gap-2">
	                                    <Button
	                                      type="button"
	                                      size="sm"
	                                      variant="outline"
	                                      onClick={() => void addToWatchlist.mutate({ canonical_id: f.canonical_id })}
	                                    >
	                                      Add
	                                    </Button>
	                                    <Button
	                                      type="button"
	                                      size="sm"
	                                      variant="outline"
	                                      onClick={() => {
	                                        const ref = getPremium(f.canonical_id)
	                                        setFnoLaunch({ mode: 'contract', instrument: f, broker: selectedBroker, referencePrice: ref })
	                                        setFnoDialogOpen(true)
	                                      }}
	                                    >
	                                      Trade
	                                    </Button>
	                                  </div>
	                                </div>
	                              ))}
	                            </div>
	                          </div>
	                        ) : null}

	                        {expiry && previewChain.strikes.length ? (
	                          <div className="mt-4">
	                            <div className="text-xs font-medium text-muted-foreground">
	                              Options (±{strikeWindow} around ATM) • {expiry}
	                            </div>
	                            <div className="mt-2 overflow-auto rounded-md border bg-card">
	                              <div className="grid grid-cols-[1fr_auto_1fr] gap-0 text-xs">
	                                <div className="border-b px-3 py-2 font-medium text-muted-foreground">Calls</div>
	                                <div className="border-b px-3 py-2 font-medium text-muted-foreground text-center">Strike</div>
	                                <div className="border-b px-3 py-2 font-medium text-muted-foreground text-right">Puts</div>
	                                {previewChain.strikes.map((s) => {
	                                  const ce = previewChain.ceByStrike.get(s) ?? null
	                                  const pe = previewChain.peByStrike.get(s) ?? null
	                                  return (
	                                    <div key={s} className="contents">
	                                      <div className="border-b px-3 py-2">
	                                        {ce ? (
	                                          <div className="flex items-center gap-2">
	                                            <Badge variant="outline">CE</Badge>
	                                            <Button type="button" size="sm" variant="outline" onClick={() => void addToWatchlist.mutate({ canonical_id: ce.canonical_id })}>
	                                              Add
	                                            </Button>
	                                            <Button
	                                              type="button"
	                                              size="sm"
	                                              variant="outline"
	                                              onClick={() => {
	                                                const ref = getPremium(ce.canonical_id)
	                                                setFnoLaunch({ mode: 'contract', instrument: ce, broker: selectedBroker, referencePrice: ref })
	                                                setFnoDialogOpen(true)
	                                              }}
	                                            >
	                                              Trade
	                                            </Button>
	                                          </div>
	                                        ) : (
	                                          <span className="text-muted-foreground">—</span>
	                                        )}
	                                      </div>
	                                      <div className="border-b px-3 py-2 text-center tabular-nums">
	                                        {formatStrikeDisplay(s)}
	                                        {previewChain.atmStrike != null && s === previewChain.atmStrike ? (
	                                          <span className="ml-2 text-[11px] text-muted-foreground">ATM</span>
	                                        ) : null}
	                                      </div>
	                                      <div className="border-b px-3 py-2 flex justify-end">
	                                        {pe ? (
	                                          <div className="flex items-center gap-2">
	                                            <Button type="button" size="sm" variant="outline" onClick={() => void addToWatchlist.mutate({ canonical_id: pe.canonical_id })}>
	                                              Add
	                                            </Button>
	                                            <Button
	                                              type="button"
	                                              size="sm"
	                                              variant="outline"
	                                              onClick={() => {
	                                                const ref = getPremium(pe.canonical_id)
	                                                setFnoLaunch({ mode: 'contract', instrument: pe, broker: selectedBroker, referencePrice: ref })
	                                                setFnoDialogOpen(true)
	                                              }}
	                                            >
	                                              Trade
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
	                              Need deeper strikes? Use “More” or the Strike discovery section below.
	                            </div>
	                          </div>
	                        ) : null}
	                      </div>
	                    ) : null}
	                  </div>
	                ))}
	              </div>
	            </div>
	          ) : null}

	          {watchlistMsg ? (
	            <div className="text-xs text-muted-foreground">{watchlistMsg}</div>
	          ) : null}
	        </CardContent>
	      </Card>

      <Card>
        <CardHeader>
          <CardTitle>F&amp;O strike discovery</CardTitle>
          <CardDescription>
            Select an underlying, pick expiry and CE/PE to browse the canonical option chain. Use Trade to open the F&amp;O ticket.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Underlying</div>
              <div className="flex items-center gap-2">
                <Input
                  value={underlyingQ}
                  onChange={(e) => setUnderlyingQ(e.target.value)}
                  onBlur={() => applyUnderlyingFromInput()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      applyUnderlyingFromInput()
                    }
                  }}
                  placeholder="Type NIFTY, BANKNIFTY…"
                  aria-label="Underlying search query"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => applyUnderlyingFromInput()}
                  disabled={!underlyingQ.trim()}
                >
                  Set
                </Button>
              </div>
              {underlyingCandidates.length && debouncedUnderlying ? (
                <div className="rounded-md border bg-card">
                  {underlyingCandidates.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        setUnderlying(name)
                        setUnderlyingQ(name)
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent/30',
                        underlying === name && 'bg-accent/30',
                      )}
                    >
                      <span className="font-medium">{name}</span>
                      <span className="text-xs text-muted-foreground">Use</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="text-xs text-muted-foreground">
                Selected: {underlying ?? '—'}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Expiry</div>
              <select
                aria-label="Expiry select"
                value={expiry ?? ''}
                onChange={(e) => setExpiry(e.target.value || null)}
                onFocus={() => {
                  if (!underlying) applyUnderlyingFromInput()
                }}
                disabled={!underlying || expiries.isFetching}
                className={cn(
                  'h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              >
                <option value="">Select expiry</option>
                {validExpiries.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              {expiries.isFetching ? (
                <div className="text-xs text-muted-foreground">Loading expiries…</div>
              ) : null}
              {underlying && !expiries.isFetching && validExpiries.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No upcoming expiries found. Sync F&amp;O for {underlying} first.
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Option type</div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={optionType === 'CE' ? 'default' : 'outline'}
                  onClick={() => setOptionType('CE')}
                >
                  CE
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={optionType === 'PE' ? 'default' : 'outline'}
                  onClick={() => setOptionType('PE')}
                >
                  PE
                </Button>
              </div>
            </div>
          </div>

          {optionChain.isFetching ? (
            <div className="text-xs text-muted-foreground">Loading option chain…</div>
          ) : null}

          {underlying && expiry && !chainItems.length && !optionChain.isFetching ? (
            <div className="text-xs text-muted-foreground">
              No options found for {underlying} {expiry} {optionType}.
            </div>
          ) : null}

          {chainItems.length ? (
            <div className="rounded-lg border bg-card">
              <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                <div className="text-sm font-medium">
                  {underlying} • {expiry} • {optionType}
                </div>
                <div className="text-xs text-muted-foreground">
                  {chainItems.length} contracts
                </div>
              </div>
              <div className="divide-y">
                {chainItems.slice(0, 120).map((i) => (
                  <div key={i.canonical_id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-medium tabular-nums">{formatStrikeDisplay(i.strike)}</div>
                        <Badge variant="outline">{i.option_type}</Badge>
                        {typeof i.strike === 'number' && i.option_type ? (
                          <MoneynessPill
                            label={computeMoneyness(i.strike, { optionType, spot: chainSpot, atmStrike: chainAtmStrike })}
                          />
                        ) : null}
                        <div className="text-xs text-muted-foreground">
                          lot {i.lot_size ?? '—'}
                        </div>
                        {(() => {
                          const p = getPremium(i.canonical_id)
                          return p != null ? (
                            <div className="text-xs text-muted-foreground">
                              prem <span className="font-medium tabular-nums">₹{p}</span>
                            </div>
                          ) : null
                        })()}
                      </div>
                      <div className="mt-1 break-all text-xs text-muted-foreground">{i.canonical_id}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-xs text-muted-foreground">
                        {(i.underlying ?? i.symbol_root).toUpperCase()} {i.expiry ?? '—'}{' '}
                        {formatStrikeDisplay(i.strike)} {i.option_type ?? '—'}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void addToWatchlist.mutate({ canonical_id: i.canonical_id })}
                        disabled={!accessToken}
                      >
                        Add
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const ref = getPremium(i.canonical_id)
                          setFnoLaunch({
                            mode: 'contract',
                            instrument: i,
                            broker: selectedBroker,
                            referencePrice: ref,
                          })
                          setFnoDialogOpen(true)
                        }}
                      >
                        Trade
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {chainItems.length > 120 ? (
                <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                  Showing first 120 strikes. Narrow the underlying/expiry if needed.
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {stockLaunch ? (
        <StockOrderDialog
          key={
            stockLaunch.mode === 'contract'
              ? stockLaunch.instrument.canonical_id
              : 'stock-manual'
          }
          open={stockDialogOpen}
          onOpenChange={onStockDialogOpenChange}
          launch={stockLaunch}
        />
      ) : null}

      {fnoLaunch ? (
        <FnoOrderDialog
          key={
            fnoLaunch.mode === 'contract'
              ? fnoLaunch.instrument.canonical_id
              : 'fno-manual'
          }
          open={fnoDialogOpen}
          onOpenChange={onFnoDialogOpenChange}
          launch={fnoLaunch}
        />
      ) : null}
    </div>
  )
}
