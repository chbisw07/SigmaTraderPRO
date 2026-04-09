import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import * as brokersApi from '@/lib/api/brokers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'

function StateBadge({ state }: { state: brokersApi.BrokerSessionState }) {
  const variant =
    state === 'connected'
      ? 'default'
      : state === 'stale' || state === 'needs_reconnect' || state === 'error'
        ? 'outline'
        : 'default'

  const label =
    state === 'not_configured'
      ? 'Not configured'
      : state === 'needs_reconnect'
        ? 'Needs reconnect'
        : state[0].toUpperCase() + state.slice(1)

  return <Badge variant={variant}>{label}</Badge>
}

function formatWhen(value: string | null) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

export function BrokersPage() {
  const queryClient = useQueryClient()
  const accessToken = useAuthStore((s) => s.accessToken)

  const brokers = useQuery({
    queryKey: ['brokers', 'status'],
    queryFn: async () => {
      if (!accessToken) return []
      return brokersApi.listBrokerStatus(accessToken)
    },
    enabled: Boolean(accessToken),
    refetchInterval: 30_000,
  })

  const byKey = useMemo(() => {
    const map: Partial<Record<brokersApi.BrokerKey, brokersApi.BrokerStatus>> = {}
    for (const s of brokers.data ?? []) map[s.broker] = s
    return map
  }, [brokers.data])

  const angel = byKey.angel
  const zerodha = byKey.zerodha

  const [angelApiKey, setAngelApiKey] = useState('')
  const [angelClientCode, setAngelClientCode] = useState('')
  const [angelPassword, setAngelPassword] = useState('')
  const [angelTotp, setAngelTotp] = useState('')
  const [angelBusy, setAngelBusy] = useState(false)
  const [angelMsg, setAngelMsg] = useState<string | null>(null)

  const [zerodhaApiKey, setZerodhaApiKey] = useState('')
  const [zerodhaApiSecret, setZerodhaApiSecret] = useState('')
  const [zerodhaRequestToken, setZerodhaRequestToken] = useState('')
  const [zerodhaBusy, setZerodhaBusy] = useState(false)
  const [zerodhaMsg, setZerodhaMsg] = useState<string | null>(null)

  const [zerodhaLoginUrl, setZerodhaLoginUrl] = useState<string | null>(null)

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['brokers', 'status'] })
  }

  const onAngelSave = async () => {
    if (!accessToken) return
    setAngelBusy(true)
    setAngelMsg(null)
    try {
      await brokersApi.angelUpsertSettings(accessToken, {
        is_enabled: true,
        api_key: angelApiKey.trim(),
        client_code: angelClientCode.trim(),
        password: angelPassword,
      })
      setAngelMsg('Saved. Enter TOTP and connect.')
      setAngelApiKey('')
      setAngelClientCode('')
      setAngelPassword('')
      await refresh()
    } catch (e) {
      setAngelMsg(
        typeof e === 'object' && e && 'message' in e
          ? String((e as { message?: unknown }).message ?? 'Save failed')
          : 'Save failed',
      )
    } finally {
      setAngelBusy(false)
    }
  }

  const onAngelConnect = async () => {
    if (!accessToken) return
    setAngelBusy(true)
    setAngelMsg(null)
    try {
      const status = await brokersApi.angelConnect(accessToken, {
        totp: angelTotp.trim(),
      })
      setAngelMsg(status.connected ? 'Connected.' : status.last_error ?? 'Connect failed')
      setAngelTotp('')
      await refresh()
    } catch (e) {
      setAngelMsg(
        typeof e === 'object' && e && 'message' in e
          ? String((e as { message?: unknown }).message ?? 'Connect failed')
          : 'Connect failed',
      )
    } finally {
      setAngelBusy(false)
    }
  }

  const onAngelDisconnect = async () => {
    if (!accessToken) return
    setAngelBusy(true)
    setAngelMsg(null)
    try {
      await brokersApi.angelDisconnect(accessToken)
      setAngelMsg('Disconnected.')
      await refresh()
    } catch (e) {
      setAngelMsg(
        typeof e === 'object' && e && 'message' in e
          ? String((e as { message?: unknown }).message ?? 'Disconnect failed')
          : 'Disconnect failed',
      )
    } finally {
      setAngelBusy(false)
    }
  }

  const onZerodhaSave = async () => {
    if (!accessToken) return
    setZerodhaBusy(true)
    setZerodhaMsg(null)
    try {
      await brokersApi.zerodhaUpsertSettings(accessToken, {
        is_enabled: true,
        api_key: zerodhaApiKey.trim(),
        api_secret: zerodhaApiSecret.trim(),
      })
      setZerodhaMsg('Saved. Open Zerodha login and paste request_token.')
      setZerodhaApiKey('')
      setZerodhaApiSecret('')
      await refresh()
    } catch (e) {
      setZerodhaMsg(
        typeof e === 'object' && e && 'message' in e
          ? String((e as { message?: unknown }).message ?? 'Save failed')
          : 'Save failed',
      )
    } finally {
      setZerodhaBusy(false)
    }
  }

  const onZerodhaOpenLogin = async () => {
    if (!accessToken) return
    setZerodhaBusy(true)
    setZerodhaMsg(null)
    try {
      const data = await brokersApi.zerodhaLoginUrl(accessToken)
      setZerodhaLoginUrl(data.url)
      window.open(data.url, '_blank', 'noopener,noreferrer')
      setZerodhaMsg('Login opened. After success, copy request_token from redirect URL.')
    } catch (e) {
      setZerodhaMsg(
        typeof e === 'object' && e && 'message' in e
          ? String((e as { message?: unknown }).message ?? 'Failed to open login')
          : 'Failed to open login',
      )
    } finally {
      setZerodhaBusy(false)
    }
  }

  const onZerodhaConnect = async () => {
    if (!accessToken) return
    setZerodhaBusy(true)
    setZerodhaMsg(null)
    try {
      const status = await brokersApi.zerodhaConnect(accessToken, {
        request_token: zerodhaRequestToken.trim(),
      })
      setZerodhaMsg(status.connected ? 'Connected.' : status.last_error ?? 'Connect failed')
      setZerodhaRequestToken('')
      await refresh()
    } catch (e) {
      setZerodhaMsg(
        typeof e === 'object' && e && 'message' in e
          ? String((e as { message?: unknown }).message ?? 'Connect failed')
          : 'Connect failed',
      )
    } finally {
      setZerodhaBusy(false)
    }
  }

  const onZerodhaDisconnect = async () => {
    if (!accessToken) return
    setZerodhaBusy(true)
    setZerodhaMsg(null)
    try {
      await brokersApi.zerodhaDisconnect(accessToken)
      setZerodhaMsg('Disconnected.')
      await refresh()
    } catch (e) {
      setZerodhaMsg(
        typeof e === 'object' && e && 'message' in e
          ? String((e as { message?: unknown }).message ?? 'Disconnect failed')
          : 'Disconnect failed',
      )
    } finally {
      setZerodhaBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Brokers</h1>
          <p className="text-sm text-muted-foreground">
            Configure broker credentials and connect daily sessions. No trading actions yet.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={brokers.isFetching}>
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Angel One (SmartAPI)</CardTitle>
              <CardDescription>
                Save API key + client code + password/MPIN. Connect requires current TOTP.
              </CardDescription>
            </div>
            <StateBadge state={angel?.state ?? 'not_configured'} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">API key</div>
                <Input value={angelApiKey} onChange={(e) => setAngelApiKey(e.target.value)} placeholder="SmartAPI API key" />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Client code</div>
                <Input value={angelClientCode} onChange={(e) => setAngelClientCode(e.target.value)} placeholder="Client code" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <div className="text-xs font-medium text-muted-foreground">Password / MPIN</div>
                <Input type="password" value={angelPassword} onChange={(e) => setAngelPassword(e.target.value)} placeholder="••••••••" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => void onAngelSave()}
                disabled={angelBusy || !angelApiKey.trim() || !angelClientCode.trim() || !angelPassword}
              >
                Save settings
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onAngelDisconnect()}
                disabled={angelBusy || !angel?.configured}
              >
                Disconnect
              </Button>
            </div>

            <div className="rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">TOTP</div>
                  <Input
                    value={angelTotp}
                    onChange={(e) => setAngelTotp(e.target.value)}
                    placeholder="123456"
                    className="w-40"
                    inputMode="numeric"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => void onAngelConnect()}
                    disabled={angelBusy || !angel?.configured || !angelTotp.trim()}
                  >
                    {angel?.state === 'stale' || angel?.state === 'needs_reconnect'
                      ? 'Reconnect'
                      : 'Connect'}
                  </Button>
                </div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Last connected: {formatWhen(angel?.last_connected_at ?? null)} • Session day:{' '}
                {angel?.session_day ?? '—'}
              </div>
              {angel?.last_error ? (
                <div className="mt-2 text-xs text-destructive">
                  Error: {angel.last_error}
                </div>
              ) : null}
            </div>

            {angelMsg ? (
              <div className={cn('text-xs', angelMsg.toLowerCase().includes('fail') ? 'text-destructive' : 'text-muted-foreground')}>
                {angelMsg}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Zerodha (Kite Connect)</CardTitle>
              <CardDescription>
                Save API key + secret. Connect uses request_token from the Zerodha login redirect URL.
              </CardDescription>
            </div>
            <StateBadge state={zerodha?.state ?? 'not_configured'} />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">API key</div>
                <Input value={zerodhaApiKey} onChange={(e) => setZerodhaApiKey(e.target.value)} placeholder="Kite API key" />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">API secret</div>
                <Input type="password" value={zerodhaApiSecret} onChange={(e) => setZerodhaApiSecret(e.target.value)} placeholder="••••••••" />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => void onZerodhaSave()}
                disabled={zerodhaBusy || !zerodhaApiKey.trim() || !zerodhaApiSecret.trim()}
              >
                Save settings
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onZerodhaDisconnect()}
                disabled={zerodhaBusy || !zerodha?.configured}
              >
                Disconnect
              </Button>
            </div>

            <div className="rounded-lg border bg-card p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {zerodhaLoginUrl ? (
                    <span className="break-all">Login URL cached for this session.</span>
                  ) : (
                    <span>Open Zerodha login, then paste the request_token.</span>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void onZerodhaOpenLogin()}
                  disabled={zerodhaBusy || !zerodha?.configured}
                >
                  Open Zerodha login
                </Button>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground">request_token</div>
                  <Input
                    value={zerodhaRequestToken}
                    onChange={(e) => setZerodhaRequestToken(e.target.value)}
                    placeholder="request_token"
                    className="w-80"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => void onZerodhaConnect()}
                  disabled={zerodhaBusy || !zerodha?.configured || !zerodhaRequestToken.trim()}
                >
                  {zerodha?.state === 'stale' || zerodha?.state === 'needs_reconnect'
                    ? 'Reconnect'
                    : 'Connect'}
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Last connected: {formatWhen(zerodha?.last_connected_at ?? null)} • Session day:{' '}
                {zerodha?.session_day ?? '—'}
              </div>
              {zerodha?.last_error ? (
                <div className="text-xs text-destructive">Error: {zerodha.last_error}</div>
              ) : null}
            </div>

            {zerodhaMsg ? (
              <div className={cn('text-xs', zerodhaMsg.toLowerCase().includes('fail') ? 'text-destructive' : 'text-muted-foreground')}>
                {zerodhaMsg}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="opacity-75">
        <CardHeader>
          <CardTitle>Fyers (coming soon)</CardTitle>
          <CardDescription>
            Adapter boundary is ready. Implementation is deferred.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">
            No actions available in this milestone.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
