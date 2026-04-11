import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type WatchlistTypeFilter = 'all' | 'equity' | 'index' | 'derivatives'
export type WatchlistExchangeFilter = 'all' | 'nse' | 'bse'
export type WatchlistSort = 'manual' | 'alpha'

type WatchlistViewState = {
  filterType: WatchlistTypeFilter
  filterExchange: WatchlistExchangeFilter
  sort: WatchlistSort

  setFilterType: (v: WatchlistTypeFilter) => void
  setFilterExchange: (v: WatchlistExchangeFilter) => void
  setSort: (v: WatchlistSort) => void
  reset: () => void
}

export const useWatchlistViewStore = create<WatchlistViewState>()(
  persist(
    (set) => ({
      filterType: 'all',
      filterExchange: 'all',
      sort: 'manual',

      setFilterType: (v) => set({ filterType: v }),
      setFilterExchange: (v) => set({ filterExchange: v }),
      setSort: (v) => set({ sort: v }),
      reset: () =>
        set({
          filterType: 'all',
          filterExchange: 'all',
          sort: 'manual',
        }),
    }),
    {
      name: 'sigmatraderpro.watchlist.view',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        filterType: s.filterType,
        filterExchange: s.filterExchange,
        sort: s.sort,
      }),
    },
  ),
)

