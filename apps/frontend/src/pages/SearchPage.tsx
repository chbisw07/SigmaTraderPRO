import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

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
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

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
  const bits: string[] = []
  if (i.expiry) bits.push(i.expiry)
  if (i.strike != null) bits.push(String(i.strike))
  if (i.option_type) bits.push(i.option_type)
  return bits.length ? bits.join(' • ') : null
}

const BROKER_OPTIONS = [
  { key: 'angel', label: 'Angel One' },
  { key: 'zerodha', label: 'Zerodha' },
] as const

type BrokerKey = (typeof BROKER_OPTIONS)[number]['key']

export function SearchPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const updateLastUsedBroker = useAuthStore((s) => s.updateLastUsedBroker)

  const selectedBroker = (user?.last_used_broker as BrokerKey | null) ?? null

  const [brokerBusy, setBrokerBusy] = useState(false)

  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [syncUnderlyings, setSyncUnderlyings] = useState('NIFTY,BANKNIFTY')

  const [q, setQ] = useState('')
  const [filterType, setFilterType] = useState<
    'all' | instrumentsApi.InstrumentType
  >('all')
  const debouncedQ = useDebounced(q.trim(), 300)

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

  const chainItems = optionChain.data?.items ?? []

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Search</h1>
          <p className="text-sm text-muted-foreground">
            Canonical-first instrument search (no broker symbols in UI). Strike discovery is read-only for now.
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
            </div>
          </div>
          {syncMsg ? (
            <div className={cn('text-xs', syncMsg.toLowerCase().includes('fail') ? 'text-destructive' : 'text-muted-foreground')}>
              {syncMsg}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Tip: start with equities, then sync F&amp;O for NIFTY/BANKNIFTY.
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

          {debouncedQ && !results.length && !search.isFetching ? (
            <div className="text-xs text-muted-foreground">No matches.</div>
          ) : null}

          {results.length ? (
            <div className="divide-y rounded-lg border bg-card">
              {results.map((i) => {
                const suffix = formatDerivativeSuffix(i)
                return (
                  <div key={i.canonical_id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium">{i.display_symbol}</div>
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
                  </div>
                )
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>F&amp;O strike discovery</CardTitle>
          <CardDescription>
            Select an underlying, pick expiry and CE/PE to browse the canonical option chain. No order actions yet.
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
                        <div className="font-medium tabular-nums">{i.strike ?? '—'}</div>
                        <Badge variant="outline">{i.option_type}</Badge>
                        <div className="text-xs text-muted-foreground">
                          lot {i.lot_size ?? '—'}
                        </div>
                      </div>
                      <div className="mt-1 break-all text-xs text-muted-foreground">{i.canonical_id}</div>
                    </div>
                    <div className="text-xs text-muted-foreground">{i.display_symbol}</div>
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
    </div>
  )
}
