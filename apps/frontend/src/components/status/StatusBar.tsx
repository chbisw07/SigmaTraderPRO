import { useQuery } from '@tanstack/react-query'
import { CircleCheck, CircleX, Loader2, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { readiness } from '@/lib/api/health'
import { useAuthStore } from '@/store/authStore'

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        ok ? 'bg-emerald-500' : 'bg-red-500',
      )}
      aria-hidden="true"
    />
  )
}

export function StatusBar() {
  const status = useAuthStore((s) => s.status)
  const user = useAuthStore((s) => s.user)
  const isRefreshing = useAuthStore((s) => s.isRefreshing)

  const api = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: readiness,
    refetchInterval: 30_000,
    retry: false,
  })

  const apiOk = api.data?.status === 'ready'
  const schemaOk = api.data?.schema?.ok ?? false

  return (
    <div className="border-t bg-background px-3">
      <div className="flex h-9 items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="inline-flex items-center gap-2">
            {api.isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            ) : (
              <Dot ok={apiOk && schemaOk} />
            )}
            API
            <span className="text-muted-foreground">
              {api.isLoading ? 'Checking' : apiOk && schemaOk ? 'Ready' : 'Not ready'}
            </span>
          </Badge>
          <Badge variant="outline" className="inline-flex items-center gap-2">
            {status === 'authenticated' ? (
              <CircleCheck className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <CircleX className="h-3.5 w-3.5 text-red-600" />
            )}
            Auth
            <span className="text-muted-foreground">
              {status === 'authenticated' ? user?.email ?? 'Signed in' : 'Signed out'}
            </span>
          </Badge>
          {isRefreshing ? (
            <Badge variant="outline" className="inline-flex items-center gap-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Refreshing
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline">Dev</Badge>
        </div>
      </div>
    </div>
  )
}
