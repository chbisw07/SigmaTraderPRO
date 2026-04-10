import { apiRequest } from '@/lib/api/client'

export type Exchange = 'NSE_EQ' | 'BSE_EQ' | 'NSE_FNO' | 'BSE_FNO' | 'MCX_FNO'
export type Segment =
  | 'EQUITY'
  | 'FUTURE'
  | 'OPTION'
  | 'INDEX'
  | 'CURRENCY'
  | 'COMMODITY'
export type InstrumentType = 'EQUITY' | 'ETF' | 'FUTURE' | 'OPTION' | 'INDEX'
export type OptionType = 'CE' | 'PE'

export type InstrumentOut = {
  canonical_id: string
  exchange: Exchange
  segment: Segment
  instrument_type: InstrumentType
  symbol_root: string
  display_symbol: string
  underlying: string | null
  expiry: string | null
  strike: number | null
  option_type: OptionType | null
  lot_size: number | null
  tick_size: number | null
  isin: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type InstrumentSearchResponse = {
  items: InstrumentOut[]
}

export type DerivativeExpiriesResponse = {
  underlying: string
  exchange: Exchange
  instrument_type: InstrumentType
  expiries: string[]
}

export type DerivativeStrikesResponse = {
  underlying: string
  exchange: Exchange
  expiry: string
  option_type: OptionType | null
  strikes: number[]
}

export type InstrumentSyncRequest = {
  scope: 'equity' | 'fno_underlyings'
  underlyings?: string[]
  max_rows?: number
}

export type InstrumentSyncResponse = {
  source: string
  scope: string
  processed: number
  ingested: number
  skipped: number
}

export async function searchInstruments(
  accessToken: string,
  params: {
    q: string
    limit?: number
    exchange?: Exchange
    segment?: Segment
    instrument_type?: InstrumentType
    option_type?: OptionType
  },
): Promise<InstrumentSearchResponse> {
  const query = new URLSearchParams()
  query.set('q', params.q)
  if (params.limit) query.set('limit', String(params.limit))
  if (params.exchange) query.set('exchange', params.exchange)
  if (params.segment) query.set('segment', params.segment)
  if (params.instrument_type) query.set('instrument_type', params.instrument_type)
  if (params.option_type) query.set('option_type', params.option_type)

  return apiRequest<InstrumentSearchResponse>(`/api/v1/instruments/search?${query.toString()}`, {
    method: 'GET',
    accessToken,
  })
}

export async function getInstrument(
  accessToken: string,
  canonicalId: string,
): Promise<InstrumentOut> {
  return apiRequest<InstrumentOut>(`/api/v1/instruments/${encodeURIComponent(canonicalId)}`, {
    method: 'GET',
    accessToken,
  })
}

export async function derivativeExpiries(
  accessToken: string,
  params: {
    underlying: string
    exchange?: Exchange
    instrument_type?: InstrumentType
    limit?: number
  },
): Promise<DerivativeExpiriesResponse> {
  const query = new URLSearchParams()
  query.set('underlying', params.underlying)
  if (params.exchange) query.set('exchange', params.exchange)
  if (params.instrument_type) query.set('instrument_type', params.instrument_type)
  if (params.limit) query.set('limit', String(params.limit))

  return apiRequest<DerivativeExpiriesResponse>(`/api/v1/instruments/derivatives/expiries?${query.toString()}`, {
    method: 'GET',
    accessToken,
  })
}

export async function derivativeStrikes(
  accessToken: string,
  params: {
    underlying: string
    expiry: string
    exchange?: Exchange
    option_type?: OptionType
    limit?: number
  },
): Promise<DerivativeStrikesResponse> {
  const query = new URLSearchParams()
  query.set('underlying', params.underlying)
  query.set('expiry', params.expiry)
  if (params.exchange) query.set('exchange', params.exchange)
  if (params.option_type) query.set('option_type', params.option_type)
  if (params.limit) query.set('limit', String(params.limit))

  return apiRequest<DerivativeStrikesResponse>(`/api/v1/instruments/derivatives/strikes?${query.toString()}`, {
    method: 'GET',
    accessToken,
  })
}

export async function derivativeOptions(
  accessToken: string,
  params: {
    underlying: string
    expiry: string
    exchange?: Exchange
    option_type?: OptionType
    limit?: number
  },
): Promise<InstrumentSearchResponse> {
  const query = new URLSearchParams()
  query.set('underlying', params.underlying)
  query.set('expiry', params.expiry)
  if (params.exchange) query.set('exchange', params.exchange)
  if (params.option_type) query.set('option_type', params.option_type)
  if (params.limit) query.set('limit', String(params.limit))

  return apiRequest<InstrumentSearchResponse>(`/api/v1/instruments/derivatives/options?${query.toString()}`, {
    method: 'GET',
    accessToken,
  })
}

export async function syncAngelMaster(
  accessToken: string,
  payload: InstrumentSyncRequest,
): Promise<InstrumentSyncResponse> {
  return apiRequest<InstrumentSyncResponse>('/api/v1/instruments/sync/angel-master', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export type ZerodhaNfoSyncRequest = {
  underlyings?: string[]
  max_rows?: number
}

export async function syncZerodhaNfo(
  accessToken: string,
  payload: ZerodhaNfoSyncRequest,
): Promise<InstrumentSyncResponse> {
  return apiRequest<InstrumentSyncResponse>('/api/v1/instruments/sync/zerodha-nfo', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}
