import { type ComponentProps, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import * as holdingsApi from '@/lib/api/holdings'
import * as instrumentsApi from '@/lib/api/instruments'
import { formatMoney, formatNumber, formatPct, formatQty } from '@/lib/format'
import { StockOrderDialog } from '@/features/orders/StockOrderDialog'

const EMPTY_HOLDINGS: holdingsApi.HoldingOut[] = []

function pnlClass(v: number | null) {
  if (v == null) return 'text-muted-foreground'
  if (v > 0) return 'text-emerald-700 dark:text-emerald-300'
  if (v < 0) return 'text-destructive'
  return 'text-muted-foreground'
}

export function HoldingsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)

  const [q, setQ] = useState('')
  const [broker, setBroker] = useState<'angel' | 'zerodha' | ''>('')

  const [stockDialogOpen, setStockDialogOpen] = useState(false)
  const [stockLaunch, setStockLaunch] = useState<ComponentProps<typeof StockOrderDialog>['launch'] | null>(null)
  const [dialogKey, setDialogKey] = useState<string>('holdings')
  const [banner, setBanner] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const actionBusy = useMemo(() => new Set<string>(), [])
  const [, bump] = useState(0)
  const setBusy = (id: string, v: boolean) => {
    if (v) actionBusy.add(id)
    else actionBusy.delete(id)
    bump((x) => x + 1)
  }

  const closeDialogs = () => {
    setStockDialogOpen(false)
    setStockLaunch(null)
  }

  const _exchangeHint = (h: holdingsApi.HoldingOut): instrumentsApi.Exchange | undefined => {
    const raw = (h.exchange ?? '').toUpperCase()
    if (raw === 'NSE') return 'NSE_EQ'
    if (raw === 'BSE') return 'BSE_EQ'
    return undefined
  }

  const _resolveInstrument = async (h: holdingsApi.HoldingOut): Promise<instrumentsApi.InstrumentOut | null> => {
    if (h.instrument) return h.instrument
    if (!accessToken) return null

    if (h.canonical_id) {
      try {
        return await instrumentsApi.getInstrument(accessToken, h.canonical_id)
      } catch {
        // fall through to search
      }
    }

    const exchange = _exchangeHint(h)
    const attempts = [
      (h.isin ?? '').trim(),
      (h.symbol_display ?? '').trim(),
    ].filter(Boolean)
    if (!attempts.length) return null

    for (const q of attempts) {
      try {
        const res = await instrumentsApi.searchInstruments(accessToken, {
          q,
          limit: 10,
          segment: 'EQUITY',
          exchange,
        })
        if (!res.items.length) continue
        if (h.isin) {
          const exact = res.items.find((i) => (i.isin ?? '').toUpperCase() === h.isin?.toUpperCase())
          if (exact) return exact
        }
        if (h.symbol_display) {
          const sym = h.symbol_display.toUpperCase()
          const exact = res.items.find((i) => i.display_symbol.toUpperCase() === sym || i.symbol_root.toUpperCase() === sym)
          if (exact) return exact
        }
        return res.items[0]
      } catch {
        // try next attempt
      }
    }

    return null
  }

  const openHoldingTicket = async (h: holdingsApi.HoldingOut, side: 'BUY' | 'SELL') => {
    setBusy(h.row_id, true)
    try {
      const inst = await _resolveInstrument(h)
      if (!inst) {
        const msg = 'Instrument not found in local master. Sync instruments and try again.'
        setRowErrors((cur) => ({ ...cur, [h.row_id]: msg }))
        return
      }

      const qty = Math.max(1, Number(side === 'SELL' ? h.quantity : 1))
      setDialogKey([inst.canonical_id, h.broker, side, String(qty)].join(':'))
      setRowErrors((cur) => {
        if (!cur[h.row_id]) return cur
        const next = { ...cur }
        delete next[h.row_id]
        return next
      })
      setStockLaunch({
        mode: 'contract',
        instrument: inst,
        broker: h.broker,
      referencePrice: h.last_price ?? h.average_price ?? null,
      prefill: {
        side,
        quantity: qty,
        product: 'CNC',
        intent: {
          source: 'manual_ui',
          intent_type: side === 'SELL' ? 'EXIT' : 'ENTRY',
          trigger_mode: null,
          risk_mode: null,
          sl_value: null,
          tp_value: null,
          trailing_value: null,
          parent_order_id: null,
          linked_position_id: null,
          broker_context: h.broker,
        },
      },
    })
      setStockDialogOpen(true)
    } finally {
      setBusy(h.row_id, false)
    }
  }

  const holdings = useQuery<holdingsApi.HoldingsListResponse>({
    queryKey: ['holdings', { q, broker }],
    queryFn: async () => {
      if (!accessToken) return { items: [], meta: { broker_errors: {} } }
      return holdingsApi.listHoldings(accessToken, {
        q: q.trim() || undefined,
        broker: broker || undefined,
        limit: 1000,
      })
    },
    enabled: Boolean(accessToken),
    refetchInterval: 60_000,
  })

  const rows = holdings.data?.items ?? EMPTY_HOLDINGS
  const brokerErrors = holdings.data?.meta?.broker_errors ?? {}

  const totals = useMemo(() => {
    let invested = 0
    let current = 0
    let pnl = 0
    let investedOk = false
    let currentOk = false
    let pnlOk = false
    for (const r of rows) {
      if (r.invested_value != null) {
        invested += r.invested_value
        investedOk = true
      }
      if (r.current_value != null) {
        current += r.current_value
        currentOk = true
      }
      if (r.pnl != null) {
        pnl += r.pnl
        pnlOk = true
      }
    }
    return {
      invested: investedOk ? invested : null,
      current: currentOk ? current : null,
      pnl: pnlOk ? pnl : null,
    }
  }, [rows])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Holdings</h1>
          <p className="text-sm text-muted-foreground">Broker holdings inventory (delivery/long-term). Values reflect broker snapshots.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void holdings.refetch()} disabled={holdings.isFetching}>
            {holdings.isFetching ? 'Refreshing…' : 'Refresh'}
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

      {Object.keys(brokerErrors).length ? (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <div className="text-xs font-medium">Broker holdings warnings</div>
          <div className="mt-1 space-y-1 text-xs text-muted-foreground">
            {Object.entries(brokerErrors).map(([b, msg]) => (
              <div key={b}>
                <span className="font-medium">{b}:</span> {msg}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Invested</CardTitle>
          </CardHeader>
          <CardContent className="py-3 pt-0 text-lg font-semibold tabular-nums">{formatMoney(totals.invested)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Current</CardTitle>
          </CardHeader>
          <CardContent className="py-3 pt-0 text-lg font-semibold tabular-nums">{formatMoney(totals.current)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Unrealized P&amp;L</CardTitle>
          </CardHeader>
          <CardContent className={cn('py-3 pt-0 text-lg font-semibold tabular-nums', pnlClass(totals.pnl))}>
            {formatMoney(totals.pnl)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search symbol / ISIN / canonical id…" className="w-80" />
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
          <div className="text-sm font-medium">Holdings</div>
          <div className="text-xs text-muted-foreground">{rows.length} rows</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-left">Actions</th>
                <th className="px-3 py-2 text-left">Broker</th>
                <th className="px-3 py-2 text-left">Qty</th>
                <th className="px-3 py-2 text-left">Avg cost</th>
                <th className="px-3 py-2 text-left">LTP</th>
                <th className="px-3 py-2 text-left">Invested</th>
                <th className="px-3 py-2 text-left">Current</th>
                <th className="px-3 py-2 text-left">P&amp;L</th>
                <th className="px-3 py-2 text-left">Day chg</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((h) => {
                const title = h.instrument?.display_symbol ?? h.symbol_display ?? '—'
                const kind = h.instrument?.instrument_type ?? (h.exchange ? h.exchange : '—')
                const busy = actionBusy.has(h.row_id)
                const rowErr = rowErrors[h.row_id] ?? null
                return (
                  <tr
                    key={h.row_id}
                    className="hover:bg-accent/20"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="font-medium">{title}</div>
                        <Badge variant="outline">{kind}</Badge>
                      </div>
                      <div className="mt-0.5 break-all text-[11px] text-muted-foreground">
                        {h.canonical_id ?? h.isin ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={cn(
                            'h-8 px-3 text-xs',
                            'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 hover:bg-emerald-500/15 dark:text-emerald-200',
                          )}
                          onClick={() => void openHoldingTicket(h, 'BUY')}
                          disabled={busy}
                        >
                          {busy ? '…' : 'Buy'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className={cn(
                            'h-8 px-3 text-xs',
                            'border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15',
                          )}
                          onClick={() => void openHoldingTicket(h, 'SELL')}
                          disabled={busy || h.quantity <= 0}
                        >
                          {busy ? '…' : 'Sell'}
                        </Button>
                      </div>
                      {rowErr ? (
                        <div className="mt-1 max-w-[260px] text-[11px] text-destructive">{rowErr}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{h.broker}</td>
                    <td className="px-3 py-2 tabular-nums">{formatQty(h.quantity)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatNumber(h.average_price)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatNumber(h.last_price)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(h.invested_value)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(h.current_value)}</td>
                    <td className={cn('px-3 py-2 tabular-nums font-medium', pnlClass(h.pnl))}>{formatMoney(h.pnl)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {h.day_change != null ? (
                        <span className={cn('font-medium', pnlClass(h.day_change))}>
                          {formatNumber(h.day_change)} {h.day_change_percentage != null ? `(${formatPct(h.day_change_percentage)})` : ''}
                        </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    </td>
                  </tr>
                )
              })}
              {holdings.isError ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={10}>
                    Unable to load holdings. Check API connectivity and try refresh.
                  </td>
                </tr>
              ) : holdings.isFetching && !rows.length ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={10}>
                    Loading holdings…
                  </td>
                </tr>
              ) : !rows.length && !holdings.isFetching ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={10}>
                    No holdings yet. Connect a broker to view holdings.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {stockLaunch ? (
        <StockOrderDialog
          key={dialogKey}
          open={stockDialogOpen}
          onOpenChange={(v) => (v ? setStockDialogOpen(true) : closeDialogs())}
          launch={stockLaunch}
        />
      ) : null}
    </div>
  )
}
