import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

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
import * as watchlistsApi from '@/lib/api/watchlists'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useQuoteStore } from '@/store/quoteStore'
import { computeAtmStrike, computeMoneyness, moneynessBadgeClasses } from '@/lib/moneyness'
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
  const formatStrike = (strike: number) => {
    if (strike >= 100_000) {
      const v = strike / 100
      return Number.isInteger(v) ? String(v) : v.toFixed(2)
    }
    return String(strike)
  }
  const bits: string[] = []
  if (i.expiry) bits.push(i.expiry)
  if (i.strike != null) bits.push(formatStrike(i.strike))
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

function formatStrikeHuman(strike: number | null): string {
  if (strike == null) return '—'
  if (strike >= 100_000) {
    const v = strike / 100
    return Number.isInteger(v) ? String(v) : v.toFixed(2)
  }
  return String(strike)
}

function formatInstrumentTitle(i: instrumentsApi.InstrumentOut): string {
  const root = (i.underlying ?? i.symbol_root).toUpperCase()

  if (i.instrument_type === 'OPTION') {
    return `${root} ${formatExpiryHuman(i.expiry)} ${formatStrikeHuman(i.strike)} ${i.option_type ?? ''}`.trim()
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

  const getPremium = useQuoteStore((s) => s.getPremium)
  const getSpot = useQuoteStore((s) => s.getSpot)

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
    | { mode: 'manual'; broker?: BrokerKey | null }
    | {
        mode: 'contract'
        instrument: instrumentsApi.InstrumentOut
        broker?: BrokerKey | null
        referencePrice?: number | null
      }
    | null
  >(null)

  const [q, setQ] = useState('')
  const [filterType, setFilterType] = useState<
    'all' | instrumentsApi.InstrumentType
  >('all')
  const debouncedQ = useDebounced(q.trim(), 300)

  const addToWatchlist = useMutation({
    mutationFn: async (canonicalId: string) => {
      if (!accessToken) throw new Error('no auth')
      const activeId = safeStoredActiveWatchlistId()
      if (activeId) {
        try {
          return await watchlistsApi.addWatchlistItem(accessToken, activeId, {
            canonical_id: canonicalId,
          })
        } catch {
          // Fall back to default watchlist if active is stale/missing.
        }
      }
      return watchlistsApi.addWatchlistItemDefault(accessToken, { canonical_id: canonicalId })
    },
    onSuccess: () => setWatchlistMsg('Added to watchlist'),
    onError: () => setWatchlistMsg('Add to watchlist failed'),
  })

  const search = useQuery({
    queryKey: ['instruments', 'search', debouncedQ, filterType],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      return instrumentsApi.searchInstruments(accessToken, {
        q: debouncedQ,
        limit: 50,
        instrument_type: filterType === 'all' ? undefined : filterType,
      })
    },
    enabled: Boolean(accessToken) && debouncedQ.length > 0,
  })

  const results = search.data?.items ?? []

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

  useEffect(() => {
    setExpiry(null)
  }, [underlying])

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
  const formatStrikeDisplay = formatStrikeHuman
  const chainSpot = useMemo(() => (underlying ? getSpot(underlying) : null), [getSpot, underlying])
  const chainAtmStrike = useMemo(() => {
    const strikes = chainItems
      .map((i) => i.strike)
      .filter((s): s is number => typeof s === 'number' && Number.isFinite(s))
    return computeAtmStrike(strikes, { spot: chainSpot, anchorStrike: null })
  }, [chainItems, chainSpot])

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Search</h1>
          <p className="text-sm text-muted-foreground">
            Canonical-first instrument search (no broker symbols in UI). Use Trade to open stock or F&amp;O tickets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground">Broker context</div>
          <select
            aria-label="Broker context"
            value={selectedBroker ?? ''}
            onChange={(e) => void onBrokerChange(e.target.value)}
            disabled={brokerBusy}
            className={cn(
              'h-9 rounded-md border bg-background px-2 text-sm outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring',
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
            <select
              aria-label="Instrument type filter"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as typeof filterType)}
              className={cn(
                'h-10 rounded-md border bg-background px-2 text-sm outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <option value="all">All</option>
              <option value="EQUITY">Equity</option>
              <option value="INDEX">Index</option>
              <option value="FUTURE">Future</option>
              <option value="OPTION">Option</option>
              <option value="ETF">ETF</option>
            </select>
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

          {search.isFetching ? (
            <div className="text-xs text-muted-foreground">Searching…</div>
          ) : null}

          {search.isError ? (
            <div className="text-xs text-destructive">
              Search failed. Open DevTools → Network → <span className="font-mono">/api/v1/instruments/search</span> for details.
            </div>
          ) : null}

          {debouncedQ && !results.length && !search.isFetching && !search.isError ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                No matches{filterType !== 'all' ? ` in ${filterType}` : ''}.
              </span>
              {filterType !== 'all' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setFilterType('all')}
                >
                  Try All
                </Button>
              ) : null}
              <span className="text-muted-foreground/80">
                If you reset the DB, run Sync equities (stocks/ETFs) and Sync F&amp;O (underlyings) for options/futures.
              </span>
            </div>
          ) : null}

          {results.length ? (
            <div className="divide-y rounded-lg border bg-card">
              {results.map((i) => {
                const suffix = formatDerivativeSuffix(i)
                const canStockTrade =
                  i.segment === 'EQUITY' &&
                  (i.instrument_type === 'EQUITY' || i.instrument_type === 'ETF')
                const canFnoTrade =
                  i.exchange === 'NSE_FNO' &&
                  (i.instrument_type === 'OPTION' || i.instrument_type === 'FUTURE')
                return (
                  <div key={i.canonical_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium">{formatInstrumentTitle(i)}</div>
                        <TypeBadge instrument={i} />
                        <Badge variant="outline">{i.exchange}</Badge>
                        <Badge variant="outline">{i.segment}</Badge>
                      </div>
                      {suffix ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {suffix}
                        </div>
                      ) : null}
                      <div className="mt-1 break-all text-xs text-muted-foreground">
                        {i.canonical_id}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void addToWatchlist.mutate(i.canonical_id)}
                        disabled={!accessToken}
                      >
                        Add
                      </Button>
                      {canStockTrade ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setStockLaunch({
                              mode: 'contract',
                              instrument: i,
                              broker: selectedBroker,
                            })
                            setStockDialogOpen(true)
                          }}
                        >
                          Trade
                        </Button>
                      ) : canFnoTrade ? (
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
                      ) : null}
                    </div>
                  </div>
                )
              })}
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
                  'h-10 w-full rounded-md border bg-background px-2 text-sm outline-none',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <option value="">Select expiry</option>
                {(expiries.data?.expiries ?? []).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              {expiries.isFetching ? (
                <div className="text-xs text-muted-foreground">Loading expiries…</div>
              ) : null}
              {underlying && !expiries.isFetching && (expiries.data?.expiries ?? []).length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No expiries found. Sync F&amp;O for {underlying} first.
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
                        onClick={() => void addToWatchlist.mutate(i.canonical_id)}
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
