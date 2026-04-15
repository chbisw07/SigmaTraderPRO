import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import * as routesApi from '@/lib/api/webhookRoutes'
import type { OrderProduct, OrderType } from '@/lib/api/orders'
import { useAuthStore } from '@/store/authStore'

function policySummary(policy: routesApi.TradingViewRoutePolicy | null | undefined) {
  if (!policy) return '—'
  const bits: string[] = []
  if (policy.product_mode_default) bits.push(`product_mode=${policy.product_mode_default}`)
  if (policy.sizing_mode === 'fixed_quantity' && policy.fixed_quantity) bits.push(`fixed_qty=${policy.fixed_quantity}`)
  if (policy.sizing_mode === 'fixed_amount' && policy.fixed_amount) bits.push(`fixed_amt=${policy.fixed_amount}`)
  if (policy.managed_exits_enabled) bits.push('exits=on')
  return bits.length ? bits.join(' · ') : '—'
}

export function TradingViewSettingsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)

  const coerceProduct = (value: string): OrderProduct | null => {
    if (value === 'CNC' || value === 'MIS' || value === 'NRML') return value
    return null
  }

  const coerceOrderType = (value: string): OrderType | null => {
    if (value === 'MARKET' || value === 'LIMIT') return value
    return null
  }

  const [createName, setCreateName] = useState('TV Main')
  const [createBroker, setCreateBroker] = useState('zerodha')
  const [createMode, setCreateMode] = useState<routesApi.QueueExecutionMode>('manual_review')
  const [createProduct, setCreateProduct] = useState<string>('CNC')
  const [createOrderType, setCreateOrderType] = useState<string>('MARKET')
  const [productModeDefault, setProductModeDefault] = useState<routesApi.ProductMode | ''>('delivery')
  const [sizingMode, setSizingMode] = useState<routesApi.TradingViewSizingMode | ''>('fixed_quantity')
  const [fixedQty, setFixedQty] = useState('1')
  const [fixedAmt, setFixedAmt] = useState('')
  const [managedExitsEnabled, setManagedExitsEnabled] = useState(false)
  const [allowPayloadProduct, setAllowPayloadProduct] = useState(true)
  const [allowPayloadOrderType, setAllowPayloadOrderType] = useState(true)
  const [allowPayloadSizing, setAllowPayloadSizing] = useState(true)
  const [allowPayloadExits, setAllowPayloadExits] = useState(true)

  const [tokenDialogOpen, setTokenDialogOpen] = useState(false)
  const [createdToken, setCreatedToken] = useState<string | null>(null)

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editRoute, setEditRoute] = useState<routesApi.WebhookRouteOut | null>(null)
  const [editName, setEditName] = useState('')
  const [editBroker, setEditBroker] = useState('')
  const [editMode, setEditMode] = useState<routesApi.QueueExecutionMode>('manual_review')
  const [editProduct, setEditProduct] = useState<string>('')
  const [editOrderType, setEditOrderType] = useState<string>('')
  const [editEnabled, setEditEnabled] = useState(true)
  const [editPolicy, setEditPolicy] = useState<routesApi.TradingViewRoutePolicy | null>(null)

  const routes = useQuery({
    queryKey: ['webhook-routes', 'tradingview'],
    queryFn: async () => {
      if (!accessToken) return []
      return routesApi.listTradingViewRoutes(accessToken)
    },
    enabled: Boolean(accessToken),
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Not authenticated')
      const policy: routesApi.TradingViewRoutePolicy = {
        product_mode_default: productModeDefault || null,
        sizing_mode: sizingMode || null,
        fixed_quantity: sizingMode === 'fixed_quantity' ? Number(fixedQty || 0) || null : null,
        fixed_amount: sizingMode === 'fixed_amount' ? Number(fixedAmt || 0) || null : null,
        managed_exits_enabled: managedExitsEnabled,
        allow_payload_product: allowPayloadProduct,
        allow_payload_order_type: allowPayloadOrderType,
        allow_payload_sizing: allowPayloadSizing,
        allow_payload_exits: allowPayloadExits,
      }
      return routesApi.createTradingViewRoute(accessToken, {
        name: createName.trim() || null,
        default_broker_key: createBroker || null,
        default_execution_mode: createMode,
        default_product: coerceProduct(createProduct),
        default_order_type: coerceOrderType(createOrderType),
        policy,
      })
    },
    onSuccess: async (resp) => {
      setCreatedToken(resp.route_token)
      setTokenDialogOpen(true)
      await routes.refetch()
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: number; update: routesApi.WebhookRouteUpdateRequest }) => {
      if (!accessToken) throw new Error('Not authenticated')
      return routesApi.updateTradingViewRoute(accessToken, payload.id, payload.update)
    },
    onSuccess: async () => {
      await routes.refetch()
    },
  })

  const openEdit = (r: routesApi.WebhookRouteOut) => {
    setEditRoute(r)
    setEditName(r.name ?? '')
    setEditBroker(String(r.default_broker_key ?? ''))
    setEditMode(r.default_execution_mode ?? 'manual_review')
    setEditProduct(String(r.default_product ?? ''))
    setEditOrderType(String(r.default_order_type ?? ''))
    setEditEnabled(Boolean(r.is_enabled))
    setEditPolicy(r.policy ?? null)
    setEditDialogOpen(true)
  }

  const updateFromEdit = async () => {
    if (!editRoute) return
    await updateMutation.mutateAsync({
      id: editRoute.id,
      update: {
        name: editName.trim() || null,
        default_broker_key: editBroker || null,
        default_execution_mode: editMode,
        default_product: coerceProduct(editProduct),
        default_order_type: coerceOrderType(editOrderType),
        policy: editPolicy ?? null,
        is_enabled: editEnabled,
      },
    })
    setEditDialogOpen(false)
    setEditRoute(null)
  }

  const sortedRoutes = useMemo(() => {
    const rows = routes.data ?? []
    return [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  }, [routes.data])

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">TradingView Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage TradingView routes (opaque route tokens + server-side execution defaults). Route tokens are shown only once.
        </p>
      </div>

      <section className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Create route</div>
            <div className="text-xs text-muted-foreground">
              Create a route and copy the token into your TradingView alert JSON under <code>route_token</code>.
            </div>
          </div>
          <Button type="button" size="sm" onClick={() => void createMutation.mutate()} disabled={!accessToken || createMutation.isPending}>
            Create route
          </Button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Route name" />
          <select
            value={createBroker}
            onChange={(e) => setCreateBroker(e.target.value)}
            className={cn(
              'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <option value="zerodha">Zerodha</option>
            <option value="angel">Angel One</option>
          </select>
          <select
            value={createMode}
            onChange={(e) => setCreateMode(e.target.value as routesApi.QueueExecutionMode)}
            className={cn(
              'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <option value="manual_review">Manual review</option>
            <option value="auto_dispatch">Auto dispatch</option>
          </select>
          <select
            value={createProduct}
            onChange={(e) => setCreateProduct(e.target.value)}
            className={cn(
              'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <option value="">No default product</option>
            <option value="CNC">CNC (Delivery)</option>
            <option value="MIS">MIS (Intraday)</option>
            <option value="NRML">NRML (Carry forward)</option>
          </select>
          <select
            value={createOrderType}
            onChange={(e) => setCreateOrderType(e.target.value)}
            className={cn(
              'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <option value="">No default order type</option>
            <option value="MARKET">Market</option>
            <option value="LIMIT">Limit</option>
          </select>
          <select
            value={productModeDefault}
            onChange={(e) => setProductModeDefault(e.target.value as routesApi.ProductMode | '')}
            className={cn(
              'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <option value="">No product mode default</option>
            <option value="delivery">Delivery</option>
            <option value="intraday">Intraday</option>
            <option value="carry_forward">Carry forward</option>
          </select>

          <select
            value={sizingMode}
            onChange={(e) => setSizingMode(e.target.value as routesApi.TradingViewSizingMode | '')}
            className={cn(
              'h-9 rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            )}
          >
            <option value="">No sizing policy</option>
            <option value="fixed_quantity">Fixed quantity</option>
            <option value="fixed_amount">Fixed amount</option>
          </select>
          {sizingMode === 'fixed_quantity' ? (
            <Input value={fixedQty} onChange={(e) => setFixedQty(e.target.value)} placeholder="Fixed quantity" />
          ) : null}
          {sizingMode === 'fixed_amount' ? (
            <Input value={fixedAmt} onChange={(e) => setFixedAmt(e.target.value)} placeholder="Fixed amount" />
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={managedExitsEnabled} onChange={(e) => setManagedExitsEnabled(e.target.checked)} />
            Manage exits in app (default)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allowPayloadProduct} onChange={(e) => setAllowPayloadProduct(e.target.checked)} />
            Payload can override product
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allowPayloadOrderType} onChange={(e) => setAllowPayloadOrderType(e.target.checked)} />
            Payload can override order type
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allowPayloadSizing} onChange={(e) => setAllowPayloadSizing(e.target.checked)} />
            Payload can override sizing
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allowPayloadExits} onChange={(e) => setAllowPayloadExits(e.target.checked)} />
            Payload can override exits
          </label>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Routes</div>
            <div className="text-xs text-muted-foreground">
              Disabled routes reject webhooks with <code>invalid route_token</code>.
            </div>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => void routes.refetch()} disabled={!accessToken || routes.isFetching}>
            Refresh
          </Button>
        </div>

        <div className="mt-3 overflow-auto rounded-md border">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-card/95 text-[11px] font-semibold text-muted-foreground backdrop-blur">
              <tr className="border-b">
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Broker</th>
                <th className="px-3 py-2 text-left">Mode</th>
                <th className="px-3 py-2 text-left">Defaults</th>
                <th className="px-3 py-2 text-left">Policy</th>
                <th className="px-3 py-2 text-left">Created</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedRoutes.map((r) => (
                <tr key={r.id} className="border-t transition-colors hover:bg-accent/30">
                  <td className="px-3 py-2 font-medium">{r.name ?? `Route ${r.id}`}</td>
                  <td className="px-3 py-2">{r.is_enabled ? 'Enabled' : 'Disabled'}</td>
                  <td className="px-3 py-2">{r.default_broker_key ?? '—'}</td>
                  <td className="px-3 py-2">{r.default_execution_mode}</td>
                  <td className="px-3 py-2">{[r.default_product ?? '—', r.default_order_type ?? '—'].join(' / ')}</td>
                  <td className="px-3 py-2">{policySummary(r.policy)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => openEdit(r)}>
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={r.is_enabled ? 'ghost' : 'default'}
                        onClick={() => {
                          if (!accessToken) return
                          void updateMutation.mutateAsync({ id: r.id, update: { is_enabled: !r.is_enabled } })
                        }}
                        disabled={!accessToken || updateMutation.isPending}
                      >
                        {r.is_enabled ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedRoutes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {routes.isFetching ? 'Loading…' : 'No routes yet.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={tokenDialogOpen} onOpenChange={(open) => setTokenDialogOpen(open)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Route token (copy once)</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              This token is only shown now. Store it securely (password manager) and paste into your TradingView alert JSON under <code>route_token</code>.
            </p>
            <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs break-all">{createdToken ?? '—'}</div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  if (createdToken) await navigator.clipboard.writeText(createdToken)
                }}
                disabled={!createdToken}
              >
                Copy
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setTokenDialogOpen(false)
                  setCreatedToken(null)
                }}
              >
                Done
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={(open) => setEditDialogOpen(open)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit route</DialogTitle>
          </DialogHeader>
          {editRoute ? (
            <div className="space-y-4 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">Name</div>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Enabled</div>
                  <label className="mt-2 flex items-center gap-2">
                    <input type="checkbox" checked={editEnabled} onChange={(e) => setEditEnabled(e.target.checked)} />
                    {editEnabled ? 'Enabled' : 'Disabled'}
                  </label>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Default broker</div>
                  <select
                    value={editBroker}
                    onChange={(e) => setEditBroker(e.target.value)}
                    className={cn(
                      'mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    )}
                  >
                    <option value="">—</option>
                    <option value="zerodha">Zerodha</option>
                    <option value="angel">Angel One</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Execution mode</div>
                  <select
                    value={editMode}
                    onChange={(e) => setEditMode(e.target.value as routesApi.QueueExecutionMode)}
                    className={cn(
                      'mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    )}
                  >
                    <option value="manual_review">Manual review</option>
                    <option value="auto_dispatch">Auto dispatch</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Default product</div>
                  <select
                    value={editProduct}
                    onChange={(e) => setEditProduct(e.target.value)}
                    className={cn(
                      'mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    )}
                  >
                    <option value="">—</option>
                    <option value="CNC">CNC</option>
                    <option value="MIS">MIS</option>
                    <option value="NRML">NRML</option>
                  </select>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Default order type</div>
                  <select
                    value={editOrderType}
                    onChange={(e) => setEditOrderType(e.target.value)}
                    className={cn(
                      'mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    )}
                  >
                    <option value="">—</option>
                    <option value="MARKET">MARKET</option>
                    <option value="LIMIT">LIMIT</option>
                  </select>
                </div>
              </div>

              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-xs font-semibold">Policy</div>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Product mode default</div>
                    <select
                      value={String(editPolicy?.product_mode_default ?? '')}
                      onChange={(e) =>
                        setEditPolicy((p) => ({
                          ...(p ?? {}),
                          product_mode_default: e.target.value
                            ? (e.target.value as routesApi.ProductMode)
                            : null,
                        }))
                      }
                      className={cn(
                        'mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      )}
                    >
                      <option value="">—</option>
                      <option value="delivery">Delivery</option>
                      <option value="intraday">Intraday</option>
                      <option value="carry_forward">Carry forward</option>
                    </select>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Sizing mode</div>
                    <select
                      value={String(editPolicy?.sizing_mode ?? '')}
                      onChange={(e) =>
                        setEditPolicy((p) => ({
                          ...(p ?? {}),
                          sizing_mode: e.target.value
                            ? (e.target.value as routesApi.TradingViewSizingMode)
                            : null,
                        }))
                      }
                      className={cn(
                        'mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-sm outline-none shadow-sm',
                        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      )}
                    >
                      <option value="">—</option>
                      <option value="fixed_quantity">Fixed quantity</option>
                      <option value="fixed_amount">Fixed amount</option>
                    </select>
                  </div>
                  {editPolicy?.sizing_mode === 'fixed_quantity' ? (
                    <div>
                      <div className="text-xs text-muted-foreground">Fixed quantity</div>
                      <Input
                        value={String(editPolicy?.fixed_quantity ?? '')}
                        onChange={(e) =>
                          setEditPolicy((p) => ({
                            ...(p ?? {}),
                            fixed_quantity: Number(e.target.value || 0) || null,
                          }))
                        }
                        className="mt-1"
                      />
                    </div>
                  ) : null}
                  {editPolicy?.sizing_mode === 'fixed_amount' ? (
                    <div>
                      <div className="text-xs text-muted-foreground">Fixed amount</div>
                      <Input
                        value={String(editPolicy?.fixed_amount ?? '')}
                        onChange={(e) =>
                          setEditPolicy((p) => ({
                            ...(p ?? {}),
                            fixed_amount: Number(e.target.value || 0) || null,
                          }))
                        }
                        className="mt-1"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(editPolicy?.managed_exits_enabled)}
                      onChange={(e) =>
                        setEditPolicy((p) => ({
                          ...(p ?? {}),
                          managed_exits_enabled: e.target.checked,
                        }))
                      }
                    />
                    Manage exits in app (default)
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editPolicy?.allow_payload_product ?? true}
                      onChange={(e) =>
                        setEditPolicy((p) => ({
                          ...(p ?? {}),
                          allow_payload_product: e.target.checked,
                        }))
                      }
                    />
                    Payload can override product
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editPolicy?.allow_payload_order_type ?? true}
                      onChange={(e) =>
                        setEditPolicy((p) => ({
                          ...(p ?? {}),
                          allow_payload_order_type: e.target.checked,
                        }))
                      }
                    />
                    Payload can override order type
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editPolicy?.allow_payload_sizing ?? true}
                      onChange={(e) =>
                        setEditPolicy((p) => ({
                          ...(p ?? {}),
                          allow_payload_sizing: e.target.checked,
                        }))
                      }
                    />
                    Payload can override sizing
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editPolicy?.allow_payload_exits ?? true}
                      onChange={(e) =>
                        setEditPolicy((p) => ({
                          ...(p ?? {}),
                          allow_payload_exits: e.target.checked,
                        }))
                      }
                    />
                    Payload can override exits
                  </label>
                </div>

                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Advanced: view policy JSON</summary>
                  <pre className="mt-2 max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px]">
                    {JSON.stringify(editPolicy ?? {}, null, 2)}
                  </pre>
                </details>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Close
                </Button>
                <Button type="button" onClick={() => void updateFromEdit()} disabled={updateMutation.isPending}>
                  Save
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
