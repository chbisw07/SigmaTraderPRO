import { create } from 'zustand'
import type { PersistStorage, StorageValue } from 'zustand/middleware'
import { createJSONStorage, persist } from 'zustand/middleware'

import * as authApi from '@/lib/api/auth'

export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated'

const AUTH_STORAGE_KEY = 'sigmatraderpro.auth'

function clearPersistedAuthState() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // ignore
  }
  try {
    window.sessionStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // ignore
  }
}

type AuthState = {
  revision: number
  status: AuthStatus
  accessToken: string | null
  refreshToken: string | null
  user: authApi.UserOut | null
  isRefreshing: boolean
  error: string | null

  bootstrap: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

type PersistedAuthState = Pick<AuthState, 'accessToken' | 'refreshToken' | 'user'>

function createAuthStorage(): PersistStorage<PersistedAuthState> {
  const base = createJSONStorage<PersistedAuthState>(() => localStorage)!
  return {
    getItem: base.getItem,
    removeItem: base.removeItem,
    setItem: (name: string, value: StorageValue<PersistedAuthState>) => {
      const { accessToken, refreshToken } = value.state
      if (!accessToken && !refreshToken) {
        try {
          localStorage.removeItem(name)
        } catch {
          // ignore
        }
        return
      }
      base.setItem(name, value)
    },
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      revision: 0,
      status: 'unknown',
      accessToken: null,
      refreshToken: null,
      user: null,
      isRefreshing: false,
      error: null,

      bootstrap: async () => {
        const startRevision = get().revision
        const { accessToken, refreshToken } = get()
        if (!accessToken && !refreshToken) {
          set({ status: 'unauthenticated', user: null, error: null })
          return
        }

        if (accessToken) {
          try {
            const user = await authApi.me(accessToken)
            if (get().revision !== startRevision) return
            set({ status: 'authenticated', user, error: null })
            return
          } catch {
            // fall through to refresh
          }
        }

        if (!refreshToken) {
          set({ status: 'unauthenticated', user: null, accessToken: null, error: null })
          return
        }

        set({ isRefreshing: true })
        try {
          const tokens = await authApi.refresh(refreshToken)
          if (get().revision !== startRevision) return
          set({
            status: 'authenticated',
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            user: tokens.user,
            isRefreshing: false,
            error: null,
          })
        } catch {
          if (get().revision !== startRevision) return
          set({
            status: 'unauthenticated',
            accessToken: null,
            refreshToken: null,
            user: null,
            isRefreshing: false,
            error: null,
          })
        }
      },

      login: async (email: string, password: string) => {
        const nextRevision = get().revision + 1
        set({ error: null, revision: nextRevision })
        const tokens = await authApi.login(email, password)
        if (get().revision !== nextRevision) return
        set({
          status: 'authenticated',
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          user: tokens.user,
          error: null,
        })
      },

      logout: () => {
        const nextRevision = get().revision + 1
        clearPersistedAuthState()
        set({
          status: 'unauthenticated',
          accessToken: null,
          refreshToken: null,
          user: null,
          error: null,
          isRefreshing: false,
          revision: nextRevision,
        })
      },
    }),
    {
      name: 'sigmatraderpro.auth',
      storage: createAuthStorage(),
      version: 1,
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    },
  ),
)
