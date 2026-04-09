export type ApiError = {
  status: number
  message: string
}

function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL
  if (!raw) return ''
  return raw.replace(/\/$/, '')
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { accessToken?: string | null } = {},
): Promise<T> {
  const { accessToken, headers, ...rest } = options
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}${path}`

  const response = await fetch(url, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(headers ?? {}),
    },
  })

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
