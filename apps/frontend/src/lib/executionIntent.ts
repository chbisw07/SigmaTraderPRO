import type { OrderProduct, OrderSide, OrderType, ProductMode } from '@/lib/api/orders'

export function productModeForProduct(product: OrderProduct): ProductMode {
  if (product === 'CNC') return 'delivery'
  if (product === 'MIS') return 'intraday'
  return 'carry_forward'
}

export function productForCashMode(mode: ProductMode): Extract<OrderProduct, 'CNC' | 'MIS'> {
  return mode === 'intraday' ? 'MIS' : 'CNC'
}

export function productForFnoMode(mode: ProductMode): Extract<OrderProduct, 'MIS' | 'NRML'> {
  return mode === 'intraday' ? 'MIS' : 'NRML'
}

export function signedPctFromPrice(side: OrderSide, reference: number, price: number): number {
  const ref = reference
  if (!Number.isFinite(ref) || ref <= 0) return 0
  if (side === 'BUY') return ((price - ref) / ref) * 100
  return ((ref - price) / ref) * 100
}

export function priceFromSignedPct(side: OrderSide, reference: number, pct: number): number {
  const ref = reference
  if (!Number.isFinite(ref) || ref <= 0) return ref
  if (side === 'BUY') return ref * (1 + pct / 100)
  return ref * (1 - pct / 100)
}

export function parseNumber(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const v = Number(trimmed)
  return Number.isFinite(v) ? v : null
}

export function roundTo(v: number, decimals = 2): number {
  const p = 10 ** decimals
  return Math.round(v * p) / p
}

export function deriveReferencePrice(
  orderType: OrderType,
  limitPrice: number | null,
  fallbackRef: number | null,
): { price: number | null; source: string | null } {
  if (orderType === 'LIMIT' && limitPrice != null) return { price: limitPrice, source: 'limit_price' }
  if (fallbackRef != null) return { price: fallbackRef, source: 'reference_price' }
  return { price: null, source: null }
}

