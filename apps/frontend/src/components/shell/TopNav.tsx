import { NavLink } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { NAV_ITEMS } from '@/routes/nav'

export function TopNav() {
  return (
    <nav className="hidden md:flex items-center gap-0.5">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            cn(
              'relative rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors',
              'hover:bg-accent/70 hover:text-foreground',
              isActive && 'text-foreground',
              isActive &&
                'after:absolute after:inset-x-2 after:-bottom-0.5 after:h-[2px] after:rounded-full after:bg-primary',
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
