import { create } from 'zustand'

type UiState = {
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebarCollapsed: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}))

