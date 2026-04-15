import { type ComponentProps, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatMoney, formatNumber, formatQty, formatStrikeHuman } from '@/lib/format'
import { useAuthStore } from '@/store/authStore'
import * as positionsApi from '@/lib/api/positions'
import type * as ordersApi from '@/lib/api/orders'
import { StockOrderDialog } from '@/features/orders/StockOrderDialog'
import { FnoOrderDialog } from '@/features/orders/FnoOrderDialog'

const EMPTY_POSITIONS: positionsApi.PositionOut[] = []

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

export function PositionsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [q, setQ] = useState(() => searchParams.get('q') ?? '')
  const [broker, setBroker] = useState<ordersApi.BrokerKey | ''>('')
  const [instrumentType, setInstrumentType] = useState<string>('')

  useEffect(() => {
    const next = searchParams.get('q') ?? ''
    setQ(next)
  }, [searchParams])

  const positions = useQuery({
    queryKey: ['positions', { q, broker, instrumentType }],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      return positionsApi.listPositions(accessToken, {
        q: q.trim() || undefined,
        broker: broker || undefined,
        instrument_type: instrumentType || undefined,
        limit: 200,
      })
    },
    enabled: Boolean(accessToken),
    refetchInterval: 30_000,
  })

  const rows = positions.data?.items ?? EMPTY_POSITIONS

  const pnlClass = (v: number | null) => {
    if (v == null) return 'text-muted-foreground'
    if (v > 0) return 'text-emerald-700 dark:text-emerald-300'
    if (v < 0) return 'text-destructive'
    return 'text-muted-foreground'
  }

  const totals = useMemo(() => {
    let realized = 0
    let unrealized = 0
    let mtm = 0
    let realizedOk = false
    let unrealizedOk = false
    let mtmOk = false
    for (const r of rows) {
      if (r.realized_pnl != null) {
        realized += r.realized_pnl
        realizedOk = true
      }
      if (r.unrealized_pnl != null) {
        unrealized += r.unrealized_pnl
        unrealizedOk = true
      }
      if (r.mtm != null) {
        mtm += r.mtm
        mtmOk = true
      }
    }
    return {
      realized: realizedOk ? realized : null,
      unrealized: unrealizedOk ? unrealized : null,
      mtm: mtmOk ? mtm : null,
    }
  }, [rows])

  const [stockDialogOpen, setStockDialogOpen] = useState(false)
  const [stockLaunch, setStockLaunch] = useState<ComponentProps<typeof StockOrderDialog>['launch'] | null>(null)
  const [fnoDialogOpen, setFnoDialogOpen] = useState(false)
  const [fnoLaunch, setFnoLaunch] = useState<ComponentProps<typeof FnoOrderDialog>['launch'] | null>(null)
  const [dialogKey, setDialogKey] = useState<string>('manual')
  const [banner, setBanner] = useState<string | null>(null)
  const [autoSyncDone, setAutoSyncDone] = useState(false)

  const closeDialogs = () => {
    setStockDialogOpen(false)
    setFnoDialogOpen(false)
    setStockLaunch(null)
    setFnoLaunch(null)
  }

  const openDraft = (draft: ordersApi.OrderDraft) => {
    const inst = draft.instrument
    const keyBits = [inst.canonical_id, draft.broker, draft.side, draft.order_type, String(draft.quantity ?? draft.lots ?? '')]
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

  const onSquareoff = async (positionId: number) => {
    if (!accessToken) return
    setBusy(positionId, true)
    try {
      const res = await positionsApi.squareoffDraft(accessToken, positionId)
      openDraft(res.draft)
    } finally {
      setBusy(positionId, false)
    }
  }

  const onReverse = async (positionId: number) => {
    if (!accessToken) return
    setBusy(positionId, true)
    try {
      const res = await positionsApi.reverseDraft(accessToken, positionId)
      openDraft(res.draft)
    } finally {
      setBusy(positionId, false)
    }
  }

  const onRefresh = async (positionId: number) => {
    if (!accessToken) return
    setBusy(positionId, true)
    try {
      const res = await positionsApi.refreshPosition(accessToken, positionId)
      setBanner(res.message)
      await positions.refetch()
    } finally {
      setBusy(positionId, false)
    }
  }

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Not authenticated')
      // If the user has not filtered a broker, sync all configured brokers.
      return positionsApi.syncPositions(accessToken, { broker: broker || undefined })
    },
    onSuccess: async (data) => {
      setBanner(data.message)
      await positions.refetch()
    },
    onError: () => {
      setBanner('Broker sync failed')
    },
  })

  useEffect(() => {
    if (!accessToken) return
    if (autoSyncDone) return
    if (positions.isFetching) return
    const rowsNow = positions.data?.items ?? []
    if (rowsNow.length) {
      setAutoSyncDone(true)
      return
    }
    // Auto sync once when the page is empty (common on first run).
    setAutoSyncDone(true)
    void syncMutation.mutateAsync()
  }, [accessToken, autoSyncDone, broker, positions.data, positions.isFetching, syncMutation])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Positions</h1>
          <p className="text-sm text-muted-foreground">Local broker-neutral positions ledger (fill-level accuracy is reconciled later).</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void syncMutation.mutateAsync()}
            disabled={syncMutation.isPending || !accessToken}
          >
            {syncMutation.isPending ? 'Syncing…' : 'Sync from broker'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void positions.refetch()} disabled={positions.isFetching}>
            {positions.isFetching ? 'Refreshing…' : 'Refresh view'}
          </Button>
        </div>
      </div>
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

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Realized P&amp;L</CardTitle>
          </CardHeader>
          <CardContent className={cn('py-3 pt-0 text-lg font-semibold tabular-nums', pnlClass(totals.realized))}>
            {formatMoney(totals.realized)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Unrealized P&amp;L</CardTitle>
          </CardHeader>
          <CardContent className={cn('py-3 pt-0 text-lg font-semibold tabular-nums', pnlClass(totals.unrealized))}>
            {formatMoney(totals.unrealized)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">MTM</CardTitle>
          </CardHeader>
          <CardContent className={cn('py-3 pt-0 text-lg font-semibold tabular-nums', pnlClass(totals.mtm))}>
            {formatMoney(totals.mtm)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol / canonical id…" className="w-72" />
          <select
            value={broker}
            onChange={(e) => {
              const v = e.target.value
              if (v === '' || v === 'angel' || v === 'zerodha') setBroker(v)
              else setBroker('')
            }}
            className={cn(
              'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <option value="">All brokers</option>
            <option value="angel">Angel One</option>
            <option value="zerodha">Zerodha</option>
          </select>
          <select
            value={instrumentType}
            onChange={(e) => setInstrumentType(e.target.value)}
            className={cn(
              'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
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
            variant="outline"
            size="sm"
            onClick={() => {
              setQ('')
              setBroker('')
              setInstrumentType('')
            }}
          >
            Clear
          </Button>
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <div className="text-sm font-medium">Updated first</div>
          <div className="text-xs text-muted-foreground">{rows.length} positions</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/95 text-[11px] font-semibold text-muted-foreground backdrop-blur">
              <tr className="border-b">
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-left">Broker</th>
                <th className="px-3 py-2 text-left">Side</th>
                <th className="px-3 py-2 text-left">Qty/Lots</th>
                <th className="px-3 py-2 text-left">Avg</th>
                <th className="px-3 py-2 text-left">LTP</th>
                <th className="px-3 py-2 text-left">Realized</th>
                <th className="px-3 py-2 text-left">Unrealized</th>
                <th className="px-3 py-2 text-left">MTM</th>
                <th className="px-3 py-2 text-left">Orders</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => {
                const busy = actionBusy.has(p.id)
                const title = instrumentTitle(p.instrument)
                const kind = p.instrument?.instrument_type ?? '—'
                const sideCls = p.side === 'BUY' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
                return (
                  <tr key={p.id} className="transition-colors hover:bg-accent/30">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{title}</div>
                        <Badge variant="outline">{kind}</Badge>
                      </div>
                      <div className="mt-0.5 break-all text-[11px] text-muted-foreground">{p.canonical_id}</div>
                    </td>
                    <td className="px-3 py-2">{p.broker}</td>
                    <td className={cn('px-3 py-2 font-medium', sideCls)}>{p.side}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {p.lots != null ? `${formatQty(p.lots)} lots` : formatQty(p.quantity)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatNumber(p.avg_price)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatNumber(p.last_price)}</td>
                    <td className={cn('px-3 py-2 tabular-nums font-medium', pnlClass(p.realized_pnl))}>
                      {formatMoney(p.realized_pnl)}
                    </td>
                    <td className={cn('px-3 py-2 tabular-nums font-medium', pnlClass(p.unrealized_pnl))}>
                      {formatMoney(p.unrealized_pnl)}
                    </td>
                    <td className={cn('px-3 py-2 tabular-nums font-medium', pnlClass(p.mtm))}>{formatMoney(p.mtm)}</td>
                    <td className="px-3 py-2 tabular-nums">{p.linked_orders_count}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{p.source}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => void onSquareoff(p.id)} disabled={busy}>
                          {busy ? '…' : 'Square off'}
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void onReverse(p.id)} disabled={busy}>
                          Reverse
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => navigate(`/orders?q=${encodeURIComponent(p.instrument?.display_symbol ?? p.canonical_id)}`)}>
                          Orders
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void onRefresh(p.id)} disabled={busy}>
                          Refresh
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {positions.isError ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={12}>
                    Unable to load positions. Check API connectivity and try refresh.
                  </td>
                </tr>
              ) : positions.isFetching && !rows.length ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={12}>
                    Loading positions…
                  </td>
                </tr>
              ) : !rows.length && !positions.isFetching ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={12}>
                    No positions yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {stockLaunch ? (
        <StockOrderDialog key={dialogKey} open={stockDialogOpen} onOpenChange={(v) => (v ? setStockDialogOpen(true) : closeDialogs())} launch={stockLaunch} />
      ) : null}
      {fnoLaunch ? (
        <FnoOrderDialog key={dialogKey} open={fnoDialogOpen} onOpenChange={(v) => (v ? setFnoDialogOpen(true) : closeDialogs())} launch={fnoLaunch} />
      ) : null}
    </div>
  )
}
