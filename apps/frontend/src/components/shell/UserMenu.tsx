import { LogOut, UserRound } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

export function UserMenu() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)

  const onLogout = () => {
    if (detailsRef.current) detailsRef.current.open = false
    logout()
    queryClient.clear()
    navigate('/login', { replace: true })
  }

  return (
    <details ref={detailsRef} className="relative">
      <Button asChild variant="outline" size="icon">
        <summary role="button" aria-label="User menu" className="list-none">
          <UserRound className="h-4 w-4" />
        </summary>
      </Button>
      <div
        className={cn(
          'absolute right-0 mt-2 w-60 rounded-lg border bg-card p-2 shadow-lg',
          'z-50',
        )}
      >
        <div className="px-2 py-1">
          <div className="text-xs text-muted-foreground">Signed in as</div>
          <div className="truncate text-sm font-medium">{user?.email ?? '-'}</div>
        </div>
        <div className="my-2 h-px bg-border" />
        <button
          type="button"
          onClick={onLogout}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm',
            'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
          )}
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </details>
  )
}
