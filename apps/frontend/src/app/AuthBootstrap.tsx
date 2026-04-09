import { type ReactNode, useEffect } from 'react'

import { useAuthStore } from '@/store/authStore'

type AuthBootstrapProps = {
  children: ReactNode
}

export function AuthBootstrap({ children }: AuthBootstrapProps) {
  const bootstrap = useAuthStore((s) => s.bootstrap)
  const status = useAuthStore((s) => s.status)

  useEffect(() => {
    if (status !== 'unknown') return
    void bootstrap()
  }, [bootstrap, status])

  return children
}
