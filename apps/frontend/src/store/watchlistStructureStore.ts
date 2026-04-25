import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const WATCHLIST_SLOT_COUNT = 7
export const WATCHLIST_ENTRY_LIMIT = 250

export type WatchlistGroup = {
  id: string
  name: string
  collapsed: boolean
  sort_order: number
}

type WatchlistStructureState = {
  activeSlot: number
  slotToWatchlistId: Record<number, number | null>

  groupsByWatchlistId: Record<number, WatchlistGroup[]>
  activeGroupByWatchlistId: Record<number, string | null>
  entryGroupByKeyByWatchlistId: Record<number, Record<string, string>>

  setActiveSlot: (slot: number) => void
  setSlotToWatchlistId: (slot: number, watchlistId: number | null) => void
  setSlotMap: (next: Record<number, number | null>) => void

  ensureDefaultGroup: (watchlistId: number) => void
  setActiveGroup: (watchlistId: number, groupId: string) => void
  createGroup: (watchlistId: number, name: string) => string
  renameGroup: (watchlistId: number, groupId: string, name: string) => void
  toggleGroupCollapsed: (watchlistId: number, groupId: string) => void
  deleteGroup: (watchlistId: number, groupId: string) => void

  setEntryGroup: (watchlistId: number, entryKey: string, groupId: string) => void
  clearEntryGroup: (watchlistId: number, entryKey: string) => void
}

function clampSlot(slot: number): number {
  if (!Number.isFinite(slot)) return 1
  const s = Math.floor(slot)
  if (s < 1) return 1
  if (s > WATCHLIST_SLOT_COUNT) return WATCHLIST_SLOT_COUNT
  return s
}

function emptySlotMap(): Record<number, number | null> {
  const m: Record<number, number | null> = {}
  for (let i = 1; i <= WATCHLIST_SLOT_COUNT; i += 1) m[i] = null
  return m
}

function ensureDefault(groups: WatchlistGroup[] | undefined): WatchlistGroup[] {
  const existing = groups ?? []
  if (existing.some((g) => g.id === 'default')) return existing
  const next = [...existing, { id: 'default', name: 'Default', collapsed: false, sort_order: 0 }]
  next.sort((a, b) => a.sort_order - b.sort_order)
  return next
}

export const useWatchlistStructureStore = create<WatchlistStructureState>()(
  persist(
    (set, get) => ({
      activeSlot: 1,
      slotToWatchlistId: emptySlotMap(),

      groupsByWatchlistId: {},
      activeGroupByWatchlistId: {},
      entryGroupByKeyByWatchlistId: {},

      setActiveSlot: (slot) => set({ activeSlot: clampSlot(slot) }),
      setSlotToWatchlistId: (slot, watchlistId) =>
        set((s) => ({
          slotToWatchlistId: { ...s.slotToWatchlistId, [clampSlot(slot)]: watchlistId },
        })),
      setSlotMap: (next) => {
        const cleaned: Record<number, number | null> = emptySlotMap()
        for (let i = 1; i <= WATCHLIST_SLOT_COUNT; i += 1) cleaned[i] = next[i] ?? null
        set({ slotToWatchlistId: cleaned })
      },

      ensureDefaultGroup: (watchlistId) =>
        set((s) => ({
          groupsByWatchlistId: {
            ...s.groupsByWatchlistId,
            [watchlistId]: ensureDefault(s.groupsByWatchlistId[watchlistId]),
          },
          activeGroupByWatchlistId: {
            ...s.activeGroupByWatchlistId,
            [watchlistId]:
              s.activeGroupByWatchlistId[watchlistId] ??
              (ensureDefault(s.groupsByWatchlistId[watchlistId])[0]?.id ?? 'default'),
          },
        })),

      setActiveGroup: (watchlistId, groupId) =>
        set((s) => ({
          activeGroupByWatchlistId: { ...s.activeGroupByWatchlistId, [watchlistId]: groupId },
        })),

      createGroup: (watchlistId, name) => {
        const trimmed = name.trim()
        if (!trimmed) return 'default'
        const groupId = `g_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
        const existing = ensureDefault(get().groupsByWatchlistId[watchlistId])
        const nextOrder = Math.max(0, ...existing.map((g) => g.sort_order)) + 1
        const next = [...existing, { id: groupId, name: trimmed, collapsed: false, sort_order: nextOrder }]
        next.sort((a, b) => a.sort_order - b.sort_order)
        set((s) => ({
          groupsByWatchlistId: { ...s.groupsByWatchlistId, [watchlistId]: next },
          activeGroupByWatchlistId: { ...s.activeGroupByWatchlistId, [watchlistId]: groupId },
        }))
        return groupId
      },

      renameGroup: (watchlistId, groupId, name) => {
        const trimmed = name.trim()
        if (!trimmed) return
        set((s) => {
          const groups = ensureDefault(s.groupsByWatchlistId[watchlistId])
          const next = groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g))
          return { groupsByWatchlistId: { ...s.groupsByWatchlistId, [watchlistId]: next } }
        })
      },

      toggleGroupCollapsed: (watchlistId, groupId) =>
        set((s) => {
          const groups = ensureDefault(s.groupsByWatchlistId[watchlistId])
          const next = groups.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g))
          return { groupsByWatchlistId: { ...s.groupsByWatchlistId, [watchlistId]: next } }
        }),

      deleteGroup: (watchlistId, groupId) =>
        set((s) => {
          if (groupId === 'default') return s
          const groups = ensureDefault(s.groupsByWatchlistId[watchlistId])
          const nextGroups = groups.filter((g) => g.id !== groupId)
          const active = s.activeGroupByWatchlistId[watchlistId]
          const nextActive = active === groupId ? 'default' : active ?? 'default'
          const perEntry = s.entryGroupByKeyByWatchlistId[watchlistId] ?? {}
          const cleaned: Record<string, string> = {}
          for (const [k, v] of Object.entries(perEntry)) {
            if (v !== groupId) cleaned[k] = v
          }
          return {
            groupsByWatchlistId: { ...s.groupsByWatchlistId, [watchlistId]: nextGroups },
            activeGroupByWatchlistId: { ...s.activeGroupByWatchlistId, [watchlistId]: nextActive },
            entryGroupByKeyByWatchlistId: { ...s.entryGroupByKeyByWatchlistId, [watchlistId]: cleaned },
          }
        }),

      setEntryGroup: (watchlistId, entryKey, groupId) =>
        set((s) => ({
          entryGroupByKeyByWatchlistId: {
            ...s.entryGroupByKeyByWatchlistId,
            [watchlistId]: { ...(s.entryGroupByKeyByWatchlistId[watchlistId] ?? {}), [entryKey]: groupId },
          },
        })),

      clearEntryGroup: (watchlistId, entryKey) =>
        set((s) => {
          const prev = s.entryGroupByKeyByWatchlistId[watchlistId]
          if (!prev || !(entryKey in prev)) return s
          const next = { ...prev }
          delete next[entryKey]
          return {
            entryGroupByKeyByWatchlistId: { ...s.entryGroupByKeyByWatchlistId, [watchlistId]: next },
          }
        }),
    }),
    {
      name: 'sigmatraderpro.watchlist.structure',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        activeSlot: s.activeSlot,
        slotToWatchlistId: s.slotToWatchlistId,
        groupsByWatchlistId: s.groupsByWatchlistId,
        activeGroupByWatchlistId: s.activeGroupByWatchlistId,
        entryGroupByKeyByWatchlistId: s.entryGroupByKeyByWatchlistId,
      }),
    },
  ),
)

