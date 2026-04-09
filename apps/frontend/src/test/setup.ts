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

    return jsonResponse({ detail: 'Not found' }, 404)
  })
})

afterEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})
