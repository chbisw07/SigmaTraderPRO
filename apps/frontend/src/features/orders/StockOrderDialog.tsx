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
import * as ordersApi from '@/lib/api/orders'
import type * as instrumentsApi from '@/lib/api/instruments'
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
  const initialBroker =
    (launch.broker as ordersApi.BrokerKey | null | undefined) ??
    (user?.last_used_broker === 'angel' || user?.last_used_broker === 'zerodha'
      ? (user.last_used_broker as ordersApi.BrokerKey)
      : null) ??
    'angel'
  const initialSide: ordersApi.OrderSide = prefill?.side ?? 'BUY'
  const initialQuantity = prefill?.quantity ?? 1
  const initialProduct: ordersApi.OrderProduct = prefill?.product ?? stockProduct
  const initialOrderType: ordersApi.OrderType = prefill?.order_type ?? stockOrderType

  const [broker, setBroker] = useState<ordersApi.BrokerKey>(initialBroker)
  const [side, setSide] = useState<ordersApi.OrderSide>(initialSide)
  const [quantity, setQuantity] = useState(initialQuantity)
  const [product, setProduct] = useState<ordersApi.OrderProduct>(initialProduct)
  const [orderType, setOrderType] = useState<ordersApi.OrderType>(initialOrderType)
  const [limitPrice, setLimitPrice] = useState<number | null>(
    initialOrderType === 'LIMIT' && launch.mode === 'contract'
      ? (prefill?.limit_price ?? launch.referencePrice ?? null)
      : null,
  )

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
      instrument?.canonical_id,
      side,
      quantity,
      product,
      orderType,
      limitPrice,
      prefill?.intent,
    ],
  )

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
              <div className="text-xs font-medium text-muted-foreground">Product</div>
              <select
                aria-label="Order product"
                value={product}
                onChange={(e) => {
                  const next = e.target.value as ordersApi.OrderProduct
                  setProduct(next)
                  setStockProduct(next)
                  setPreview(null)
                }}
                className={cn(
                  'h-10 w-full rounded-md border bg-background px-2 text-sm outline-none',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <option value="CNC">CNC (Delivery)</option>
                <option value="MIS">MIS (Intraday)</option>
              </select>
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
