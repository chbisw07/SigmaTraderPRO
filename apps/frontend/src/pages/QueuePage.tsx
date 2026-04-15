import { type ComponentProps, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import * as queueApi from '@/lib/api/queue'
import * as instrumentsApi from '@/lib/api/instruments'
import type { ExecutionIntent } from '@/lib/api/orders'
import { useAuthStore } from '@/store/authStore'
import { StockOrderDialog } from '@/features/orders/StockOrderDialog'
import { FnoOrderDialog } from '@/features/orders/FnoOrderDialog'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function coerceOrderType(value: unknown): 'MARKET' | 'LIMIT' | undefined {
  if (value === 'MARKET' || value === 'LIMIT') return value
  return undefined
}

function coerceProduct(value: unknown): 'CNC' | 'MIS' | 'NRML' | undefined {
  if (value === 'CNC' || value === 'MIS' || value === 'NRML') return value
  return undefined
}

function isExecutionIntent(value: unknown): value is ExecutionIntent {
  const v = asRecord(value)
  if (!v) return false
  const entry = asRecord(v.entry)
  const plan = asRecord(v.plan)
  return typeof v.version === 'string' && Boolean(entry) && Boolean(plan)
}

function statusBadge(status: string | null) {
  const s = (status ?? '').toUpperCase()
  if (s === 'DISPATCHED') return 'bg-emerald-600 text-white'
  if (s === 'BLOCKED') return 'bg-amber-500 text-white'
  if (s === 'FAILED') return 'bg-destructive text-destructive-foreground'
  if (s === 'CANCELLED') return 'bg-muted text-muted-foreground'
  return 'bg-muted text-foreground'
}

export function QueuePage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [q, setQ] = useState(searchParams.get('q') ?? '')
  const [status, setStatus] = useState(searchParams.get('status') ?? '')
  const [resolutionState, setResolutionState] = useState(searchParams.get('resolution_state') ?? '')

  const [inspectOpen, setInspectOpen] = useState(false)
  const [inspect, setInspect] = useState<queueApi.QueueItemOut | null>(null)

  const [resolveOpen, setResolveOpen] = useState(false)
  const [resolveItem, setResolveItem] = useState<queueApi.QueueItemOut | null>(null)
  const [resolveBroker, setResolveBroker] = useState('')
  const [resolveProduct, setResolveProduct] = useState('')
  const [resolveOrderType, setResolveOrderType] = useState('')
  const [resolveQty, setResolveQty] = useState('')
  const [resolveLimit, setResolveLimit] = useState('')
  const [instrumentSearch, setInstrumentSearch] = useState('')
  const [selectedInstrument, setSelectedInstrument] = useState<instrumentsApi.InstrumentOut | null>(null)

  const [stockDialogOpen, setStockDialogOpen] = useState(false)
  const [fnoDialogOpen, setFnoDialogOpen] = useState(false)
  const [dialogKey, setDialogKey] = useState('queue')
  const [stockLaunch, setStockLaunch] = useState<ComponentProps<typeof StockOrderDialog>['launch'] | null>(null)
  const [fnoLaunch, setFnoLaunch] = useState<ComponentProps<typeof FnoOrderDialog>['launch'] | null>(null)
  const [editQueueId, setEditQueueId] = useState<number | null>(null)

  const closeDialogs = () => {
    setStockDialogOpen(false)
    setFnoDialogOpen(false)
    setStockLaunch(null)
    setFnoLaunch(null)
    setEditQueueId(null)
  }

  const queue = useQuery({
    queryKey: ['queue', { q, status, resolutionState }],
    queryFn: async () => {
      if (!accessToken) return { items: [], meta: {} }
      return queueApi.listQueue(accessToken, {
        q: q.trim() || undefined,
        status: status || undefined,
        resolution_state: resolutionState || undefined,
        limit: 300,
      })
    },
    enabled: Boolean(accessToken),
    refetchInterval: 20_000,
  })

  const executeMutation = useMutation({
    mutationFn: async (itemId: number) => {
      if (!accessToken) throw new Error('Not authenticated')
      return queueApi.executeQueueItem(accessToken, itemId)
    },
    onSuccess: async () => {
      await queue.refetch()
    },
  })

  const cancelMutation = useMutation({
    mutationFn: async (itemId: number) => {
      if (!accessToken) throw new Error('Not authenticated')
      return queueApi.cancelQueueItem(accessToken, itemId)
    },
    onSuccess: async () => {
      await queue.refetch()
    },
  })

  const rows = queue.data?.items ?? []

  const openEdit = async (item: queueApi.QueueItemOut) => {
    if (!accessToken) return
    if (!item.instrument?.canonical_id) return
    const inst = item.instrument
    setDialogKey(`q:${item.id}:${inst.canonical_id}:${item.updated_at}`)
    const intent = asRecord(item.execution_intent) ?? {}
    const entry = asRecord(intent.entry) ?? {}
    const plan = asRecord(intent.plan) ?? {}
    const broker = (entry.broker as string | undefined) ?? String(item.broker ?? '')
    if (broker !== 'angel' && broker !== 'zerodha') return
    const product = coerceProduct(entry.product) ?? coerceProduct(item.product) ?? 'CNC'
    const orderType = coerceOrderType(entry.order_type) ?? coerceOrderType(item.order_type) ?? 'MARKET'
    const executionIntent = isExecutionIntent(item.execution_intent) ? item.execution_intent : null
    if (inst.segment === 'EQUITY') {
      setStockLaunch({
        mode: 'contract',
        instrument: inst as instrumentsApi.InstrumentOut,
        broker,
        referencePrice: (plan.reference_price as number | null | undefined) ?? null,
        prefill: {
          side: (entry.side as 'BUY' | 'SELL' | undefined) ?? item.side ?? 'BUY',
          quantity: (entry.quantity as number | undefined) ?? item.quantity ?? 1,
          product,
          order_type: orderType,
          limit_price: (entry.limit_price as number | null | undefined) ?? item.limit_price ?? null,
          execution_intent: executionIntent,
          intent: {
            source: 'manual_ui',
            intent_type: 'ENTRY',
            trigger_mode: null,
            risk_mode: null,
            sl_value: null,
            tp_value: null,
            trailing_value: null,
            parent_order_id: null,
            linked_position_id: null,
            broker_context: `queue:${item.id}`,
          },
        },
      })
      setEditQueueId(item.id)
      setStockDialogOpen(true)
    } else {
      setFnoLaunch({
        mode: 'contract',
        instrument: inst as instrumentsApi.InstrumentOut,
        broker,
        referencePrice: (plan.reference_price as number | null | undefined) ?? null,
        prefill: {
          side: (entry.side as 'BUY' | 'SELL' | undefined) ?? item.side ?? 'BUY',
          lots: (entry.lots as number | undefined) ?? item.lots ?? 1,
          product: product === 'MIS' ? 'MIS' : 'NRML',
          order_type: orderType,
          limit_price: (entry.limit_price as number | null | undefined) ?? item.limit_price ?? null,
          execution_intent: executionIntent,
          intent: {
            source: 'manual_ui',
            intent_type: 'ENTRY',
            trigger_mode: null,
            risk_mode: null,
            sl_value: null,
            tp_value: null,
            trailing_value: null,
            parent_order_id: null,
            linked_position_id: null,
            broker_context: `queue:${item.id}`,
          },
        },
      })
      setEditQueueId(item.id)
      setFnoDialogOpen(true)
    }
  }

  const onApplyFilters = () => {
    const next = new URLSearchParams()
    if (q.trim()) next.set('q', q.trim())
    if (status) next.set('status', status)
    if (resolutionState) next.set('resolution_state', resolutionState)
    setSearchParams(next, { replace: true })
    void queue.refetch()
  }

  const busyIds = useMemo(() => new Set<number>(), [])

  const instrumentSearchQuery = useQuery({
    queryKey: ['instrumentSearch', { instrumentSearch }],
    queryFn: async () => {
      if (!accessToken) return { items: [] }
      return instrumentsApi.searchInstruments(accessToken, { q: instrumentSearch, limit: 20 })
    },
    enabled: Boolean(accessToken) && instrumentSearch.trim().length >= 2,
  })

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Not authenticated')
      if (!resolveItem) throw new Error('Missing queue item')
      return queueApi.resolveQueueItem(accessToken, resolveItem.id, {
        broker: resolveBroker || null,
        canonical_id: selectedInstrument?.canonical_id ?? null,
        product: resolveProduct || null,
        order_type: resolveOrderType || null,
        quantity: resolveQty ? Number(resolveQty) : null,
        limit_price: resolveLimit ? Number(resolveLimit) : null,
      })
    },
    onSuccess: async () => {
      await queue.refetch()
      setResolveOpen(false)
      setResolveItem(null)
      setSelectedInstrument(null)
      setInstrumentSearch('')
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Queue</h1>
          <p className="text-sm text-muted-foreground">
            Execution-intent ingestion queue (manual review / auto dispatch).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void queue.refetch()} disabled={queue.isFetching}>
            {queue.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-card p-3">
        <div className="text-sm font-medium">Filters</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            aria-label="Queue search"
            placeholder="Search symbol / canonical id / notes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-[280px]"
          />
          <select
            aria-label="Queue status filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={cn(
              'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <option value="">All statuses</option>
            <option value="ready">Ready</option>
            <option value="queued">Queued</option>
            <option value="blocked">Blocked</option>
            <option value="approved">Approved</option>
            <option value="dispatched">Dispatched</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
            <option value="expired">Expired</option>
          </select>
          <select
            aria-label="Queue resolution filter"
            value={resolutionState}
            onChange={(e) => setResolutionState(e.target.value)}
            className={cn(
              'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <option value="">All resolution</option>
            <option value="resolved">Resolved</option>
            <option value="unresolved">Unresolved</option>
          </select>
          <Button type="button" size="sm" variant="outline" onClick={onApplyFilters}>
            Apply
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setQ('')
              setStatus('')
              setResolutionState('')
              setSearchParams(new URLSearchParams(), { replace: true })
              void queue.refetch()
            }}
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <div className="overflow-auto">
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
              <tr className="border-b">
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Time</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Source</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Strategy</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Broker</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Symbol</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Side</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Qty/Lots</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Product</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Mode</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Order</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const busy = busyIds.has(item.id) || executeMutation.isPending || cancelMutation.isPending
                const sym = item.instrument?.display_symbol ?? item.canonical_id
                const qtyText = item.lots ? `${item.lots} lots` : item.quantity != null ? `${item.quantity}` : '—'
                const resolution = asRecord(item.resolution) ?? {}
                const unresolvedFields = Array.isArray(resolution.unresolved_fields) ? (resolution.unresolved_fields as string[]) : undefined
                const isUnresolved = item.resolution_state === 'unresolved' || (item.resolution_state == null && (item.validation_state === 'blocked' && unresolvedFields?.length))
                return (
                  <tr key={item.id} className="border-b transition-colors hover:bg-accent/30">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <Badge variant="outline">{item.source_type}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {item.strategy_name ? (
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium">{item.strategy_name}</div>
                          {item.signal_price != null ? (
                            <div className="text-[11px] text-muted-foreground">signal: {item.signal_price}</div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{String(item.broker)}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{sym}</div>
                      <div className="text-[11px] text-muted-foreground break-all">{item.canonical_id}</div>
                      {isUnresolved && unresolvedFields?.length ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Unresolved: {unresolvedFields.slice(0, 3).join(', ')}
                          {unresolvedFields.length > 3 ? ` +${unresolvedFields.length - 3}` : ''}
                        </div>
                      ) : null}
                      {item.validation_state === 'blocked' && (item.block_reason_message || item.block_reason_code) ? (
                        <div className="mt-1 text-[11px] text-amber-800 dark:text-amber-200">
                          {(item.block_reason_message || item.block_reason_code) as string}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">{item.side}</td>
                    <td className="px-3 py-2 text-xs">{qtyText}</td>
                    <td className="px-3 py-2 text-xs">{String(item.product)}</td>
                    <td className="px-3 py-2 text-xs">
                      <Badge variant="outline">{item.execution_mode}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex items-center rounded-md px-2 py-1 text-xs font-medium', statusBadge(item.status))}>
                        {item.status}
                      </span>
                      {isUnresolved ? (
                        <span className="ml-2 inline-flex items-center rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                          unresolved
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {item.dispatched_order_id ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => navigate(`/orders?q=${encodeURIComponent(String(item.dispatched_order_id))}`)}>
                          #{item.dispatched_order_id}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setResolveItem(item)
                            setResolveBroker(item.broker === '__unresolved__' ? '' : String(item.broker ?? ''))
                            setResolveProduct(String(item.product ?? ''))
                            setResolveOrderType(String(item.order_type ?? ''))
                            setResolveQty(item.quantity != null ? String(item.quantity) : '')
                            setResolveLimit(item.limit_price != null ? String(item.limit_price) : '')
                            setSelectedInstrument(item.instrument ?? null)
                            setInstrumentSearch(item.instrument?.display_symbol ?? '')
                            setResolveOpen(true)
                          }}
                          disabled={busy || !isUnresolved}
                        >
                          Resolve
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setInspect(item)
                            setInspectOpen(true)
                          }}
                        >
                          Inspect
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void openEdit(item)} disabled={busy || item.status === 'dispatched' || item.status === 'cancelled'}>
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void executeMutation.mutateAsync(item.id)}
                          disabled={busy || item.status === 'dispatched' || item.status === 'cancelled'}
                        >
                          Execute
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void cancelMutation.mutateAsync(item.id)}
                          disabled={busy || item.status === 'dispatched' || item.status === 'cancelled'}
                        >
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {queue.isError ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={11}>
                    Unable to load queue. Check API connectivity.
                  </td>
                </tr>
              ) : queue.isFetching && !rows.length ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={11}>
                    Loading queue…
                  </td>
                </tr>
              ) : !rows.length && !queue.isFetching ? (
                <tr>
                  <td className="px-3 py-6 text-center text-sm text-muted-foreground" colSpan={11}>
                    No queue items yet. Use “Add to queue” from an order dialog.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={inspectOpen} onOpenChange={setInspectOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Queue item</DialogTitle>
          </DialogHeader>
          {inspect ? (
            <pre className="max-h-[520px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
              {JSON.stringify(inspect, null, 2)}
            </pre>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Resolve queue item</DialogTitle>
          </DialogHeader>
          {resolveItem ? (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Fill missing routing/instrument fields so this item becomes execution-ready.
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Broker</div>
                  <select
                    value={resolveBroker}
                    onChange={(e) => setResolveBroker(e.target.value)}
                    className={cn(
                      'h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    )}
                  >
                    <option value="">(unresolved)</option>
                    <option value="angel">Angel</option>
                    <option value="zerodha">Zerodha</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Instrument</div>
                  <Input
                    value={instrumentSearch}
                    onChange={(e) => {
                      setInstrumentSearch(e.target.value)
                      setSelectedInstrument(null)
                    }}
                    placeholder="Search instrument…"
                  />
                  {instrumentSearchQuery.data?.items?.length ? (
                    <div className="max-h-40 overflow-auto rounded-md border bg-card shadow-sm">
                      {instrumentSearchQuery.data.items.map((inst) => (
                        <button
                          key={inst.canonical_id}
                          type="button"
                          className="block w-full px-2 py-1 text-left text-sm hover:bg-accent/40"
                          onClick={() => {
                            setSelectedInstrument(inst)
                            setInstrumentSearch(inst.display_symbol)
                          }}
                        >
                          <div className="font-medium">{inst.display_symbol}</div>
                          <div className="text-[11px] text-muted-foreground break-all">{inst.canonical_id}</div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {selectedInstrument ? (
                    <div className="text-[11px] text-muted-foreground">
                      Selected: {selectedInstrument.canonical_id}
                    </div>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Product</div>
                  <select
                    value={resolveProduct}
                    onChange={(e) => setResolveProduct(e.target.value)}
                    className={cn(
                      'h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    )}
                  >
                    <option value="">(unresolved)</option>
                    <option value="CNC">CNC</option>
                    <option value="MIS">MIS</option>
                    <option value="NRML">NRML</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Order type</div>
                  <select
                    value={resolveOrderType}
                    onChange={(e) => setResolveOrderType(e.target.value)}
                    className={cn(
                      'h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    )}
                  >
                    <option value="">(unresolved)</option>
                    <option value="MARKET">MARKET</option>
                    <option value="LIMIT">LIMIT</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Quantity</div>
                  <Input value={resolveQty} onChange={(e) => setResolveQty(e.target.value)} placeholder="e.g. 1" />
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">Limit price</div>
                  <Input value={resolveLimit} onChange={(e) => setResolveLimit(e.target.value)} placeholder="if LIMIT" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setResolveOpen(false)}>
                  Close
                </Button>
                <Button type="button" onClick={() => void resolveMutation.mutateAsync()} disabled={resolveMutation.isPending}>
                  {resolveMutation.isPending ? 'Saving…' : 'Save resolution'}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {stockLaunch && editQueueId != null ? (
        <StockOrderDialog
          key={dialogKey}
          open={stockDialogOpen}
          onOpenChange={(v) => (v ? setStockDialogOpen(true) : closeDialogs())}
          launch={stockLaunch}
          intentSubmit={{
            label: 'Save changes',
            requirePreview: false,
            onSubmit: async (intent) => {
              if (!accessToken) throw new Error('Not authenticated')
              await queueApi.updateQueueItem(accessToken, editQueueId, { execution_intent: intent })
              await queue.refetch()
              closeDialogs()
            },
          }}
        />
      ) : null}
      {fnoLaunch && editQueueId != null ? (
        <FnoOrderDialog
          key={dialogKey}
          open={fnoDialogOpen}
          onOpenChange={(v) => (v ? setFnoDialogOpen(true) : closeDialogs())}
          launch={fnoLaunch}
          intentSubmit={{
            label: 'Save changes',
            requirePreview: false,
            onSubmit: async (intent) => {
              if (!accessToken) throw new Error('Not authenticated')
              await queueApi.updateQueueItem(accessToken, editQueueId, { execution_intent: intent })
              await queue.refetch()
              closeDialogs()
            },
          }}
        />
      ) : null}
    </div>
  )
}
