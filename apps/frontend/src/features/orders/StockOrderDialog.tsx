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
import * as ordersApi from '@/lib/api/orders'
import type * as instrumentsApi from '@/lib/api/instruments'
import {
  deriveReferencePrice,
  parseNumber,
  priceFromSignedPct,
  productForCashMode,
  productModeForProduct,
  roundTo,
  signedPctFromPrice,
} from '@/lib/executionIntent'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { useOrderPrefsStore } from '@/store/orderPrefsStore'

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
        prefill?: {
          side?: ordersApi.OrderSide
          quantity?: number
          product?: ordersApi.OrderProduct
          order_type?: ordersApi.OrderType
          limit_price?: number | null
          execution_intent?: ordersApi.ExecutionIntent | null
          intent?: ordersApi.OrderIntentMetadata
        }
      }
}

function isCashInstrument(i: instrumentsApi.InstrumentOut) {
  return i.segment === 'EQUITY' && (i.instrument_type === 'EQUITY' || i.instrument_type === 'ETF')
}

export function StockOrderDialog({ open, onOpenChange, launch }: Props) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const updateLastUsedBroker = useAuthStore((s) => s.updateLastUsedBroker)

  const stockProduct = useOrderPrefsStore((s) => s.stockProduct)
  const stockOrderType = useOrderPrefsStore((s) => s.stockOrderType)
  const setStockProduct = useOrderPrefsStore((s) => s.setStockProduct)
  const setStockOrderType = useOrderPrefsStore((s) => s.setStockOrderType)

  const instrument = launch.mode === 'contract' ? launch.instrument : null
  const prefill = launch.mode === 'contract' ? (launch.prefill ?? null) : null
  const prefillIntent = prefill?.execution_intent ?? null
  const prefillEntry = prefillIntent?.entry ?? null
  const prefillPlan = prefillIntent?.plan ?? null
  const initialBroker =
    (launch.broker as ordersApi.BrokerKey | null | undefined) ??
    (user?.last_used_broker === 'angel' || user?.last_used_broker === 'zerodha'
      ? (user.last_used_broker as ordersApi.BrokerKey)
      : null) ??
    'angel'
  const initialSide: ordersApi.OrderSide = prefillEntry?.side ?? prefill?.side ?? 'BUY'
  const initialQuantity = prefillEntry?.quantity ?? prefill?.quantity ?? 1
  const initialProduct: ordersApi.OrderProduct = prefillEntry?.product ?? prefill?.product ?? stockProduct
  const initialOrderType: ordersApi.OrderType = prefillEntry?.order_type ?? prefill?.order_type ?? stockOrderType
  const initialProductMode: ordersApi.ProductMode =
    prefillEntry?.product_mode ?? productModeForProduct(initialProduct)

  const [broker, setBroker] = useState<ordersApi.BrokerKey>(initialBroker)
  const [side, setSide] = useState<ordersApi.OrderSide>(initialSide)
  const [quantity, setQuantity] = useState(initialQuantity)
  const [productMode, setProductMode] = useState<ordersApi.ProductMode>(initialProductMode)
  const [orderType, setOrderType] = useState<ordersApi.OrderType>(initialOrderType)
  const [limitPrice, setLimitPrice] = useState<number | null>(
    initialOrderType === 'LIMIT' && launch.mode === 'contract'
      ? (prefillEntry?.limit_price ?? prefill?.limit_price ?? launch.referencePrice ?? null)
      : null,
  )

  const product = useMemo<ordersApi.OrderProduct>(() => productForCashMode(productMode), [productMode])

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
  const [preview, setPreview] = useState<ordersApi.StockOrderPreviewResponse | null>(null)

  const canTrade = instrument ? isCashInstrument(instrument) : false

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

  const payload = useMemo<ordersApi.StockOrderBase>(
    () => ({
      broker,
      canonical_id: instrument?.canonical_id ?? '',
      side,
      quantity,
      product,
      order_type: orderType,
      limit_price: orderType === 'LIMIT' ? limitPrice : null,
      execution_intent: instrument
        ? ({
            version: '1',
            entry: {
              broker,
              canonical_id: instrument.canonical_id,
              side,
              product_mode: productMode,
              product,
              order_type: orderType,
              limit_price: orderType === 'LIMIT' ? limitPrice : null,
              quantity,
              lots: null,
              lot_size: instrument.lot_size ?? null,
            },
            plan: (() => {
              const ref = deriveReferencePrice(orderType, orderType === 'LIMIT' ? limitPrice : null, launch.mode === 'contract' ? (launch.referencePrice ?? null) : null)
              return {
                managed_exits: managedExits,
                reference_price: ref.price,
                reference_source: ref.source,
                stop_loss: { price: managedExits ? slPrice : null, pct: managedExits ? slPct : null },
                target: { price: managedExits ? tpPrice : null, pct: managedExits ? tpPct : null },
                trailing_sl: {
                  enabled: managedExits ? trailEnabled : false,
                  distance: { price: managedExits && trailEnabled ? trailPrice : null, pct: managedExits && trailEnabled ? trailPct : null },
                },
              }
            })(),
            source_context: launch.mode === 'contract' ? 'contract' : 'manual',
          } satisfies ordersApi.ExecutionIntent)
        : null,
      source: prefill?.intent?.source ?? 'manual_ui',
      intent_type: prefill?.intent?.intent_type ?? 'ENTRY',
      trigger_mode: prefill?.intent?.trigger_mode ?? null,
      risk_mode: prefill?.intent?.risk_mode ?? null,
      sl_value: prefill?.intent?.sl_value ?? null,
      tp_value: prefill?.intent?.tp_value ?? null,
      trailing_value: prefill?.intent?.trailing_value ?? null,
      parent_order_id: prefill?.intent?.parent_order_id ?? null,
      linked_position_id: prefill?.intent?.linked_position_id ?? null,
      broker_context: prefill?.intent?.broker_context ?? null,
    }),
    [
      broker,
      instrument,
      side,
      quantity,
      product,
      productMode,
      orderType,
      limitPrice,
      launch,
      managedExits,
      slPrice,
      slPct,
      tpPrice,
      tpPct,
      trailEnabled,
      trailPrice,
      trailPct,
      prefill?.intent,
    ],
  )

  const reference = useMemo(
    () =>
      deriveReferencePrice(
        orderType,
        orderType === 'LIMIT' ? limitPrice : null,
        launch.mode === 'contract' ? (launch.referencePrice ?? null) : null,
      ),
    [launch, limitPrice, orderType],
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
    if (ref == null) errs.push('Managed exits need a reference price. Use LIMIT or open from a quote-enabled context.')
    const sl = slPrice
    const tp = tpPrice
    if (ref != null && sl != null) {
      if (side === 'BUY' && sl >= ref) errs.push('Stop loss should be below reference for BUY.')
      if (side === 'SELL' && sl <= ref) errs.push('Stop loss should be above reference for SELL.')
    }
    if (ref != null && tp != null) {
      if (side === 'BUY' && tp <= ref) errs.push('Target should be above reference for BUY.')
      if (side === 'SELL' && tp >= ref) errs.push('Target should be below reference for SELL.')
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
      return ordersApi.previewStockOrder(accessToken, payload)
    },
    onSuccess: (data) => {
      setPreview(data)
      setMessage(null)
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
      return ordersApi.createStockOrder(accessToken, payload)
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

  const brokerStatus = brokerByKey[broker]
  const brokerHint = brokerStatus?.state ? `${brokerStatus.state}` : '—'
  const zerodhaMarketBlocked = broker === 'zerodha' && orderType === 'MARKET'
  const schemaOk = backendReady.data?.schema?.ok ?? true
  const schemaError = backendReady.data?.schema?.error ?? null

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Stock order</DialogTitle>
          <DialogDescription>
            {launch.mode === 'contract'
              ? 'Contract-driven cash order (S4.1). Uses selected canonical instrument and resolves broker routing internally.'
              : 'Manual cash order (S4.1). Uses canonical instrument ID and resolves broker routing internally.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {instrument ? (
            <div className="rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium">{instrument.display_symbol}</div>
                    <Badge variant="outline">{instrument.exchange}</Badge>
                    <Badge variant="outline">{instrument.segment}</Badge>
                  </div>
                  <div className="mt-1 break-all text-xs text-muted-foreground">
                    {instrument.canonical_id}
                  </div>
                </div>
                {!canTrade ? <Badge variant="outline">Not cash-compatible</Badge> : null}
              </div>
            </div>
          ) : (
            <div className="rounded-md border bg-card p-3 text-sm text-muted-foreground">
              No instrument selected. Use <span className="font-medium">Trade</span> from Search results to open a contract-driven ticket.
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Broker</div>
              <select
                aria-label="Order broker"
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
              <div className="text-[11px] text-muted-foreground">
                Status: {brokerHint}
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

            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Quantity</div>
              <Input
                aria-label="Order quantity"
                type="number"
                inputMode="numeric"
                min={1}
                value={quantity}
                onChange={(e) => {
                  setQuantity(Number(e.target.value || 0))
                  setPreview(null)
                }}
              />
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Mode</div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={productMode === 'delivery' ? 'default' : 'outline'}
                  onClick={() => {
                    setProductMode('delivery')
                    setStockProduct('CNC')
                    setPreview(null)
                  }}
                >
                  Delivery
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={productMode === 'intraday' ? 'default' : 'outline'}
                  onClick={() => {
                    setProductMode('intraday')
                    setStockProduct('MIS')
                    setPreview(null)
                  }}
                >
                  Intraday
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Product: <span className="font-mono">{product}</span>
              </div>
              <Input aria-label="Order product" value={product} readOnly className="sr-only" />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Order type</div>
              <select
                aria-label="Order type"
                value={orderType}
                onChange={(e) => {
                  const next = e.target.value as ordersApi.OrderType
                  setOrderType(next)
                  setStockOrderType(next)
                  setPreview(null)
                }}
                className={cn(
                  'h-10 w-full rounded-md border bg-background px-2 text-sm outline-none',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <option value="MARKET">Market</option>
                <option value="LIMIT">Limit</option>
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
                aria-label="Limit price"
                type="number"
                inputMode="decimal"
                step="0.05"
                disabled={orderType !== 'LIMIT'}
                value={limitPrice ?? ''}
                onChange={(e) => {
                  const raw = e.target.value
                  setLimitPrice(raw ? Number(raw) : null)
                  setPreview(null)
                }}
                placeholder={orderType === 'LIMIT' ? 'Price' : '—'}
              />
            </div>
          </div>

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
                      placeholder={trailEnabled ? '—' : '—'}
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
                      placeholder={trailEnabled ? '—' : '—'}
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
                  <div className="text-xs text-muted-foreground">
                    Routing: {preview.routing.broker} • {preview.routing.exchange} • {preview.routing.trading_symbol}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    {instrument ? (
                      <>
                        Prefilled for <span className="font-medium">{instrument.display_symbol}</span>. Click Preview to validate routing.
                      </>
                    ) : (
                      <>Select a cash instrument to preview routing.</>
                    )}
                  </div>
                )}
              </div>
              <Badge variant="outline">
                {preview ? 'Ready' : launch.mode === 'contract' && canTrade ? 'Prefilled' : 'Draft'}
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
              Backend schema not ready: {schemaError ?? 'run migrations'}.
              {' '}Run <span className="font-mono">make backend-migrate</span> and reload.
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
            disabled={
              !accessToken ||
              !canTrade ||
              zerodhaMarketBlocked ||
              previewMutation.isPending ||
              createMutation.isPending
            }
          >
            {previewMutation.isPending ? 'Previewing…' : 'Preview'}
          </Button>
          <Button
            type="button"
            onClick={() => void createMutation.mutateAsync()}
            disabled={
              !accessToken ||
              !canTrade ||
              zerodhaMarketBlocked ||
              !schemaOk ||
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
