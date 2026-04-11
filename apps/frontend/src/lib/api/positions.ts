import { apiRequest } from '@/lib/api/client'
import type {
  BrokerKey,
  InstrumentOut,
  OrderDraftResponse,
  OrderSide,
  OrderSource,
} from '@/lib/api/orders'

export type PositionOut = {
  id: number
  opened_at: string
  updated_at: string
  broker: BrokerKey
  canonical_id: string
  instrument: InstrumentOut | null
  side: OrderSide
  quantity: number
  lots: number | null
  avg_price: number | null
  last_price: number | null
  realized_pnl: number | null
  unrealized_pnl: number | null
  mtm: number | null
  linked_orders_count: number
  source: OrderSource
}

export type PositionListResponse = { items: PositionOut[] }

export async function listPositions(
  accessToken: string,
  params: { broker?: BrokerKey; q?: string; limit?: number } = {},
): Promise<PositionListResponse> {
  const query = new URLSearchParams()
  if (params.broker) query.set('broker', params.broker)
  if (params.q) query.set('q', params.q)
  if (params.limit) query.set('limit', String(params.limit))

  return apiRequest<PositionListResponse>(`/api/v1/positions?${query.toString()}`, {
    method: 'GET',
    accessToken,
  })
}

export async function squareoffDraft(accessToken: string, positionId: number) {
  return apiRequest<OrderDraftResponse>(`/api/v1/positions/${positionId}/squareoff`, {
    method: 'POST',
    accessToken,
  })
}

export async function reverseDraft(accessToken: string, positionId: number) {
  return apiRequest<OrderDraftResponse>(`/api/v1/positions/${positionId}/reverse`, {
    method: 'POST',
    accessToken,
  })
}

export async function refreshPosition(accessToken: string, positionId: number) {
  return apiRequest<{ status: string; message: string }>(`/api/v1/positions/${positionId}/refresh`, {
    method: 'POST',
    accessToken,
  })
}
