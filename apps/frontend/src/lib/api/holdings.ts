import { apiRequest } from '@/lib/api/client'
import type { BrokerKey, InstrumentOut } from '@/lib/api/orders'

export type HoldingOut = {
  row_id: string
  broker: BrokerKey
  canonical_id: string | null
  instrument: InstrumentOut | null
  symbol_display: string | null
  exchange: string | null
  isin: string | null
  quantity: number
  t1_quantity: number | null
  average_price: number | null
  last_price: number | null
  invested_value: number | null
  current_value: number | null
  pnl: number | null
  day_change: number | null
  day_change_percentage: number | null
}

export type HoldingsMeta = { broker_errors: Record<string, string> }
export type HoldingsListResponse = { items: HoldingOut[]; meta: HoldingsMeta }

export async function listHoldings(
  accessToken: string,
  params: { broker?: BrokerKey; q?: string; limit?: number } = {},
): Promise<HoldingsListResponse> {
  const query = new URLSearchParams()
  if (params.broker) query.set('broker', params.broker)
  if (params.q) query.set('q', params.q)
  if (params.limit != null) query.set('limit', String(params.limit))

  return apiRequest<HoldingsListResponse>(`/api/v1/holdings?${query.toString()}`, {
    method: 'GET',
    accessToken,
  })
}

