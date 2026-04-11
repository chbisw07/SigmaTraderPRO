import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type WatchlistWidthMode = 'compact' | 'standard' | 'wide'

type WidthSpec = {
  preset: number
  min: number
  max: number
}

export const WATCHLIST_WIDTH_SPECS: Record<WatchlistWidthMode, WidthSpec> = {
  // Note: final max is further capped in the shell to 30% of viewport width.
  compact: { preset: 280, min: 260, max: 520 },
  standard: { preset: 340, min: 320, max: 720 },
  wide: { preset: 460, min: 400, max: 960 },
}

export function clampWidth(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

type WatchlistLayoutState = {
  mode: WatchlistWidthMode
  widthByMode: Partial<Record<WatchlistWidthMode, number>>

  setMode: (mode: WatchlistWidthMode) => void
  setWidth: (mode: WatchlistWidthMode, widthPx: number) => void
  resetWidth: (mode: WatchlistWidthMode) => void

  getWidth: () => { widthPx: number; minPx: number; maxPx: number }
}

export const useWatchlistLayoutStore = create<WatchlistLayoutState>()(
  persist(
    (set, get) => ({
      mode: 'standard',
      widthByMode: {},

      setMode: (mode) => set({ mode }),

      setWidth: (mode, widthPx) => {
        const spec = WATCHLIST_WIDTH_SPECS[mode]
        const clamped = clampWidth(widthPx, spec.min, spec.max)
        set((state) => ({
          widthByMode: { ...state.widthByMode, [mode]: clamped },
        }))
      },

      resetWidth: (mode) => {
        set((state) => {
          const next = { ...state.widthByMode }
          delete next[mode]
          return { widthByMode: next }
        })
      },

      getWidth: () => {
        const { mode, widthByMode } = get()
        const spec = WATCHLIST_WIDTH_SPECS[mode]
        const raw = widthByMode[mode] ?? spec.preset
        const widthPx = clampWidth(raw, spec.min, spec.max)
        return { widthPx, minPx: spec.min, maxPx: spec.max }
      },
    }),
    {
      name: 'sigmatraderpro.watchlist.layout',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mode: state.mode,
        widthByMode: state.widthByMode,
      }),
    },
  ),
)
