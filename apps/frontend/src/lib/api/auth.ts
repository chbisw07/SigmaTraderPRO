import { apiRequest } from '@/lib/api/client'

export type UserOut = {
  id: number
  email: string
  is_active: boolean
  last_used_broker: string | null
}

export type TokenPairResponse = {
  token_type: 'bearer'
  access_token: string
  refresh_token: string
  user: UserOut
}

export async function login(email: string, password: string): Promise<TokenPairResponse> {
  return apiRequest<TokenPairResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function refresh(refreshToken: string): Promise<TokenPairResponse> {
  return apiRequest<TokenPairResponse>('/api/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
}

export async function me(accessToken: string): Promise<UserOut> {
  return apiRequest<UserOut>('/api/v1/auth/me', {
    method: 'GET',
    accessToken,
  })
}

