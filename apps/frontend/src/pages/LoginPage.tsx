import { useMemo, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

type LocationState = { from?: string }

export function LoginPage() {
  const location = useLocation()
  const state = location.state as LocationState | null

  const status = useAuthStore((s) => s.status)
  const login = useAuthStore((s) => s.login)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = useMemo(
    () => email.trim().length > 3 && password.length > 0,
    [email, password],
  )

  if (status === 'authenticated') {
    return <Navigate to={state?.from ?? '/'} replace />
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || submitting) return

    setSubmitting(true)
    setError(null)
    try {
      await login(email.trim(), password)
    } catch (err) {
      const msg =
        typeof err === 'object' && err && 'message' in err
          ? String((err as { message?: unknown }).message ?? 'Login failed')
          : 'Login failed'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-md items-center px-4">
        <div className="w-full space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-lg font-semibold text-primary">
                Σ
              </div>
              <div>
                <h1 className="text-xl font-semibold">Sign in</h1>
                <p className="text-sm text-muted-foreground">
                  SigmaTraderPRO workspace
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1">
              <label
                htmlFor="login-email"
                className="text-xs font-medium text-muted-foreground"
              >
                Email
              </label>
              <input
                id="login-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                type="email"
                required
                placeholder="you@example.com"
                className={cn(
                  'h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none shadow-sm',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="login-password"
                className="text-xs font-medium text-muted-foreground"
              >
                Password
              </label>
              <input
                id="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                type="password"
                required
                placeholder="••••••••"
                className={cn(
                  'h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none shadow-sm',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                )}
              />
            </div>

            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              disabled={!canSubmit || submitting}
              className="w-full"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>

            <div className="text-xs text-muted-foreground">
              Password reset and registration UI are deferred.
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
