import { create } from 'zustand'
import { applyTheme, getStoredTheme, type ThemePreference } from '@/lib/theme'

interface UIState {
  sidebarOpen: boolean
  setSidebar: (open: boolean) => void
  toggleSidebar: () => void
  theme: ThemePreference
  setTheme: (theme: ThemePreference) => void
}

const initialTheme = getStoredTheme()
applyTheme(initialTheme)

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  setSidebar: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  theme: initialTheme,
  setTheme: (theme) => { applyTheme(theme); set({ theme }) },
}))
