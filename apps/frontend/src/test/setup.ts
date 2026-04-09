import '@testing-library/jest-dom/vitest'

import { afterEach, beforeAll, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeAll(() => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.endsWith('/health')) {
      return jsonResponse({ status: 'ok' })
    }

    if (url.endsWith('/api/v1/auth/me')) {
      return jsonResponse({
        id: 1,
        email: 'dev@example.com',
        is_active: true,
        last_used_broker: null,
      })
    }

    if (url.endsWith('/api/v1/auth/login')) {
      return jsonResponse({
        token_type: 'bearer',
        access_token: 'ACCESS_TOKEN_TEST',
        refresh_token: 'REFRESH_TOKEN_TEST',
        user: {
          id: 1,
          email: 'dev@example.com',
          is_active: true,
          last_used_broker: null,
        },
      })
    }

    if (url.endsWith('/api/v1/auth/refresh')) {
      return jsonResponse({
        token_type: 'bearer',
        access_token: 'ACCESS_TOKEN_REFRESHED_TEST',
        refresh_token: 'REFRESH_TOKEN_REFRESHED_TEST',
        user: {
          id: 1,
          email: 'dev@example.com',
          is_active: true,
          last_used_broker: null,
        },
      })
    }

    if (url.endsWith('/api/v1/brokers/status')) {
      return jsonResponse([
        {
          broker: 'angel',
          configured: true,
          enabled: true,
          state: 'connected',
          connected: true,
          stale: false,
          session_day: '2026-04-09',
          last_connected_at: '2026-04-09T09:00:00Z',
          last_error: null,
        },
        {
          broker: 'zerodha',
          configured: false,
          enabled: false,
          state: 'not_configured',
          connected: false,
          stale: false,
          session_day: null,
          last_connected_at: null,
          last_error: null,
        },
      ])
    }

    if (url.endsWith('/api/v1/brokers/zerodha/login-url')) {
      return jsonResponse({ url: 'https://kite.zerodha.com/connect/login?api_key=K' })
    }

    return jsonResponse({ detail: 'Not found' }, 404)
  })
})

afterEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})
