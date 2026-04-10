import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

type QuoteState = {
  premiumsByCanonicalId: Record<string, number>
  spotsByUnderlying: Record<string, number>

  setPremium: (canonicalId: string, premium: number) => void
  getPremium: (canonicalId: string) => number | null
  setSpot: (underlying: string, spot: number) => void
  getSpot: (underlying: string) => number | null
}

export const useQuoteStore = create<QuoteState>()(
  persist(
    (set, get) => ({
      premiumsByCanonicalId: {},
      spotsByUnderlying: {},

      setPremium: (canonicalId, premium) => {
        const key = canonicalId.trim()
        if (!key) return
        if (!Number.isFinite(premium) || premium <= 0) return
        set((s) => ({
          premiumsByCanonicalId: { ...s.premiumsByCanonicalId, [key]: premium },
        }))
      },
      getPremium: (canonicalId) => {
        const key = canonicalId.trim()
        if (!key) return null
        const v = get().premiumsByCanonicalId[key]
        return typeof v === 'number' && Number.isFinite(v) ? v : null
      },

      setSpot: (underlying, spot) => {
        const key = underlying.trim().toUpperCase()
        if (!key) return
        if (!Number.isFinite(spot) || spot <= 0) return
        set((s) => ({
          spotsByUnderlying: { ...s.spotsByUnderlying, [key]: spot },
        }))
      },
      getSpot: (underlying) => {
        const key = underlying.trim().toUpperCase()
        if (!key) return null
        const v = get().spotsByUnderlying[key]
        return typeof v === 'number' && Number.isFinite(v) ? v : null
      },
    }),
    {
      name: 'sigmatraderpro.quotes',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({
        premiumsByCanonicalId: s.premiumsByCanonicalId,
        spotsByUnderlying: s.spotsByUnderlying,
      }),
    },
  ),
)

