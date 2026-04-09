import { apiRequest, getApiBaseUrl } from '@/lib/api/client'

export type HealthResponse = { status: string }

export async function health(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/health', { method: 'GET' })
}

export type ReadinessResponse = {
  status: 'ready' | 'not_ready'
  postgres: { ok: boolean; error: string | null }
  redis: { ok: boolean; error: string | null }
  schema: { ok: boolean; error: string | null }
}

// Unlike apiRequest(), readiness should return the payload even when the backend responds 503.
export async function readiness(): Promise<ReadinessResponse> {
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}/health/ready`

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })

  const data = (await response.json()) as ReadinessResponse
  return data
}
