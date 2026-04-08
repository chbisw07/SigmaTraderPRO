import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ThemePreference =
  | 'system'
  | 'light'
  | 'light-soft'
  | 'dark'
  | 'dark-trading'

type AppearanceState = {
  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'sigmatraderpro.appearance',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
)

