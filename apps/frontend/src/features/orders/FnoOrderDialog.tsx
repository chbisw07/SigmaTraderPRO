import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import * as brokersApi from '@/lib/api/brokers'
import { readiness } from '@/lib/api/health'
import * as instrumentsApi from '@/lib/api/instruments'
import * as ordersApi from '@/lib/api/orders'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useOrderPrefsStore } from '@/store/orderPrefsStore'
import { useQuoteStore } from '@/store/quoteStore'
import { computeAtmStrike, computeMoneyness, moneynessBadgeClasses } from '@/lib/moneyness'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  launch:
    | { mode: 'manual'; broker?: ordersApi.BrokerKey | null }
    | {
        mode: 'contract'
        instrument: instrumentsApi.InstrumentOut
        broker?: ordersApi.BrokerKey | null
        referencePrice?: number | null
      }
}

function formatStrike(strike: number | null): string {
  if (strike === null) return '—'
  if (strike >= 100_000) {
    const v = strike / 100
    return Number.isInteger(v) ? String(v) : v.toFixed(2)
  }
  return String(strike)
}

const EMPTY_STRIKES: number[] = []

export function FnoOrderDialog({ open, onOpenChange, launch }: Props) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const updateLastUsedBroker = useAuthStore((s) => s.updateLastUsedBroker)

  const fnoProductPref = useOrderPrefsStore((s) => s.fnoProduct)
  const fnoOrderTypePref = useOrderPrefsStore((s) => s.fnoOrderType)
  const setFnoProductPref = useOrderPrefsStore((s) => s.setFnoProduct)
  const setFnoOrderTypePref = useOrderPrefsStore((s) => s.setFnoOrderType)

  const instrument = launch.mode === 'contract' ? launch.instrument : null

  const getPremium = useQuoteStore((s) => s.getPremium)
  const setPremium = useQuoteStore((s) => s.setPremium)
  const getSpot = useQuoteStore((s) => s.getSpot)

  const initialBroker =
    (launch.broker as ordersApi.BrokerKey | null | undefined) ??
    (user?.last_used_broker === 'angel' || user?.last_used_broker === 'zerodha'
      ? (user.last_used_broker as ordersApi.BrokerKey)
      : null) ??
    'angel'
  const initialInstrumentType: ordersApi.DerivativeInstrumentType =
    launch.mode === 'contract' && instrument?.instrument_type === 'FUTURE'
      ? 'FUTURE'
      : 'OPTION'
  const initialUnderlying =
    launch.mode === 'contract' && instrument
      ? (instrument.underlying ?? instrument.symbol_root ?? '')
          .trim()
          .toUpperCase()
      : ''
  const initialExpiry =
    launch.mode === 'contract' && instrument ? (instrument.expiry ?? '') : ''
  const initialOptionType =
    launch.mode === 'contract' && instrument
      ? ((instrument.option_type as 'CE' | 'PE' | null) ?? 'CE')
      : 'CE'
  const initialStrike =
    launch.mode === 'contract' && instrument ? (instrument.strike ?? null) : null
  const initialPremium =
    launch.mode === 'contract' && instrument
      ? (launch.referencePrice ?? getPremium(instrument.canonical_id))
      : null

  const [broker, setBroker] = useState<ordersApi.BrokerKey>(initialBroker)
  const [instrumentType, setInstrumentType] =
    useState<ordersApi.DerivativeInstrumentType>(initialInstrumentType)
  const [underlying, setUnderlying] = useState<string>(initialUnderlying)
  const [expiry, setExpiry] = useState<string>(initialExpiry)
  const [optionType, setOptionType] = useState<'CE' | 'PE'>(initialOptionType)
  const [strike, setStrike] = useState<number | null>(initialStrike)

  const [side, setSide] = useState<ordersApi.OrderSide>('BUY')
  const [lots, setLots] = useState(1)
  const [product, setProduct] = useState<'MIS' | 'NRML'>(fnoProductPref)
  const [orderType, setOrderType] = useState<ordersApi.OrderType>(fnoOrderTypePref)
  const [limitPrice, setLimitPrice] = useState<number | null>(
    fnoOrderTypePref === 'LIMIT' ? initialPremium : null,
  )

  const [message, setMessage] = useState<string | null>(null)
  const [preview, setPreview] = useState<ordersApi.FnoOrderPreviewResponse | null>(null)

  const contractMatchesSelection = useMemo(() => {
    if (launch.mode !== 'contract' || !instrument) return false
    const instUnderlying = (instrument.underlying ?? instrument.symbol_root ?? '')
      .trim()
      .toUpperCase()
    if (!instUnderlying) return false
    if (instUnderlying !== underlying.trim().toUpperCase()) return false
    if ((instrument.expiry ?? '') !== expiry) return false
    if (instrument.instrument_type === 'FUTURE' && instrumentType !== 'FUTURE') return false
    if (instrument.instrument_type === 'OPTION' && instrumentType !== 'OPTION') return false
    if (instrumentType === 'OPTION') {
      if ((instrument.option_type as 'CE' | 'PE' | null) !== optionType) return false
      if ((instrument.strike ?? null) !== strike) return false
    }
    return true
  }, [expiry, instrument, instrumentType, launch.mode, optionType, strike, underlying])

  const selectionCanonicalId = useMemo(() => {
    const u = underlying.trim().toUpperCase()
    if (!u || !expiry) return null
    if (instrumentType === 'FUTURE') {
      return `NSE_FNO:FUTURE:FUTURE:${u}:${expiry}`
    }
    if (strike === null) return null
    const strikeTxt = Number.isInteger(strike) ? String(Math.trunc(strike)) : `${strike}`
    return `NSE_FNO:OPTION:OPTION:${u}:${expiry}:${strikeTxt}:${optionType}`
  }, [expiry, instrumentType, optionType, strike, underlying])

  const launchReferencePrice =
    launch.mode === 'contract' ? (launch.referencePrice ?? null) : null

  const hydratedPremium = useMemo(() => {
    if (launch.mode === 'contract' && instrument && contractMatchesSelection) {
      if (launchReferencePrice != null && Number.isFinite(launchReferencePrice)) {
        return launchReferencePrice
      }
      return getPremium(instrument.canonical_id)
    }
    if (selectionCanonicalId) return getPremium(selectionCanonicalId)
    return null
  }, [contractMatchesSelection, getPremium, instrument, launch.mode, launchReferencePrice, selectionCanonicalId])

  const spot = useMemo(() => getSpot(underlying), [getSpot, underlying])

  const derivedQuantity = useMemo(() => {
    if (preview) return preview.quantity
    if (!contractMatchesSelection) return null
    const lotSize = instrument?.lot_size ?? null
    if (!lotSize || lotSize <= 0) return null
    if (!lots || lots < 1) return null
    return lotSize * lots
  }, [contractMatchesSelection, instrument?.lot_size, lots, preview])

  // Contract-driven state hydration is handled via key-based remounting at the call-site (SearchPage),
  // keeping this component free of "setState in effect" cascades and preventing stale ticket state.

  const brokers = useQuery({
    queryKey: ['brokers', 'status'],
    queryFn: async () => {
      if (!accessToken) return []
      return brokersApi.listBrokerStatus(accessToken)
    },
    enabled: Boolean(accessToken) && open,
    refetchInterval: 30_000,
  })

  const backendReady = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: readiness,
    enabled: open,
    refetchInterval: 30_000,
    retry: false,
  })

  const brokerByKey = useMemo(() => {
    const map: Record<string, brokersApi.BrokerStatus> = {}
    for (const s of brokers.data ?? []) map[s.broker] = s
    return map
  }, [brokers.data])

  const brokerStatus = brokerByKey[broker]
  const brokerHint = brokerStatus?.state ? `${brokerStatus.state}` : '—'
  const zerodhaMarketBlocked = broker === 'zerodha' && orderType === 'MARKET'
  const schemaOk = backendReady.data?.schema?.ok ?? true
  const schemaError = backendReady.data?.schema?.error ?? null

  const expiries = useQuery({
    queryKey: ['derivatives', 'expiries', underlying, instrumentType],
    queryFn: async () => {
      if (!accessToken) throw new Error('Not authenticated')
      return instrumentsApi.derivativeExpiries(accessToken, {
        underlying: underlying.trim(),
        exchange: 'NSE_FNO',
        instrument_type: instrumentType,
        limit: 50,
      })
    },
    enabled: Boolean(accessToken) && open && Boolean(underlying.trim()),
  })

  const strikes = useQuery({
    queryKey: ['derivatives', 'strikes', underlying, expiry, optionType],
    queryFn: async () => {
      if (!accessToken) throw new Error('Not authenticated')
      return instrumentsApi.derivativeStrikes(accessToken, {
        underlying: underlying.trim(),
        expiry,
        exchange: 'NSE_FNO',
        option_type: optionType,
        limit: 800,
      })
    },
    enabled: Boolean(accessToken) && open && instrumentType === 'OPTION' && Boolean(underlying.trim()) && Boolean(expiry),
  })

  const strikesList = strikes.data?.strikes ?? EMPTY_STRIKES
  const atmStrike = useMemo(
    () =>
      computeAtmStrike(strikesList, {
        spot,
        anchorStrike: strike ?? (instrument?.strike ?? null),
      }),
    [instrument?.strike, spot, strike, strikesList],
  )

  const selectedMoneyness = useMemo(() => {
    if (instrumentType !== 'OPTION' || strike === null) return null
    return computeMoneyness(strike, { optionType, spot, atmStrike })
  }, [atmStrike, instrumentType, optionType, spot, strike])

  const payload = useMemo<ordersApi.FnoOrderBase>(
    () => ({
      broker,
      instrument_type: instrumentType,
      underlying: underlying.trim(),
      expiry,
      strike: instrumentType === 'OPTION' ? strike : null,
      option_type: instrumentType === 'OPTION' ? optionType : null,
      side,
      lots,
      product,
      order_type: orderType,
      // If we have a cached reference premium, treat it as a safe default for LIMIT
      // so preview/create uses the same number the UI is showing.
      limit_price: orderType === 'LIMIT' ? (limitPrice ?? hydratedPremium) : null,
    }),
    [broker, instrumentType, underlying, expiry, strike, optionType, side, lots, product, orderType, limitPrice, hydratedPremium],
  )

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Not authenticated')
      return ordersApi.previewFnoOrder(accessToken, payload)
    },
    onSuccess: (data) => {
      setPreview(data)
      setMessage(null)
      if (data.order_type === 'LIMIT' && data.limit_price && data.instrument?.canonical_id) {
        setPremium(data.instrument.canonical_id, data.limit_price)
      } else if (orderType === 'LIMIT' && selectionCanonicalId) {
        const ref = limitPrice ?? hydratedPremium
        if (ref != null) setPremium(selectionCanonicalId, ref)
      }
    },
    onError: (err) => {
      const msg =
        typeof err === 'object' && err && 'message' in err
          ? String((err as { message?: unknown }).message ?? 'Preview failed')
          : 'Preview failed'
      setMessage(msg)
      setPreview(null)
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Not authenticated')
      return ordersApi.createFnoOrder(accessToken, payload)
    },
    onSuccess: async (data) => {
      setMessage(`Order submitted. Broker order id: ${data.broker_order_id ?? '—'}`)
      setPreview(data.preview)
      if (data.preview?.order_type === 'LIMIT' && data.preview.limit_price && data.preview.instrument?.canonical_id) {
        setPremium(data.preview.instrument.canonical_id, data.preview.limit_price)
      } else if (orderType === 'LIMIT' && selectionCanonicalId) {
        const ref = limitPrice ?? hydratedPremium
        if (ref != null) setPremium(selectionCanonicalId, ref)
      }
      await updateLastUsedBroker(broker)
    },
    onError: (err) => {
      const msg =
        typeof err === 'object' && err && 'message' in err
          ? String((err as { message?: unknown }).message ?? 'Order failed')
          : 'Order failed'
      setMessage(msg)
    },
  })

  const onClose = () => {
    setMessage(null)
    setPreview(null)
    onOpenChange(false)
  }

  const canPreview =
    Boolean(accessToken) &&
    schemaOk &&
    Boolean(underlying.trim()) &&
    Boolean(expiry) &&
    lots >= 1 &&
    !zerodhaMarketBlocked &&
    (instrumentType === 'FUTURE' || (strike !== null && strike > 0))

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : onClose())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>F&amp;O order</DialogTitle>
          <DialogDescription>
            {launch.mode === 'contract'
              ? 'Contract-driven derivatives order (S4.2). Uses selected canonical contract fields; broker routing resolves internally.'
              : 'Manual derivatives order (S4.2). Select canonical contract fields; broker routing resolves internally.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium">{instrumentType === 'OPTION' ? 'Option' : 'Future'}</div>
                  <Badge variant="outline">NSE_FNO</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Underlying: <span className="font-medium">{underlying.trim() || '—'}</span>
                  {' • '}
                  Expiry: <span className="font-medium">{expiry || '—'}</span>
                  {instrumentType === 'OPTION' ? (
                    <>
                      {' • '}
                      Strike: <span className="font-medium tabular-nums">{formatStrike(strike)}</span>
                      {' • '}
                      <span className="font-medium">{optionType}</span>
                    </>
                  ) : null}
                </div>
              </div>
              {preview ? <Badge variant="outline">Ready</Badge> : <Badge variant="outline">Draft</Badge>}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Broker</div>
              <select
                aria-label="F&O broker"
                value={broker}
                onChange={(e) => {
                  setBroker(e.target.value as ordersApi.BrokerKey)
                  setPreview(null)
                }}
                className={cn(
                  'h-10 w-full rounded-md border bg-background px-2 text-sm outline-none',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <option value="angel">Angel One</option>
                <option value="zerodha">Zerodha</option>
              </select>
              <div className="text-[11px] text-muted-foreground">Status: {brokerHint}</div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Instrument</div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={instrumentType === 'OPTION' ? 'default' : 'outline'}
                  onClick={() => {
                    setInstrumentType('OPTION')
                    setPreview(null)
                    setLimitPrice(null)
                  }}
                >
                  Option
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={instrumentType === 'FUTURE' ? 'default' : 'outline'}
                  onClick={() => {
                    setInstrumentType('FUTURE')
                    setStrike(null)
                    setPreview(null)
                    setLimitPrice(null)
                  }}
                >
                  Future
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Side</div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={side === 'BUY' ? 'default' : 'outline'}
                  onClick={() => {
                    setSide('BUY')
                    setPreview(null)
                  }}
                >
                  Buy
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={side === 'SELL' ? 'default' : 'outline'}
                  onClick={() => {
                    setSide('SELL')
                    setPreview(null)
                  }}
                >
                  Sell
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Underlying</div>
              <Input
                aria-label="F&O underlying"
                value={underlying}
                onChange={(e) => {
                  setUnderlying(e.target.value)
                  setExpiry('')
                  setStrike(null)
                  setPreview(null)
                  setLimitPrice(null)
                }}
                placeholder="NIFTY, BANKNIFTY, INFY…"
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Expiry</div>
              <select
                aria-label="F&O expiry"
                value={expiry}
                onChange={(e) => {
                  setExpiry(e.target.value)
                  setStrike(null)
                  setPreview(null)
                  setLimitPrice(null)
                }}
                disabled={!underlying.trim() || expiries.isFetching}
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
              {expiries.isFetching ? <div className="text-[11px] text-muted-foreground">Loading expiries…</div> : null}
            </div>

            {instrumentType === 'OPTION' ? (
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Option type</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={optionType === 'CE' ? 'default' : 'outline'}
                    onClick={() => {
                      setOptionType('CE')
                      setPreview(null)
                      setLimitPrice(null)
                    }}
                  >
                    CE
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={optionType === 'PE' ? 'default' : 'outline'}
                    onClick={() => {
                      setOptionType('PE')
                      setPreview(null)
                      setLimitPrice(null)
                    }}
                  >
                    PE
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Lots</div>
                <Input
                  aria-label="F&O lots"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={lots}
                  onChange={(e) => {
                    setLots(Number(e.target.value || 0))
                    setPreview(null)
                  }}
                />
              </div>
            )}
          </div>

          {instrumentType === 'OPTION' ? (
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Strike</div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="F&O strike"
                    value={strike ?? ''}
                    onChange={(e) => {
                      const nextStrike = e.target.value ? Number(e.target.value) : null
                      setStrike(nextStrike)
                      setPreview(null)
                      if (orderType === 'LIMIT') setLimitPrice(null)
                    }}
                    disabled={!underlying.trim() || !expiry || strikes.isFetching}
                    className={cn(
                      'h-10 w-full flex-1 rounded-md border bg-background px-2 text-sm outline-none',
                      'focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    <option value="">Select strike</option>
                    {(strikes.data?.strikes ?? []).slice(0, 400).map((s) => {
                      const m = computeMoneyness(s, { optionType, spot, atmStrike })
                      return (
                        <option key={s} value={s}>
                          {formatStrike(s)} • {m}
                        </option>
                      )
                    })}
                  </select>
                  {selectedMoneyness ? (
                    <span
                      className={cn(
                        'inline-flex h-8 items-center rounded-md border px-2 text-xs font-medium',
                        moneynessBadgeClasses(selectedMoneyness),
                      )}
                    >
                      {selectedMoneyness}
                    </span>
                  ) : null}
                </div>
                {strikes.isFetching ? <div className="text-[11px] text-muted-foreground">Loading strikes…</div> : null}
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Lots</div>
                <Input
                  aria-label="F&O lots"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={lots}
                  onChange={(e) => {
                    setLots(Number(e.target.value || 0))
                    setPreview(null)
                  }}
                />
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Product</div>
                <select
                  aria-label="F&O product"
                  value={product}
                  onChange={(e) => {
                    const next = e.target.value as 'MIS' | 'NRML'
                    setProduct(next)
                    setFnoProductPref(next)
                    setPreview(null)
                  }}
                  className={cn(
                    'h-10 w-full rounded-md border bg-background px-2 text-sm outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <option value="NRML">NRML</option>
                  <option value="MIS">MIS</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Product</div>
                <select
                  aria-label="F&O product"
                  value={product}
                  onChange={(e) => {
                    const next = e.target.value as 'MIS' | 'NRML'
                    setProduct(next)
                    setFnoProductPref(next)
                    setPreview(null)
                  }}
                  className={cn(
                    'h-10 w-full rounded-md border bg-background px-2 text-sm outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <option value="NRML">NRML</option>
                  <option value="MIS">MIS</option>
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Order type</div>
                <select
                  aria-label="F&O order type"
                  value={orderType}
                  onChange={(e) => {
                    const next = e.target.value as ordersApi.OrderType
                    setOrderType(next)
                    setFnoOrderTypePref(next)
                    setPreview(null)
                  }}
                  className={cn(
                    'h-10 w-full rounded-md border bg-background px-2 text-sm outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <option value="LIMIT">Limit</option>
                  <option value="MARKET">Market</option>
                </select>
                {zerodhaMarketBlocked ? (
                  <div className="text-[11px] text-muted-foreground">
                    Zerodha API requires market protection for MARKET. Use LIMIT for now.
                  </div>
                ) : null}
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Limit price</div>
                <Input
                  aria-label="F&O limit price"
                  type="number"
                  inputMode="decimal"
                  step="0.05"
                  disabled={orderType !== 'LIMIT'}
                  value={orderType === 'LIMIT' ? (limitPrice ?? hydratedPremium ?? '') : ''}
                  onChange={(e) => {
                    const raw = e.target.value
                    setLimitPrice(raw ? Number(raw) : null)
                    setPreview(null)
                  }}
                  placeholder={orderType === 'LIMIT' ? 'Premium/Price' : '—'}
                />
              </div>
            </div>
          )}

          {/* Shared order type / price controls for option mode */}
          {instrumentType === 'OPTION' ? (
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Order type</div>
                <select
                  aria-label="F&O order type"
                  value={orderType}
                  onChange={(e) => {
                    const next = e.target.value as ordersApi.OrderType
                    setOrderType(next)
                    setFnoOrderTypePref(next)
                    if (next === 'LIMIT' && limitPrice == null && hydratedPremium != null) {
                      setLimitPrice(hydratedPremium)
                    }
                    setPreview(null)
                  }}
                  className={cn(
                    'h-10 w-full rounded-md border bg-background px-2 text-sm outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <option value="LIMIT">Limit</option>
                  <option value="MARKET">Market</option>
                </select>
                {zerodhaMarketBlocked ? (
                  <div className="text-[11px] text-muted-foreground">
                    Zerodha API requires market protection for MARKET. Use LIMIT for now.
                  </div>
                ) : null}
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Limit price</div>
                <Input
                  aria-label="F&O limit price"
                  type="number"
                  inputMode="decimal"
                  step="0.05"
                  disabled={orderType !== 'LIMIT'}
                  value={orderType === 'LIMIT' ? (limitPrice ?? hydratedPremium ?? '') : ''}
                  onChange={(e) => {
                    const raw = e.target.value
                    setLimitPrice(raw ? Number(raw) : null)
                    setPreview(null)
                  }}
                  placeholder={orderType === 'LIMIT' ? 'Premium/Price' : '—'}
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground"> </div>
                <div className="text-[11px] text-muted-foreground">
                  Preview shows derived quantity from lots × lot_size.
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Preview</div>
                {preview ? (
                  <>
                    <div className="text-xs text-muted-foreground">
                      Routing: {preview.routing.broker} • {preview.routing.exchange} • {preview.routing.trading_symbol}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Lots: {preview.lots} • Quantity: {preview.quantity} • lot_size {preview.instrument.lot_size ?? '—'}
                    </div>
                    {preview.instrument.instrument_type === 'OPTION' ? (
                      <div className="text-xs text-muted-foreground">
                        Premium:{' '}
                        <span className="font-medium tabular-nums">
                          {preview.limit_price ?? hydratedPremium ?? '—'}
                        </span>
                        {' • '}
                        Spot: <span className="font-medium tabular-nums">{spot ?? '—'}</span>
                        {selectedMoneyness ? (
                          <>
                            {' • '}
                            <span className="font-medium">{selectedMoneyness}</span>
                          </>
                        ) : null}
                        {typeof (preview.limit_price ?? hydratedPremium) === 'number' ? (
                          <>
                            {' • '}
                            Outlay:{' '}
                            <span className="font-medium tabular-nums">
                              ₹{(((preview.limit_price ?? hydratedPremium) as number) * preview.quantity).toFixed(2)}
                            </span>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div className="text-xs text-muted-foreground">
                    {launch.mode === 'contract' && contractMatchesSelection ? (
                        <>
                          Prefilled from selected contract. Click Preview to validate broker routing.
                        </>
                      ) : (
                        <>Select underlying/expiry/strike and click Preview to validate routing.</>
                      )}
                    </div>
                    {derivedQuantity !== null ? (
                      <div className="text-xs text-muted-foreground">
                        Lots: {lots} • Quantity: {derivedQuantity} • lot_size {instrument?.lot_size ?? '—'}
                      </div>
                    ) : null}
                    {instrumentType === 'OPTION' && hydratedPremium != null && derivedQuantity !== null ? (
                      <div className="text-xs text-muted-foreground">
                        Premium: <span className="font-medium tabular-nums">{hydratedPremium}</span>
                        {' • '}
                        Spot: <span className="font-medium tabular-nums">{spot ?? '—'}</span>
                        {selectedMoneyness ? (
                          <>
                            {' • '}
                            <span className="font-medium">{selectedMoneyness}</span>
                          </>
                        ) : null}
                        {' • '}
                        Outlay:{' '}
                        <span className="font-medium tabular-nums">
                          ₹{(hydratedPremium * derivedQuantity).toFixed(2)}
                        </span>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
              <Badge variant="outline">
                {preview ? 'Ready' : launch.mode === 'contract' && contractMatchesSelection ? 'Prefilled' : 'Draft'}
              </Badge>
            </div>
            {preview?.warnings.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {!schemaOk ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
              Backend schema not ready: {schemaError ?? 'run migrations'}. Run{' '}
              <span className="font-mono">make backend-migrate</span> and reload.
            </div>
          ) : null}

          {message ? (
            <div
              className={cn(
                'rounded-md border p-2 text-sm',
                message.toLowerCase().includes('fail') || message.toLowerCase().includes('error')
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : 'border-border bg-card text-foreground',
              )}
            >
              {message}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void previewMutation.mutateAsync()}
            disabled={!canPreview || previewMutation.isPending || createMutation.isPending}
          >
            {previewMutation.isPending ? 'Previewing…' : 'Preview'}
          </Button>
          <Button
            type="button"
            onClick={() => void createMutation.mutateAsync()}
            disabled={
              !accessToken ||
              !schemaOk ||
              zerodhaMarketBlocked ||
              !preview ||
              createMutation.isPending
            }
          >
            {createMutation.isPending ? 'Placing…' : side === 'BUY' ? 'Place buy' : 'Place sell'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
