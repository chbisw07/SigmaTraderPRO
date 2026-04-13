export type NavItem = {
  to: string
  label: string
}

// Top-header navigation (Watchlist is a persistent left workspace, not a page tab).
export const NAV_ITEMS: NavItem[] = [
  { to: '/brokers', label: 'Brokers' },
  { to: '/queue', label: 'Queue' },
  { to: '/orders', label: 'Orders' },
  { to: '/positions', label: 'Positions' },
  { to: '/holdings', label: 'Holdings' },
  { to: '/system-events', label: 'System Events' },
  { to: '/search', label: 'Search' },
  { to: '/settings', label: 'Settings' },
  { to: '/strategies', label: 'Strategies' },
]
