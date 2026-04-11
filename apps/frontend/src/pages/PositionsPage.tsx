import { type ComponentProps, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import * as positionsApi from '@/lib/api/positions'
import type * as ordersApi from '@/lib/api/orders'
import { StockOrderDialog } from '@/features/orders/StockOrderDialog'
import { FnoOrderDialog } from '@/features/orders/FnoOrderDialog'

function instrumentTitle(i: ordersApi.InstrumentOut | null): string {
  if (!i) return '—'
  const root = (i.underlying ?? i.symbol_root).toUpperCase()
  if (i.instrument_type === 'OPTION') {
    return `${root} ${i.expiry ?? '—'} ${i.strike ?? '—'} ${i.option_type ?? ''}`.trim()
  }
  if (i.instrument_type === 'FUTURE') {
    return `${root} ${i.expiry ?? '—'} FUT`.trim()
  }
  return i.display_symbol
}

export function PositionsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const navigate = useNavigate()

  const [q, setQ] = useState('')
  const [broker, setBroker] = useState<ordersApi.BrokerKey | ''>('')

  const positions = useQuery({
    queryKey: ['positions', { q, broker }],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      return positionsApi.listPositions(accessToken, {
        q: q.trim() || undefined,
        broker: broker || undefined,
        limit: 200,
      })
    },
    enabled: Boolean(accessToken),
    refetchInterval: 30_000,
  })

  const rows = positions.data?.items ?? []

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Positions</h1>
          <p className="text-sm text-muted-foreground">Local broker-neutral positions ledger (fill-level accuracy is reconciled later).</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void positions.refetch()} disabled={positions.isFetching}>
            {positions.isFetching ? 'Refreshing…' : 'Refresh'}
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
            className={cn('h-10 rounded-md border bg-background px-2 text-sm outline-none', 'focus-visible:ring-2 focus-visible:ring-ring')}
          >
            <option value="">All brokers</option>
            <option value="angel">Angel One</option>
            <option value="zerodha">Zerodha</option>
          </select>
          <Button type="button" variant="outline" size="sm" onClick={() => { setQ(''); setBroker('') }}>
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
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
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
                <th className="px-3 py-2 text-left">SL</th>
                <th className="px-3 py-2 text-left">TP</th>
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
                  <tr key={p.id} className="hover:bg-accent/20">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{title}</div>
                        <Badge variant="outline">{kind}</Badge>
                      </div>
                      <div className="mt-0.5 break-all text-[11px] text-muted-foreground">{p.canonical_id}</div>
                    </td>
                    <td className="px-3 py-2">{p.broker}</td>
                    <td className={cn('px-3 py-2 font-medium', sideCls)}>{p.side}</td>
                    <td className="px-3 py-2 tabular-nums">{p.lots != null ? `${p.lots} lots` : p.quantity}</td>
                    <td className="px-3 py-2 tabular-nums">{p.avg_price ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{p.last_price ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{p.realized_pnl ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{p.unrealized_pnl ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{p.mtm ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">—</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">—</td>
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
                        <Button type="button" size="sm" variant="outline" disabled>
                          Add SL
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled>
                          Add TP
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!rows.length && !positions.isFetching ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={14}>
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
