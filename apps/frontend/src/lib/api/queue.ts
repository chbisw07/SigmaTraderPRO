import { apiRequest } from '@/lib/api/client'
import type { BrokerKey, ExecutionIntent, OrderSide, OrderType, OrderProduct } from '@/lib/api/orders'
import type { InstrumentOut } from '@/lib/api/instruments'

export type QueueSourceType = 'manual_ui' | 'tradingview' | 'alert' | 'system' | 'ai'
export type QueueExecutionMode = 'manual_review' | 'auto_dispatch'
export type QueueStatus =
  | 'queued'
  | 'ready'
  | 'blocked'
  | 'approved'
  | 'dispatched'
  | 'cancelled'
  | 'failed'
  | 'expired'
export type QueueValidationState = 'valid' | 'warning' | 'blocked'
export type QueueResolutionState = 'resolved' | 'unresolved'

export type QueueItemOut = {
  id: number
  created_at: string
  updated_at: string

  source_type: QueueSourceType
  source_ref: string | null

  correlation_id: string
  idempotency_key: string

  broker: BrokerKey | string
  canonical_id: string
  instrument: InstrumentOut | null

  side: OrderSide | null
  quantity: number | null
  lots: number | null
  product: OrderProduct | string
  order_type: OrderType | string
  limit_price: number | null
  managed_exits: boolean

  execution_mode: QueueExecutionMode
  status: QueueStatus
  validation_state: QueueValidationState
  block_reason_code: string | null
  block_reason_message: string | null
  resolution_state?: QueueResolutionState
  resolution?: Record<string, unknown>

  source_route_id?: number | null
  strategy_id?: string | null
  strategy_name?: string | null
  strategy_params_json?: Record<string, unknown> | null
  signal_price?: number | null
  timeframe?: string | null
  signal_timestamp?: string | null

  dispatched_order_id: number | null
  notes: string | null
  expires_at: string | null

  execution_intent: ExecutionIntent | Record<string, unknown>
}

export type QueueListResponse = {
  items: QueueItemOut[]
  meta: Record<string, unknown>
}

export type QueueCreateRequest = {
  source_type?: QueueSourceType
  source_ref?: string | null
  correlation_id?: string | null
  idempotency_key?: string | null
  execution_mode?: QueueExecutionMode
  execution_intent: ExecutionIntent
  notes?: string | null
  expires_at?: string | null
}

export type QueueUpdateRequest = {
  execution_mode?: QueueExecutionMode | null
  execution_intent?: ExecutionIntent | null
  notes?: string | null
  expires_at?: string | null
}

export async function listQueue(
  accessToken: string,
  params: { status?: string; resolution_state?: string; source_type?: string; broker?: string; q?: string; limit?: number },
) {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.resolution_state) query.set('resolution_state', params.resolution_state)
  if (params.source_type) query.set('source_type', params.source_type)
  if (params.broker) query.set('broker', params.broker)
  if (params.q) query.set('q', params.q)
  if (params.limit) query.set('limit', String(params.limit))
  return apiRequest<QueueListResponse>(`/api/v1/queue?${query.toString()}`, { method: 'GET', accessToken })
}

export async function createQueueItem(accessToken: string, payload: QueueCreateRequest) {
  return apiRequest<QueueItemOut>('/api/v1/queue', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function updateQueueItem(accessToken: string, itemId: number, payload: QueueUpdateRequest) {
  return apiRequest<QueueItemOut>(`/api/v1/queue/${itemId}`, {
    method: 'PATCH',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function executeQueueItem(accessToken: string, itemId: number) {
  return apiRequest<QueueItemOut>(`/api/v1/queue/${itemId}/execute`, {
    method: 'POST',
    accessToken,
  })
}

export async function cancelQueueItem(accessToken: string, itemId: number) {
  return apiRequest<QueueItemOut>(`/api/v1/queue/${itemId}/cancel`, {
    method: 'POST',
    accessToken,
  })
}

export async function resolveQueueItem(
  accessToken: string,
  itemId: number,
  payload: {
    broker?: string | null
    canonical_id?: string | null
    product?: string | null
    order_type?: string | null
    quantity?: number | null
    limit_price?: number | null
    instrument_hint?: Record<string, unknown> | null
  },
) {
  return apiRequest<QueueItemOut>(`/api/v1/queue/${itemId}/resolve`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}
