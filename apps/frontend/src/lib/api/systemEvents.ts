import { apiRequest } from '@/lib/api/client'

export type SystemEvent = {
  id: number
  created_at: string
  level: string
  category: string
  message: string
  correlation_id: string | null
  broker: string | null
  symbol: string | null
  metadata: Record<string, unknown> | null
}

export type SystemEventsListResponse = { items: SystemEvent[] }
export type SystemEventsCleanupResponse = { status: 'ok'; deleted: number }

export async function listSystemEvents(
  accessToken: string,
  params: {
    q?: string
    category?: string
    level?: string
    limit?: number
  } = {},
): Promise<SystemEventsListResponse> {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.category) query.set('category', params.category)
  if (params.level) query.set('level', params.level)
  if (params.limit != null) query.set('limit', String(params.limit))

  return apiRequest<SystemEventsListResponse>(`/api/v1/system-events?${query.toString()}`, {
    method: 'GET',
    accessToken,
  })
}

export async function cleanupSystemEvents(
  accessToken: string,
  keepDays: number,
): Promise<SystemEventsCleanupResponse> {
  const query = new URLSearchParams()
  query.set('keep_days', String(keepDays))
  return apiRequest<SystemEventsCleanupResponse>(`/api/v1/system-events/cleanup?${query.toString()}`, {
    method: 'POST',
    accessToken,
  })
}

