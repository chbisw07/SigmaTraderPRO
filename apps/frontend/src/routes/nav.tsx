import type { ReactNode } from 'react'
import {
  Briefcase,
  LayoutDashboard,
  Plug,
  ReceiptText,
  Search,
  Settings,
  Wand2,
} from 'lucide-react'

export type NavItem = {
  to: string
  label: string
  icon: ReactNode
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard /> },
  { to: '/brokers', label: 'Brokers', icon: <Plug /> },
  { to: '/search', label: 'Search', icon: <Search /> },
  { to: '/strategies', label: 'Strategies', icon: <Wand2 /> },
  { to: '/positions', label: 'Positions', icon: <Briefcase /> },
  { to: '/orders', label: 'Orders', icon: <ReceiptText /> },
  { to: '/settings', label: 'Settings', icon: <Settings /> },
]
