export type ApiError = {
  status: number
  message: string
}

const AUTH_STORAGE_KEY = 'sigmatraderpro.auth'

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL
  if (!raw) return ''
  return raw.replace(/\/$/, '')
}

type PersistedAuthState = {
  accessToken: string | null
  refreshToken: string | null
  user: unknown | null
}

type PersistedAuthStorageValue = {
  state?: PersistedAuthState
  version?: number
}

type TokenPairResponse = {
  access_token: string
  refresh_token: string
  user: unknown
}

function readPersistedRefreshToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedAuthStorageValue
    const token = parsed?.state?.refreshToken
    return typeof token === 'string' && token ? token : null
  } catch {
    return null
  }
}

function readPersistedAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedAuthStorageValue
    const token = parsed?.state?.accessToken
    return typeof token === 'string' && token ? token : null
  } catch {
    return null
  }
}

function writePersistedTokens(tokens: TokenPairResponse) {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
    const parsed = (raw ? (JSON.parse(raw) as PersistedAuthStorageValue) : {}) as PersistedAuthStorageValue
    const next: PersistedAuthStorageValue = {
      ...parsed,
      state: {
        ...(parsed.state ?? { accessToken: null, refreshToken: null, user: null }),
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        user: tokens.user ?? null,
      },
      version: parsed.version ?? 1,
    }
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

let accessTokenOverride: string | null = null
let refreshInFlight: Promise<string | null> | null = null

async function refreshAccessToken(baseUrl: string): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const refreshToken = readPersistedRefreshToken()
    if (!refreshToken) return null

    const resp = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    })

    if (!resp.ok) return null
    const tokens = (await resp.json()) as TokenPairResponse
    if (!tokens?.access_token) return null
    accessTokenOverride = tokens.access_token
    writePersistedTokens(tokens)
    return tokens.access_token
  })()

  try {
    return await refreshInFlight
  } finally {
    refreshInFlight = null
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { accessToken?: string | null } = {},
): Promise<T> {
  const { accessToken, headers, ...rest } = options
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}${path}`

  if (accessToken && accessTokenOverride && accessToken !== accessTokenOverride) {
    // If we have a newer token (refreshed mid-session), keep using it even if
    // call sites still pass an expired token from in-memory state.
    // If call sites pass a *different* token (e.g. after re-login), replace the
    // override to avoid pinning to stale auth.
    const persistedAccessToken = readPersistedAccessToken()
    if (persistedAccessToken === accessToken) accessTokenOverride = accessToken
  }

  const effectiveAccessToken = accessToken ? (accessTokenOverride ?? accessToken) : null

  const doFetch = async (token: string | null) => {
    return fetch(url, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(headers ?? {}),
      },
    })
  }

  let response = await doFetch(effectiveAccessToken)
  if (response.status === 401 && accessToken) {
    const next = await refreshAccessToken(baseUrl)
    if (next) {
      response = await doFetch(next)
    }
  }

  if (!response.ok) {
    let message = response.statusText
    try {
      const data = (await response.json()) as { detail?: string }
      if (data?.detail) message = data.detail
    } catch {
      // ignore
    }
    throw { status: response.status, message } satisfies ApiError
  }

  return (await response.json()) as T
}
