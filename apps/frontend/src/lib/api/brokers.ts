import { apiRequest } from '@/lib/api/client'

export type BrokerSessionState =
  | 'not_configured'
  | 'configured'
  | 'connected'
  | 'stale'
  | 'needs_reconnect'
  | 'error'

export type BrokerKey = 'angel' | 'zerodha'

export type BrokerStatus = {
  broker: BrokerKey
  configured: boolean
  enabled: boolean
  state: BrokerSessionState
  connected: boolean
  stale: boolean
  session_day: string | null
  last_connected_at: string | null
  last_error: string | null
}

export type BrokerLoginUrl = { url: string }

export async function listBrokerStatus(accessToken: string): Promise<BrokerStatus[]> {
  return apiRequest<BrokerStatus[]>('/api/v1/brokers/status', {
    method: 'GET',
    accessToken,
  })
}

export async function angelStatus(accessToken: string): Promise<BrokerStatus> {
  return apiRequest<BrokerStatus>('/api/v1/brokers/angel/status', {
    method: 'GET',
    accessToken,
  })
}

export async function angelUpsertSettings(
  accessToken: string,
  payload: { is_enabled: boolean; api_key: string; client_code: string; password: string },
): Promise<BrokerStatus> {
  return apiRequest<BrokerStatus>('/api/v1/brokers/angel/settings', {
    method: 'PUT',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function angelConnect(
  accessToken: string,
  payload: { totp: string },
): Promise<BrokerStatus> {
  return apiRequest<BrokerStatus>('/api/v1/brokers/angel/connect', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function angelDisconnect(accessToken: string): Promise<BrokerStatus> {
  return apiRequest<BrokerStatus>('/api/v1/brokers/angel/disconnect', {
    method: 'POST',
    accessToken,
  })
}

export async function zerodhaStatus(accessToken: string): Promise<BrokerStatus> {
  return apiRequest<BrokerStatus>('/api/v1/brokers/zerodha/status', {
    method: 'GET',
    accessToken,
  })
}

export async function zerodhaUpsertSettings(
  accessToken: string,
  payload: { is_enabled: boolean; api_key: string; api_secret: string },
): Promise<BrokerStatus> {
  return apiRequest<BrokerStatus>('/api/v1/brokers/zerodha/settings', {
    method: 'PUT',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function zerodhaConnect(
  accessToken: string,
  payload: { request_token: string },
): Promise<BrokerStatus> {
  return apiRequest<BrokerStatus>('/api/v1/brokers/zerodha/connect', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function zerodhaDisconnect(accessToken: string): Promise<BrokerStatus> {
  return apiRequest<BrokerStatus>('/api/v1/brokers/zerodha/disconnect', {
    method: 'POST',
    accessToken,
  })
}

export async function zerodhaLoginUrl(accessToken: string): Promise<BrokerLoginUrl> {
  return apiRequest<BrokerLoginUrl>('/api/v1/brokers/zerodha/login-url', {
    method: 'GET',
    accessToken,
  })
}

