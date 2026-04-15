import { type ComponentProps, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatNumber, formatQty, formatStrikeHuman } from '@/lib/format'
import { useAuthStore } from '@/store/authStore'
import * as ordersApi from '@/lib/api/orders'
import * as positionsApi from '@/lib/api/positions'
import { StockOrderDialog } from '@/features/orders/StockOrderDialog'
import { FnoOrderDialog } from '@/features/orders/FnoOrderDialog'

const EMPTY_ROWS: ordersApi.OrdersWorkspaceRow[] = []

function normalizeIsoForDateParse(value: string): string {
  // Some servers serialize microseconds (6 digits), which is not reliably parsed by `Date`.
  // Trim to milliseconds when present.
  return value.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:\d{2})$/, '$1$2')
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null
  const s = status.toUpperCase()
  const cls =
    s === 'EXECUTED'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : s === 'BLOCKED'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
        : s === 'REJECTED' || s === 'FAILED' || s === 'DISPATCH_FAILED'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : s === 'CANCELLED'
          ? 'border-muted-foreground/30 bg-muted/30 text-muted-foreground'
          : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'

  return (
    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium', cls)}>
      {s}
    </span>
  )
}

function instrumentTitle(i: ordersApi.InstrumentOut | null): string {
  if (!i) return '—'
  const root = (i.underlying ?? i.symbol_root).toUpperCase()
  if (i.instrument_type === 'OPTION') {
    return `${root} ${i.expiry ?? '—'} ${formatStrikeHuman(i.strike, root)} ${i.option_type ?? ''}`.trim()
  }
  if (i.instrument_type === 'FUTURE') {
    return `${root} ${i.expiry ?? '—'} FUT`.trim()
  }
  return i.display_symbol
}

function localYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseLocalYmd(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!y || !mo || !d) return null
  return new Date(y, mo - 1, d)
}

function addDaysLocal(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

function formatPlacedAt(value: string | null): string {
  if (!value) return '—'
  const d = new Date(normalizeIsoForDateParse(value))
  if (Number.isNaN(d.getTime())) return '—'
  // Compact, single-line, locale-aware timestamp (no seconds).
  return d
    .toLocaleString('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    .replace(',', '')
}

export function OrdersPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const user = useAuthStore((s) => s.user)
  const updateIncludeBrokerOrders = useAuthStore((s) => s.updateIncludeBrokerOrders)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const todayYmd = useMemo(() => localYmd(new Date()), [])
  const [q, setQ] = useState(() => searchParams.get('q') ?? '')
  const [broker, setBroker] = useState<ordersApi.BrokerKey | ''>('')
  const [status, setStatus] = useState<string>('')
  const [instrumentType, setInstrumentType] = useState<string>('')
  const [product, setProduct] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>(() => todayYmd)
  const [toDate, setToDate] = useState<string>(() => todayYmd)
  const includeBrokerOrders = user?.include_broker_orders ?? true
  const [mode, setMode] = useState<ordersApi.OrdersSourceMode>(() => (includeBrokerOrders ? 'merged' : 'internal_only'))

  useEffect(() => {
    if (!includeBrokerOrders && mode !== 'internal_only') setMode('internal_only')
  }, [includeBrokerOrders, mode])

  const orders = useQuery<ordersApi.OrdersWorkspaceResponse>({
    queryKey: ['orders', 'workspace', { q, broker, status, instrumentType, product, mode, includeBrokerOrders }],
    queryFn: async () => {
      if (!accessToken) {
        return { items: [], meta: { include_broker_orders: includeBrokerOrders, mode, broker_errors: {} } }
      }
      return ordersApi.listOrdersWorkspace(accessToken, {
        mode,
        q: q.trim() || undefined,
        broker: broker || undefined,
        status: status || undefined,
        product: product || undefined,
        instrument_type: instrumentType || undefined,
        limit: 200,
      })
    },
    enabled: Boolean(accessToken),
    refetchInterval: 30_000,
  })

  const rows = orders.data?.items ?? EMPTY_ROWS
  const brokerErrors = orders.data?.meta?.broker_errors ?? {}

  const dateBounds = useMemo(() => {
    let earliestMs: number | null = null
    let latestMs: number | null = null
    for (const r of rows) {
      if (!r.placed_at) continue
      const ms = new Date(normalizeIsoForDateParse(r.placed_at)).getTime()
      if (Number.isNaN(ms)) continue
      earliestMs = earliestMs == null ? ms : Math.min(earliestMs, ms)
      latestMs = latestMs == null ? ms : Math.max(latestMs, ms)
    }
    return {
      earliestYmd: earliestMs != null ? localYmd(new Date(earliestMs)) : null,
      latestYmd: latestMs != null ? localYmd(new Date(latestMs)) : null,
    }
  }, [rows])

  useEffect(() => {
    const min = dateBounds.earliestYmd
    if (!min) return
    if (fromDate < min) setFromDate(min)
    if (toDate < min) setToDate(min)
  }, [dateBounds.earliestYmd, fromDate, toDate])

  useEffect(() => {
    // Prevent selecting dates beyond today.
    if (fromDate > todayYmd) setFromDate(todayYmd)
    if (toDate > todayYmd) setToDate(todayYmd)
  }, [fromDate, toDate, todayYmd])

  useEffect(() => {
    // Keep a valid range.
    if (fromDate > toDate) setToDate(fromDate)
  }, [fromDate, toDate])

  const filteredRows = useMemo(() => {
    const start = parseLocalYmd(fromDate)
    const end = parseLocalYmd(toDate)
    if (!start || !end) return rows
    const startMs = Math.min(start.getTime(), end.getTime())
    const endMs = Math.max(start.getTime(), end.getTime())
    const endExclusiveMs = addDaysLocal(new Date(endMs), 1).getTime()

    return rows.filter((r) => {
      if (!r.placed_at) return false
      const ms = new Date(normalizeIsoForDateParse(r.placed_at)).getTime()
      if (Number.isNaN(ms)) return false
      return ms >= startMs && ms < endExclusiveMs
    })
  }, [rows, fromDate, toDate])

  const reconciliationNeeded = useMemo(() => {
    if (!includeBrokerOrders) return 0
    return filteredRows.filter((r) => r.reconciliation_state === 'unresolved').length
  }, [includeBrokerOrders, filteredRows])

  const [payloadOpen, setPayloadOpen] = useState(false)
  const [payloadOrderId, setPayloadOrderId] = useState<number | null>(null)

  const orderDetail = useQuery({
    queryKey: ['orders', 'detail', payloadOrderId],
    queryFn: async () => {
      if (!accessToken || payloadOrderId == null) return null
      return ordersApi.getOrder(accessToken, payloadOrderId)
    },
    enabled: Boolean(accessToken) && payloadOpen && payloadOrderId != null,
  })

  const [stockDialogOpen, setStockDialogOpen] = useState(false)
  const [stockLaunch, setStockLaunch] = useState<ComponentProps<typeof StockOrderDialog>['launch'] | null>(null)
  const [fnoDialogOpen, setFnoDialogOpen] = useState(false)
  const [fnoLaunch, setFnoLaunch] = useState<ComponentProps<typeof FnoOrderDialog>['launch'] | null>(null)
  const [dialogKey, setDialogKey] = useState<string>('manual')
  const [banner, setBanner] = useState<string | null>(null)

  const closeDialogs = () => {
    setStockDialogOpen(false)
    setFnoDialogOpen(false)
    setStockLaunch(null)
    setFnoLaunch(null)
  }

  const openDraft = (draft: ordersApi.OrderDraft) => {
    const inst = draft.instrument
    const keyBits = [
      inst.canonical_id,
      draft.broker,
      draft.side,
      draft.order_type,
      String(draft.quantity ?? draft.lots ?? ''),
    ]
    setDialogKey(keyBits.join(':'))
    if (inst.segment === 'EQUITY' && (inst.instrument_type === 'EQUITY' || inst.instrument_type === 'ETF')) {
      setStockLaunch({
        mode: 'contract',
        instrument: inst,
        broker: draft.broker,
        referencePrice: draft.reference_price,
        prefill: {
          side: draft.side,
          quantity: draft.quantity ?? 1,
          product: draft.product,
          order_type: draft.order_type,
          limit_price: draft.limit_price,
          execution_intent: draft.execution_intent ?? null,
          intent: draft.intent,
        },
      })
      setStockDialogOpen(true)
    } else {
      setFnoLaunch({
        mode: 'contract',
        instrument: inst,
        broker: draft.broker,
        referencePrice: draft.reference_price,
        prefill: {
          side: draft.side,
          lots: draft.lots ?? 1,
          product: draft.product === 'NRML' || draft.product === 'MIS' ? draft.product : 'NRML',
          order_type: draft.order_type,
          limit_price: draft.limit_price,
          execution_intent: draft.execution_intent ?? null,
          intent: draft.intent,
        },
      })
      setFnoDialogOpen(true)
    }
  }

  const actionBusy = useMemo(() => new Set<number>(), [])
  const [, bump] = useState(0)
  const setBusy = (id: number, v: boolean) => {
    if (v) actionBusy.add(id)
    else actionBusy.delete(id)
    bump((x) => x + 1)
  }

  const onRepeat = async (orderId: number) => {
    if (!accessToken) return
    setBusy(orderId, true)
    try {
      const res = await ordersApi.repeatOrder(accessToken, orderId)
      openDraft(res.draft)
    } finally {
      setBusy(orderId, false)
    }
  }

  const onReverse = async (orderId: number) => {
    if (!accessToken) return
    setBusy(orderId, true)
    try {
      const res = await ordersApi.reverseOrder(accessToken, orderId)
      openDraft(res.draft)
    } finally {
      setBusy(orderId, false)
    }
  }

  const onReconcile = async () => {
    if (!accessToken) return
    try {
      const res = await ordersApi.reconcileOrders(accessToken)
      setBanner(res.message)
      await orders.refetch()
    } catch {
      setBanner('Reconcile failed')
    }
  }

  const onExitLinkedPosition = async (positionId: number, orderId: number) => {
    if (!accessToken) return
    setBusy(orderId, true)
    try {
      const res = await positionsApi.squareoffDraft(accessToken, positionId)
      openDraft(res.draft)
    } finally {
      setBusy(orderId, false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="sr-only">Orders</h1>
      <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-2 rounded-md border bg-card px-2 py-1 text-sm shadow-sm">
            <input
              aria-label="Include broker orders"
              type="checkbox"
              checked={includeBrokerOrders}
              onChange={(e) => void updateIncludeBrokerOrders(e.target.checked)}
            />
            <span className="text-xs">Include broker orders</span>
          </label>
          <Button type="button" variant="outline" size="sm" onClick={() => void onReconcile()} disabled={!accessToken}>
            Reconcile
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void orders.refetch()} disabled={orders.isFetching}>
            {orders.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
      </div>
      {Object.keys(brokerErrors).length ? (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <div className="text-xs font-medium">Broker orderbook warnings</div>
          <div className="mt-1 space-y-1 text-xs text-muted-foreground">
            {Object.entries(brokerErrors).map(([b, msg]) => (
              <div key={b}>
                <span className="font-medium">{b}:</span> {msg}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {reconciliationNeeded ? (
        <div className="rounded-md border bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
          {reconciliationNeeded} row{reconciliationNeeded === 1 ? '' : 's'} require reconciliation. Click{' '}
          <span className="font-medium">Reconcile</span> to update internal order state from broker truth.
        </div>
      ) : null}
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
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border bg-muted/40 p-1 shadow-sm">
              {(['merged', 'internal_only', 'broker_only'] as const).map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant={mode === m ? 'default' : 'ghost'}
                  onClick={() => setMode(m)}
                  disabled={!includeBrokerOrders && m !== 'internal_only'}
                  className="h-7 px-2"
                >
                  {m === 'merged' ? 'Merged' : m === 'internal_only' ? 'Internal only' : 'Broker only'}
                </Button>
              ))}
            </div>

            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search symbol / canonical / broker id / correlation…"
              className="h-9 w-[360px] max-w-full"
            />

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground">From</div>
                <Input
                  type="date"
                  value={fromDate}
                  min={dateBounds.earliestYmd || undefined}
                  max={toDate || todayYmd}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-9 w-[150px]"
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-muted-foreground">To</div>
                <Input
                  type="date"
                  value={toDate}
                  min={fromDate || dateBounds.earliestYmd || undefined}
                  max={todayYmd}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-9 w-[150px]"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={broker}
              onChange={(e) => {
                const v = e.target.value
                if (v === '' || v === 'angel' || v === 'zerodha') setBroker(v)
                else setBroker('')
              }}
              className={cn(
                'h-9 w-[140px] rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <option value="">All brokers</option>
              <option value="angel">Angel One</option>
              <option value="zerodha">Zerodha</option>
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={cn(
                'h-9 w-[160px] rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <option value="">All statuses</option>
              {['ACKNOWLEDGED', 'PENDING', 'OPEN', 'EXECUTED', 'PARTIAL', 'CANCELLED', 'BLOCKED', 'DISPATCH_FAILED', 'REJECTED', 'FAILED', 'SL_EXECUTED', 'TARGET_EXECUTED'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className={cn(
                'h-9 w-[130px] rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <option value="">All products</option>
              {['CNC', 'MIS', 'NRML'].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={instrumentType}
              onChange={(e) => setInstrumentType(e.target.value)}
              className={cn(
                'h-9 w-[130px] rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              )}
            >
              <option value="">All types</option>
              <option value="EQUITY">Stock/ETF</option>
              <option value="OPTION">Option</option>
              <option value="FUTURE">Future</option>
            </select>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-muted-foreground"
              onClick={() => {
                setQ('')
                setBroker('')
                setStatus('')
                setProduct('')
                setInstrumentType('')
                setFromDate(todayYmd)
                setToDate(todayYmd)
              }}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <div className="text-sm font-medium">Latest first</div>
          <div className="text-xs text-muted-foreground">
            {filteredRows.length}
            {filteredRows.length !== rows.length ? ` / ${rows.length}` : ''} orders
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-[13px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/95 text-[11px] font-semibold text-muted-foreground backdrop-blur">
              <tr className="border-b">
                <th className="w-[150px] px-3 py-2.5 text-left">Time</th>
                <th className="w-[280px] px-3 py-2.5 text-left">Symbol</th>
                <th className="w-[72px] px-3 py-2.5 text-left">Side</th>
                <th className="w-[84px] px-3 py-2.5 text-left">Broker</th>
                <th className="w-[76px] px-3 py-2.5 text-left">Product</th>
                <th className="w-[96px] px-3 py-2.5 text-right">Qty/Lots</th>
                <th className="w-[84px] px-3 py-2.5 text-left">Type</th>
                <th className="w-[86px] px-3 py-2.5 text-right">Placed</th>
                <th className="w-[74px] px-3 py-2.5 text-right">Avg</th>
                <th className="w-[160px] px-3 py-2.5 text-left">Status</th>
                <th className="w-[92px] px-3 py-2.5 text-left">Origin</th>
                <th className="w-[92px] px-3 py-2.5 text-left">Recon</th>
                <th className="w-[130px] px-3 py-2.5 text-left">Source</th>
                <th className="w-[70px] px-3 py-2.5 text-right">PnL</th>
                <th className="w-[340px] px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredRows.map((o) => {
                const internalId = o.internal_order_id
                const busy = internalId != null ? actionBusy.has(internalId) : false
                const title = o.instrument ? instrumentTitle(o.instrument) : (o.symbol_display ?? '—')
                const kind = o.instrument?.instrument_type ?? (o.canonical_id ? '—' : '—')
                const sideCls = o.side === 'BUY' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
                const symbolTooltip = [
                  title !== '—' ? title : null,
                  o.canonical_id ? `Canonical: ${o.canonical_id}` : null,
                  o.broker_order_id ? `Broker ID: ${o.broker_order_id}` : null,
                  o.correlation_id ? `Correlation: ${o.correlation_id}` : null,
                ]
                  .filter(Boolean)
                  .join('\n')
                const sourceLabel = o.source ?? ''
                const sourceFull = o.intent_type ? `${sourceLabel} · ${o.intent_type}` : sourceLabel
                return (
                  <tr key={o.row_id} className="transition-colors hover:bg-accent/30">
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{formatPlacedAt(o.placed_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 truncate font-medium leading-tight" title={symbolTooltip || undefined}>
                          {title}
                        </div>
                        {kind !== '—' ? (
                          <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] text-muted-foreground">
                            {kind}
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className={cn('px-3 py-2 font-medium whitespace-nowrap', sideCls)}>{o.side ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{o.broker}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{o.product ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-right whitespace-nowrap">{o.lots != null ? `${formatQty(o.lots)} lots` : formatQty(o.quantity)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{o.order_type ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-right whitespace-nowrap">{formatNumber(o.placed_price)}</td>
                    <td className="px-3 py-2 tabular-nums text-right whitespace-nowrap">{formatNumber(o.avg_price)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={o.status} />
                      {o.blocked_reason_message ? (
                        <div className="mt-1 max-w-[260px] truncate text-[11px] text-amber-800 dark:text-amber-200">
                          {o.blocked_reason_message}
                        </div>
                      ) : o.failure_reason_message || o.rejection_reason ? (
                        <div className="mt-1 max-w-[260px] truncate text-[11px] text-destructive">
                          {o.failure_reason_message ?? o.rejection_reason}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
                        {o.source_origin}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground">
                        {o.reconciliation_state}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {sourceFull ? (
                        <div className="truncate" title={sourceFull}>
                          {sourceFull}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-muted-foreground" />
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        {internalId != null ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => void onRepeat(internalId)}
                              disabled={busy}
                            >
                              {busy ? '…' : 'Repeat'}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => void onReverse(internalId)}
                              disabled={busy}
                            >
                              Reverse
                            </Button>
                            {o.linked_position_id ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => void onExitLinkedPosition(o.linked_position_id!, internalId)}
                                disabled={busy}
                              >
                                Exit pos
                              </Button>
                            ) : null}
                            {o.linked_position_id ? (
                              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => navigate('/positions')}>
                                Position
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => {
                                setPayloadOrderId(internalId)
                                setPayloadOpen(true)
                              }}
                            >
                              Payload
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {orders.isError ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={15}>
                    Unable to load orders. Check API connectivity and try refresh.
                  </td>
                </tr>
              ) : orders.isFetching && !rows.length ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={15}>
                    Loading orders…
                  </td>
                </tr>
              ) : !filteredRows.length && !orders.isFetching ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={15}>
                    No orders in selected date range.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={payloadOpen} onOpenChange={setPayloadOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Broker payload (sanitized)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {orderDetail.isFetching ? <div className="text-sm text-muted-foreground">Loading…</div> : null}
            {orderDetail.data ? (
              <>
                <pre className="max-h-[360px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
                  {JSON.stringify(orderDetail.data.preview_snapshot_json, null, 2)}
                </pre>
                <pre className="max-h-[360px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
                  {JSON.stringify(orderDetail.data.broker_payload_json, null, 2)}
                </pre>
                {orderDetail.data.execution_intent_json ? (
                  <pre className="max-h-[360px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
                    {JSON.stringify(orderDetail.data.execution_intent_json, null, 2)}
                  </pre>
                ) : null}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No payload available.</div>
            )}
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
