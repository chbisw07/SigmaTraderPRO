import { apiRequest } from '@/lib/api/client'

export type QuoteOut = {
  canonical_id: string
  ltp: number | null
  change: number | null
  change_percent: number | null
  previous_close: number | null
  as_of: string | null
}

export type QuotesResponse = {
  broker: string
  items: QuoteOut[]
  warning: string | null
}

export async function getQuotes(
  accessToken: string,
  params: { broker?: string; canonical_ids: string[]; refresh?: boolean },
): Promise<QuotesResponse> {
  const query = new URLSearchParams()
  if (params.broker) query.set('broker', params.broker)
  if (params.refresh) query.set('refresh', 'true')
  for (const id of params.canonical_ids) query.append('canonical_ids', id)
  return apiRequest<QuotesResponse>(`/api/v1/quotes?${query.toString()}`, {
    method: 'GET',
    accessToken,
  })
}

