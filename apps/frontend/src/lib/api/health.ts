import { apiRequest } from '@/lib/api/client'

export type HealthResponse = { status: string }

export async function health(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>('/health', { method: 'GET' })
}

