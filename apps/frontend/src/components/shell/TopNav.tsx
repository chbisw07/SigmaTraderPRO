import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { NAV_ITEMS } from '@/routes/nav'

export function TopNav() {
  return (
    <nav className="hidden lg:flex items-center gap-1">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            cn(
              'rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground',
              isActive && 'bg-accent/60 text-foreground font-medium',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}

