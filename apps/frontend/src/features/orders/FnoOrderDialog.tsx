import { useEffect, useMemo, useState } from 'react'
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
import { formatStrikeHuman } from '@/lib/format'
import {
  deriveReferencePrice,
  parseNumber,
  priceFromSignedPct,
  productForFnoMode,
  productModeForProduct,
  roundTo,
  signedPctFromPrice,
} from '@/lib/executionIntent'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  launch:
    | {
        mode: 'manual'
        broker?: ordersApi.BrokerKey | null
        prefill?: {
          underlying?: string
          side?: ordersApi.OrderSide
        }
      }
    | {
        mode: 'contract'
        instrument: instrumentsApi.InstrumentOut
        broker?: ordersApi.BrokerKey | null
        referencePrice?: number | null
        prefill?: {
          side?: ordersApi.OrderSide
          lots?: number
          product?: 'MIS' | 'NRML'
          order_type?: ordersApi.OrderType
          limit_price?: number | null
          execution_intent?: ordersApi.ExecutionIntent | null
          intent?: ordersApi.OrderIntentMetadata
        }
      }
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
  const contractPrefill = launch.mode === 'contract' ? (launch.prefill ?? null) : null
  const manualPrefill = launch.mode === 'manual' ? (launch.prefill ?? null) : null
  const prefillIntent = contractPrefill?.execution_intent ?? null
  const prefillEntry = prefillIntent?.entry ?? null
  const prefillPlan = prefillIntent?.plan ?? null

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
      : launch.mode === 'manual'
        ? (manualPrefill?.underlying ?? '').trim().toUpperCase()
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

  const initialSide: ordersApi.OrderSide = prefillEntry?.side ?? contractPrefill?.side ?? manualPrefill?.side ?? 'BUY'
  const initialLots = prefillEntry?.lots ?? contractPrefill?.lots ?? 1
  const initialProduct: 'MIS' | 'NRML' =
    (prefillEntry?.product as 'MIS' | 'NRML' | undefined) ??
    contractPrefill?.product ??
    fnoProductPref
  const initialOrderType: ordersApi.OrderType =
    prefillEntry?.order_type ?? contractPrefill?.order_type ?? fnoOrderTypePref
  const initialProductMode: ordersApi.ProductMode =
    prefillEntry?.product_mode ?? productModeForProduct(initialProduct)

  const [side, setSide] = useState<ordersApi.OrderSide>(initialSide)
  const [lots, setLots] = useState(initialLots)
  const [productMode, setProductMode] = useState<ordersApi.ProductMode>(initialProductMode)
  const [orderType, setOrderType] = useState<ordersApi.OrderType>(initialOrderType)
  const [limitPrice, setLimitPrice] = useState<number | null>(
    initialOrderType === 'LIMIT'
      ? (prefillEntry?.limit_price ?? contractPrefill?.limit_price ?? initialPremium)
      : null,
  )

  const product = useMemo<'MIS' | 'NRML'>(() => productForFnoMode(productMode), [productMode])

  const [managedExits, setManagedExits] = useState<boolean>(Boolean(prefillPlan?.managed_exits ?? false))
  const [slPrice, setSlPrice] = useState<number | null>(prefillPlan?.stop_loss?.price ?? null)
  const [slPct, setSlPct] = useState<number | null>(prefillPlan?.stop_loss?.pct ?? null)
  const [slBasis, setSlBasis] = useState<'price' | 'pct' | null>(prefillPlan?.stop_loss?.price != null ? 'price' : prefillPlan?.stop_loss?.pct != null ? 'pct' : null)
  const [tpPrice, setTpPrice] = useState<number | null>(prefillPlan?.target?.price ?? null)
  const [tpPct, setTpPct] = useState<number | null>(prefillPlan?.target?.pct ?? null)
  const [tpBasis, setTpBasis] = useState<'price' | 'pct' | null>(prefillPlan?.target?.price != null ? 'price' : prefillPlan?.target?.pct != null ? 'pct' : null)
  const [trailEnabled, setTrailEnabled] = useState<boolean>(Boolean(prefillPlan?.trailing_sl?.enabled ?? false))
  const [trailPrice, setTrailPrice] = useState<number | null>(prefillPlan?.trailing_sl?.distance?.price ?? null)
  const [trailPct, setTrailPct] = useState<number | null>(prefillPlan?.trailing_sl?.distance?.pct ?? null)
  const [trailBasis, setTrailBasis] = useState<'price' | 'pct' | null>(prefillPlan?.trailing_sl?.distance?.price != null ? 'price' : prefillPlan?.trailing_sl?.distance?.pct != null ? 'pct' : null)

  const [message, setMessage] = useState<
    | {
        tone: 'ok' | 'blocked' | 'error'
        text: string
        correlationId?: string | null
      }
    | null
  >(null)
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
      execution_intent: (() => {
        const canonicalId =
          preview?.instrument?.canonical_id ??
          (launch.mode === 'contract' && instrument && contractMatchesSelection ? instrument.canonical_id : null) ??
          selectionCanonicalId ??
          null
        const lotSize =
          preview?.instrument?.lot_size ??
          (launch.mode === 'contract' && instrument && contractMatchesSelection ? instrument.lot_size ?? null : null)
        const qty = derivedQuantity ?? (lotSize && lots ? lotSize * lots : null)
        if (!canonicalId || qty == null) return null
        const ref = deriveReferencePrice(
          orderType,
          orderType === 'LIMIT' ? (limitPrice ?? hydratedPremium) : null,
          hydratedPremium,
        )
        return {
          version: '1',
          entry: {
            broker,
            canonical_id: canonicalId,
            side,
            product_mode: productMode,
            product,
            order_type: orderType,
            limit_price: orderType === 'LIMIT' ? (limitPrice ?? hydratedPremium) : null,
            quantity: qty,
            lots,
            lot_size: lotSize ?? null,
          },
          plan: {
            managed_exits: managedExits,
            reference_price: ref.price,
            reference_source: ref.source,
            stop_loss: { price: managedExits ? slPrice : null, pct: managedExits ? slPct : null },
            target: { price: managedExits ? tpPrice : null, pct: managedExits ? tpPct : null },
            trailing_sl: {
              enabled: managedExits ? trailEnabled : false,
              distance: {
                price: managedExits && trailEnabled ? trailPrice : null,
                pct: managedExits && trailEnabled ? trailPct : null,
              },
            },
          },
          source_context: launch.mode === 'contract' ? 'contract' : 'manual',
        } satisfies ordersApi.ExecutionIntent
      })(),
      source: contractPrefill?.intent?.source ?? 'manual_ui',
      intent_type: contractPrefill?.intent?.intent_type ?? 'ENTRY',
      trigger_mode: contractPrefill?.intent?.trigger_mode ?? null,
      risk_mode: contractPrefill?.intent?.risk_mode ?? null,
      sl_value: contractPrefill?.intent?.sl_value ?? null,
      tp_value: contractPrefill?.intent?.tp_value ?? null,
      trailing_value: contractPrefill?.intent?.trailing_value ?? null,
      parent_order_id: contractPrefill?.intent?.parent_order_id ?? null,
      linked_position_id: contractPrefill?.intent?.linked_position_id ?? null,
      broker_context: contractPrefill?.intent?.broker_context ?? null,
    }),
    [
      broker,
      instrumentType,
      underlying,
      expiry,
      strike,
      optionType,
      side,
      lots,
      product,
      productMode,
      orderType,
      limitPrice,
      hydratedPremium,
      preview?.instrument?.canonical_id,
      preview?.instrument?.lot_size,
      derivedQuantity,
      contractMatchesSelection,
      instrument,
      selectionCanonicalId,
      managedExits,
      slPrice,
      slPct,
      tpPrice,
      tpPct,
      trailEnabled,
      trailPrice,
      trailPct,
      contractPrefill?.intent,
      launch.mode,
    ],
  )

  const reference = useMemo(
    () =>
      deriveReferencePrice(
        orderType,
        orderType === 'LIMIT' ? (limitPrice ?? hydratedPremium) : null,
        hydratedPremium,
      ),
    [hydratedPremium, limitPrice, orderType],
  )

  useEffect(() => {
    if (!managedExits) return
    if (reference.price == null) return
    if (slBasis === 'price' && slPrice != null) setSlPct(roundTo(signedPctFromPrice(side, reference.price, slPrice), 2))
    if (slBasis === 'pct' && slPct != null) setSlPrice(roundTo(priceFromSignedPct(side, reference.price, slPct), 2))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managedExits, reference.price, side])

  useEffect(() => {
    if (!managedExits) return
    if (reference.price == null) return
    if (tpBasis === 'price' && tpPrice != null) setTpPct(roundTo(signedPctFromPrice(side, reference.price, tpPrice), 2))
    if (tpBasis === 'pct' && tpPct != null) setTpPrice(roundTo(priceFromSignedPct(side, reference.price, tpPct), 2))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managedExits, reference.price, side])

  useEffect(() => {
    if (!managedExits || !trailEnabled) return
    if (reference.price == null) return
    const ref = reference.price
    if (trailBasis === 'price' && trailPrice != null) {
      const pct = -Math.abs(trailPrice / ref) * 100
      setTrailPct(roundTo(pct, 2))
    }
    if (trailBasis === 'pct' && trailPct != null) {
      const dist = (Math.abs(trailPct) / 100) * ref
      setTrailPrice(roundTo(dist, 2))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managedExits, trailEnabled, reference.price, side])

  const planErrors = useMemo(() => {
    if (!managedExits) return []
    const errs: string[] = []
    const ref = reference.price
    if (ref == null) errs.push('Managed exits need a reference price. Use LIMIT or open from a premium-enabled context.')
    if (ref != null && slPrice != null) {
      if (side === 'BUY' && slPrice >= ref) errs.push('Stop loss should be below reference for BUY.')
      if (side === 'SELL' && slPrice <= ref) errs.push('Stop loss should be above reference for SELL.')
    }
    if (ref != null && tpPrice != null) {
      if (side === 'BUY' && tpPrice <= ref) errs.push('Target should be above reference for BUY.')
      if (side === 'SELL' && tpPrice >= ref) errs.push('Target should be below reference for SELL.')
    }
    if (trailEnabled) {
      if (trailPrice != null && trailPrice <= 0) errs.push('Trailing SL distance must be > 0.')
      if (trailPct != null && trailPct >= 0) errs.push('Trailing SL percent should be negative (protective).')
    }
    return errs
  }, [managedExits, reference.price, side, slPrice, tpPrice, trailEnabled, trailPct, trailPrice])

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
      setMessage({ tone: 'error', text: msg })
      setPreview(null)
    },
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Not authenticated')
      return ordersApi.createFnoOrder(accessToken, payload)
    },
    onSuccess: async (data) => {
      const status = (data.status ?? '').toUpperCase()
      if (status === 'BLOCKED') {
        setMessage({
          tone: 'blocked',
          text: data.blocked_reason_message || 'Order blocked: dispatch not allowed in current system state.',
          correlationId: data.correlation_id,
        })
      } else if (['DISPATCH_FAILED', 'FAILED', 'REJECTED'].includes(status)) {
        setMessage({
          tone: 'error',
          text:
            data.failure_reason_message ||
            (status === 'REJECTED'
              ? 'Order dispatch failed: broker rejected the request.'
              : 'Order dispatch failed.'),
          correlationId: data.correlation_id,
        })
      } else {
        setMessage({
          tone: 'ok',
          text: `Order acknowledged by broker. Broker order id: ${data.broker_order_id ?? '—'}`,
          correlationId: data.correlation_id,
        })
      }
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
      setMessage({ tone: 'error', text: msg })
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
                      Strike:{' '}
                      <span className="font-medium tabular-nums">
                        {formatStrikeHuman(strike, underlying)}
                      </span>
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
                          {formatStrikeHuman(s, underlying)} • {m}
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
                <div className="text-[11px] text-muted-foreground">
                  Lot size: {preview?.instrument?.lot_size ?? instrument?.lot_size ?? '—'} • Qty:{' '}
                  {derivedQuantity ?? '—'}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Mode</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={productMode === 'intraday' ? 'default' : 'outline'}
                    onClick={() => {
                      setProductMode('intraday')
                      setFnoProductPref('MIS')
                      setPreview(null)
                    }}
                  >
                    Intraday
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={productMode === 'carry_forward' ? 'default' : 'outline'}
                    onClick={() => {
                      setProductMode('carry_forward')
                      setFnoProductPref('NRML')
                      setPreview(null)
                    }}
                  >
                    Carry forward
                  </Button>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Product: <span className="font-mono">{product}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Mode</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={productMode === 'intraday' ? 'default' : 'outline'}
                    onClick={() => {
                      setProductMode('intraday')
                      setFnoProductPref('MIS')
                      setPreview(null)
                    }}
                  >
                    Intraday
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={productMode === 'carry_forward' ? 'default' : 'outline'}
                    onClick={() => {
                      setProductMode('carry_forward')
                      setFnoProductPref('NRML')
                      setPreview(null)
                    }}
                  >
                    Carry forward
                  </Button>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Product: <span className="font-mono">{product}</span>
                </div>
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-sm font-medium">Execution plan</div>
                <div className="text-xs text-muted-foreground">
                  Managed exits are app-managed; broker receives only the entry order.
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  Ref: {reference.price != null ? reference.price : '—'}{' '}
                  {reference.source ? `(${reference.source})` : ''}
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant={managedExits ? 'default' : 'outline'}
                  onClick={() => {
                    setManagedExits((v) => !v)
                    setPreview(null)
                  }}
                >
                  {managedExits ? 'Managed trade' : 'Simple order'}
                </Button>
              </div>
            </div>

            {managedExits ? (
              <div className="mt-3 grid gap-3">
                {planErrors.length ? (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
                    <ul className="list-disc space-y-1 pl-4">
                      {planErrors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="space-y-1 lg:col-span-1">
                    <div className="text-xs font-medium text-muted-foreground">Stop loss</div>
                    <div className="text-[11px] text-muted-foreground">Protective level</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">Price</div>
                    <Input
                      aria-label="Stop loss price"
                      type="number"
                      inputMode="decimal"
                      step="0.05"
                      value={slPrice ?? ''}
                      onChange={(e) => {
                        const v = parseNumber(e.target.value)
                        setSlPrice(v)
                        setSlBasis('price')
                        if (reference.price != null && v != null) {
                          setSlPct(roundTo(signedPctFromPrice(side, reference.price, v), 2))
                        } else {
                          setSlPct(null)
                        }
                        setPreview(null)
                      }}
                      placeholder="—"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">%</div>
                    <Input
                      aria-label="Stop loss percent"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={slPct ?? ''}
                      onChange={(e) => {
                        const v = parseNumber(e.target.value)
                        setSlPct(v)
                        setSlBasis('pct')
                        if (reference.price != null && v != null) {
                          setSlPrice(roundTo(priceFromSignedPct(side, reference.price, v), 2))
                        } else {
                          setSlPrice(null)
                        }
                        setPreview(null)
                      }}
                      placeholder="—"
                    />
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="space-y-1 lg:col-span-1">
                    <div className="text-xs font-medium text-muted-foreground">Target</div>
                    <div className="text-[11px] text-muted-foreground">Profit-taking level</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">Price</div>
                    <Input
                      aria-label="Target price"
                      type="number"
                      inputMode="decimal"
                      step="0.05"
                      value={tpPrice ?? ''}
                      onChange={(e) => {
                        const v = parseNumber(e.target.value)
                        setTpPrice(v)
                        setTpBasis('price')
                        if (reference.price != null && v != null) {
                          setTpPct(roundTo(signedPctFromPrice(side, reference.price, v), 2))
                        } else {
                          setTpPct(null)
                        }
                        setPreview(null)
                      }}
                      placeholder="—"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">%</div>
                    <Input
                      aria-label="Target percent"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={tpPct ?? ''}
                      onChange={(e) => {
                        const v = parseNumber(e.target.value)
                        setTpPct(v)
                        setTpBasis('pct')
                        if (reference.price != null && v != null) {
                          setTpPrice(roundTo(priceFromSignedPct(side, reference.price, v), 2))
                        } else {
                          setTpPrice(null)
                        }
                        setPreview(null)
                      }}
                      placeholder="—"
                    />
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="space-y-1 lg:col-span-1">
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-medium text-muted-foreground">Trailing SL</div>
                      <Button
                        type="button"
                        size="sm"
                        variant={trailEnabled ? 'default' : 'outline'}
                        onClick={() => {
                          setTrailEnabled((v) => !v)
                          setPreview(null)
                        }}
                      >
                        {trailEnabled ? 'On' : 'Off'}
                      </Button>
                    </div>
                    <div className="text-[11px] text-muted-foreground">Protective distance (loss-side)</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">Price</div>
                    <Input
                      aria-label="Trailing SL price"
                      type="number"
                      inputMode="decimal"
                      step="0.05"
                      disabled={!trailEnabled}
                      value={trailPrice ?? ''}
                      onChange={(e) => {
                        const v = parseNumber(e.target.value)
                        setTrailPrice(v)
                        setTrailBasis('price')
                        if (reference.price != null && v != null) {
                          const pct = -Math.abs(v / reference.price) * 100
                          setTrailPct(roundTo(pct, 2))
                        } else {
                          setTrailPct(null)
                        }
                        setPreview(null)
                      }}
                      placeholder="—"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground">%</div>
                    <Input
                      aria-label="Trailing SL percent"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      disabled={!trailEnabled}
                      value={trailPct ?? ''}
                      onChange={(e) => {
                        const v = parseNumber(e.target.value)
                        setTrailPct(v)
                        setTrailBasis('pct')
                        if (reference.price != null && v != null) {
                          const dist = (Math.abs(v) / 100) * reference.price
                          setTrailPrice(roundTo(dist, 2))
                        } else {
                          setTrailPrice(null)
                        }
                        setPreview(null)
                      }}
                      placeholder="—"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-xs text-muted-foreground">
                Simple order submits only the entry order (no app-managed exits).
              </div>
            )}
          </div>

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
                message.tone === 'error'
                  ? 'border-destructive/30 bg-destructive/10 text-destructive'
                  : message.tone === 'blocked'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
                    : 'border-border bg-card text-foreground',
              )}
            >
              <div>{message.text}</div>
              {message.correlationId ? (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Correlation ID: <span className="font-mono">{message.correlationId}</span>
                </div>
              ) : null}
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
              planErrors.length > 0 ||
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
