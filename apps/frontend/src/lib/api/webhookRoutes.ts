import { apiRequest } from '@/lib/api/client'
import type { BrokerKey, OrderProduct, OrderType } from '@/lib/api/orders'

export type QueueExecutionMode = 'manual_review' | 'auto_dispatch'

export type ProductMode = 'delivery' | 'intraday' | 'carry_forward'

export type TradingViewSizingMode = 'fixed_quantity' | 'fixed_amount' | 'portfolio_percent'

export type PriceAndPct = { price?: number | null; pct?: number | null }

export type TradingViewRoutePolicy = {
  product_mode_default?: ProductMode | null
  sizing_mode?: TradingViewSizingMode | null
  fixed_quantity?: number | null
  fixed_amount?: number | null

  managed_exits_enabled?: boolean | null
  default_stop_loss?: PriceAndPct | null
  default_target?: PriceAndPct | null
  default_trailing_sl?: PriceAndPct | null

  allow_payload_product?: boolean
  allow_payload_order_type?: boolean
  allow_payload_sizing?: boolean
  allow_payload_exits?: boolean
}

export type WebhookRouteOut = {
  id: number
  user_id: number
  source: string
  name: string | null
  default_broker_key: BrokerKey | string | null
  default_execution_mode: QueueExecutionMode
  default_product: OrderProduct | string | null
  default_order_type: OrderType | string | null
  policy?: TradingViewRoutePolicy | null
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export type WebhookRouteCreateRequest = {
  name?: string | null
  default_broker_key?: string | null
  default_execution_mode?: QueueExecutionMode
  default_product?: OrderProduct | null
  default_order_type?: OrderType | null
  policy?: TradingViewRoutePolicy | null
}

export type WebhookRouteCreateResponse = {
  route: WebhookRouteOut
  route_token: string
}

export type WebhookRouteUpdateRequest = {
  name?: string | null
  default_broker_key?: string | null
  default_execution_mode?: QueueExecutionMode | null
  default_product?: OrderProduct | null
  default_order_type?: OrderType | null
  policy?: TradingViewRoutePolicy | null
  is_enabled?: boolean | null
}

export async function listTradingViewRoutes(accessToken: string) {
  return apiRequest<WebhookRouteOut[]>('/api/v1/webhook-routes/tradingview', {
    method: 'GET',
    accessToken,
  })
}

export async function createTradingViewRoute(accessToken: string, payload: WebhookRouteCreateRequest) {
  return apiRequest<WebhookRouteCreateResponse>('/api/v1/webhook-routes/tradingview', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function updateTradingViewRoute(accessToken: string, routeId: number, payload: WebhookRouteUpdateRequest) {
  return apiRequest<WebhookRouteOut>(`/api/v1/webhook-routes/tradingview/${routeId}`, {
    method: 'PATCH',
    accessToken,
    body: JSON.stringify(payload),
  })
}

