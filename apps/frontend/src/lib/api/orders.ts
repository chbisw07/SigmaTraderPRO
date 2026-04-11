import { apiRequest } from '@/lib/api/client'
import type { InstrumentOut } from '@/lib/api/instruments'

export type BrokerKey = 'angel' | 'zerodha'
export type OrderSide = 'BUY' | 'SELL'
export type OrderProduct = 'CNC' | 'MIS' | 'NRML'
export type OrderType = 'MARKET' | 'LIMIT'

export type OrderSource = 'manual_ui' | 'tv_webhook'
export type OrderIntentType = 'ENTRY' | 'EXIT' | 'SL' | 'TARGET' | 'TRAIL'
export type OrderTriggerMode = 'MARKET' | 'LIMIT' | 'SL' | 'SLM'
export type RiskMode = 'ABSOLUTE' | 'POINTS' | 'PERCENT'

export type OrderIntentMetadata = {
  source?: OrderSource
  intent_type?: OrderIntentType
  trigger_mode?: OrderTriggerMode | null
  risk_mode?: RiskMode | null
  sl_value?: number | null
  tp_value?: number | null
  trailing_value?: number | null
  parent_order_id?: number | null
  linked_position_id?: number | null
  broker_context?: string | null
}

export type StockOrderBase = {
  broker: BrokerKey
  canonical_id: string
  side: OrderSide
  quantity: number
  product: OrderProduct
  order_type: OrderType
  limit_price?: number | null
} & OrderIntentMetadata

export type DerivativeInstrumentType = 'OPTION' | 'FUTURE'

export type FnoOrderBase = {
  broker: BrokerKey
  instrument_type: DerivativeInstrumentType
  underlying: string
  expiry: string
  strike?: number | null
  option_type?: 'CE' | 'PE' | null
  side: OrderSide
  lots: number
  product: 'MIS' | 'NRML'
  order_type: OrderType
  limit_price?: number | null
} & OrderIntentMetadata

export type { InstrumentOut }

export type StockOrderPreviewResponse = {
  instrument: InstrumentOut
  routing: {
    broker: BrokerKey
    exchange: string
    trading_symbol: string
  }
  side: OrderSide
  quantity: number
  product: OrderProduct
  order_type: OrderType
  limit_price: number | null
  warnings: string[]
}

export type StockOrderCreateResponse = {
  order_id: number
  status: string
  broker_order_id: string | null
  preview: StockOrderPreviewResponse
}

export type FnoOrderPreviewResponse = {
  instrument: InstrumentOut
  routing: {
    broker: BrokerKey
    exchange: string
    trading_symbol: string
  }
  side: OrderSide
  lots: number
  quantity: number
  product: 'MIS' | 'NRML'
  order_type: OrderType
  limit_price: number | null
  warnings: string[]
}

export type FnoOrderCreateResponse = {
  order_id: number
  status: string
  broker_order_id: string | null
  preview: FnoOrderPreviewResponse
}

export type OrderOut = {
  id: number
  created_at: string
  updated_at: string
  broker: BrokerKey
  canonical_id: string
  instrument: InstrumentOut | null
  side: OrderSide
  quantity: number
  lots: number | null
  product: OrderProduct
  order_type: OrderType
  placed_price: number | null
  avg_executed_price: number | null
  status: string | null
  broker_order_id: string | null
  rejection_reason: string | null
  source: OrderSource
  intent_type: OrderIntentType
  trigger_mode: OrderTriggerMode
  linked_position_id: number | null
}

export type OrderListResponse = { items: OrderOut[] }
export type OrderDetailResponse = {
  order: OrderOut
  preview_snapshot_json: Record<string, unknown> | null
  broker_payload_json: Record<string, unknown> | null
}

export type OrderDraft = {
  mode: 'contract'
  instrument: InstrumentOut
  broker: BrokerKey
  side: OrderSide
  quantity: number | null
  lots: number | null
  product: OrderProduct
  order_type: OrderType
  limit_price: number | null
  reference_price: number | null
  intent: Required<OrderIntentMetadata>
}

export type OrderDraftResponse = { draft: OrderDraft }

export type OrdersSourceMode = 'merged' | 'internal_only' | 'broker_only'
export type OrdersSourceOrigin = 'sigmatrader' | 'broker_external' | 'merged'
export type OrdersReconciliationState = 'internal_only' | 'broker_only' | 'matched' | 'unresolved'

export type OrdersWorkspaceRow = {
  row_id: string
  source_origin: OrdersSourceOrigin
  reconciliation_state: OrdersReconciliationState
  broker: BrokerKey
  internal_order_id: number | null
  broker_order_id: string | null
  exchange_order_id: string | null
  canonical_id: string | null
  instrument: InstrumentOut | null
  symbol_display: string | null
  side: OrderSide | null
  product: OrderProduct | null
  quantity: number | null
  lots: number | null
  order_type: OrderType | null
  placed_price: number | null
  avg_price: number | null
  status: string | null
  rejection_reason: string | null
  placed_at: string | null
  source: OrderSource | null
  intent_type: OrderIntentType | null
  linked_position_id: number | null
}

export type OrdersWorkspaceResponse = {
  items: OrdersWorkspaceRow[]
  meta: {
    include_broker_orders: boolean
    mode: OrdersSourceMode
    broker_errors: Record<string, string>
  }
}

export async function previewStockOrder(
  accessToken: string,
  payload: StockOrderBase,
): Promise<StockOrderPreviewResponse> {
  return apiRequest<StockOrderPreviewResponse>('/api/v1/orders/preview', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function createStockOrder(
  accessToken: string,
  payload: StockOrderBase,
): Promise<StockOrderCreateResponse> {
  return apiRequest<StockOrderCreateResponse>('/api/v1/orders', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function previewFnoOrder(
  accessToken: string,
  payload: FnoOrderBase,
): Promise<FnoOrderPreviewResponse> {
  return apiRequest<FnoOrderPreviewResponse>('/api/v1/orders/fno/preview', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function createFnoOrder(
  accessToken: string,
  payload: FnoOrderBase,
): Promise<FnoOrderCreateResponse> {
  return apiRequest<FnoOrderCreateResponse>('/api/v1/orders/fno', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function listOrders(
  accessToken: string,
  params: {
    broker?: BrokerKey
    status?: string
    instrument_type?: string
    q?: string
    limit?: number
  } = {},
): Promise<OrderListResponse> {
  const query = new URLSearchParams()
  if (params.broker) query.set('broker', params.broker)
  if (params.status) query.set('status', params.status)
  if (params.instrument_type) query.set('instrument_type', params.instrument_type)
  if (params.q) query.set('q', params.q)
  if (params.limit) query.set('limit', String(params.limit))

  return apiRequest<OrderListResponse>(`/api/v1/orders?${query.toString()}`, {
    method: 'GET',
    accessToken,
  })
}

export async function listOrdersWorkspace(
  accessToken: string,
  params: {
    mode?: OrdersSourceMode
    broker?: BrokerKey
    status?: string
    instrument_type?: string
    q?: string
    limit?: number
  } = {},
): Promise<OrdersWorkspaceResponse> {
  const query = new URLSearchParams()
  query.set('mode', params.mode ?? 'merged')
  if (params.broker) query.set('broker', params.broker)
  if (params.status) query.set('status', params.status)
  if (params.instrument_type) query.set('instrument_type', params.instrument_type)
  if (params.q) query.set('q', params.q)
  if (params.limit) query.set('limit', String(params.limit))

  return apiRequest<OrdersWorkspaceResponse>(`/api/v1/orders/workspace?${query.toString()}`, {
    method: 'GET',
    accessToken,
  })
}

export async function getOrder(
  accessToken: string,
  orderId: number,
): Promise<OrderDetailResponse> {
  return apiRequest<OrderDetailResponse>(`/api/v1/orders/${orderId}`, {
    method: 'GET',
    accessToken,
  })
}

export async function repeatOrder(
  accessToken: string,
  orderId: number,
): Promise<OrderDraftResponse> {
  return apiRequest<OrderDraftResponse>('/api/v1/orders/repeat', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ order_id: orderId }),
  })
}

export async function reverseOrder(
  accessToken: string,
  orderId: number,
): Promise<OrderDraftResponse> {
  return apiRequest<OrderDraftResponse>('/api/v1/orders/reverse', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ order_id: orderId }),
  })
}

export async function reconcileOrders(accessToken: string): Promise<{ status: string; message: string }> {
  return apiRequest<{ status: string; message: string }>('/api/v1/orders/reconcile', {
    method: 'POST',
    accessToken,
  })
}
