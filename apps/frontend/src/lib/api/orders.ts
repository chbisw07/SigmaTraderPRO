import { apiRequest } from '@/lib/api/client'

export type BrokerKey = 'angel' | 'zerodha'
export type OrderSide = 'BUY' | 'SELL'
export type OrderProduct = 'CNC' | 'MIS'
export type OrderType = 'MARKET' | 'LIMIT'

export type StockOrderBase = {
  broker: BrokerKey
  canonical_id: string
  side: OrderSide
  quantity: number
  product: OrderProduct
  order_type: OrderType
  limit_price?: number | null
}

export type InstrumentOut = {
  canonical_id: string
  exchange: string
  segment: string
  instrument_type: string
  symbol_root: string
  display_symbol: string
  underlying: string | null
  expiry: string | null
  strike: number | null
  option_type: string | null
  lot_size: number | null
  tick_size: number | null
  isin: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

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

