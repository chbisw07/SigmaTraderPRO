import type { RouteObject } from 'react-router-dom'
import { Navigate, createBrowserRouter, createMemoryRouter } from 'react-router-dom'

import { BrokersPage } from '@/pages/BrokersPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { LoginPage } from '@/pages/LoginPage'
import { HoldingsPage } from '@/pages/HoldingsPage'
import { OrdersPage } from '@/pages/OrdersPage'
import { PositionsPage } from '@/pages/PositionsPage'
import { QueuePage } from '@/pages/QueuePage'
import { SearchPage } from '@/pages/SearchPage'
import { IntegrationsPage } from '@/pages/IntegrationsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { StrategiesPage } from '@/pages/StrategiesPage'
import { SystemEventsPage } from '@/pages/SystemEventsPage'
import { TradingViewSettingsPage } from '@/pages/TradingViewSettingsPage'
import { RequireAuth } from '@/routes/RequireAuth'
import { RootLayout } from '@/routes/RootLayout'

export const routeConfig: RouteObject[] = [
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <RootLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'watchlist', element: <Navigate to="/search" replace /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'strategies', element: <StrategiesPage /> },
          { path: 'positions', element: <PositionsPage /> },
          { path: 'holdings', element: <HoldingsPage /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'queue', element: <QueuePage /> },
          // Back-compat: Brokers now lives under Settings.
          { path: 'brokers', element: <Navigate to="/settings/brokers" replace /> },
          { path: 'system-events', element: <SystemEventsPage /> },
          {
            path: 'settings',
            element: <SettingsPage />,
            children: [
              { index: true, element: <Navigate to="/settings/brokers" replace /> },
              { path: 'brokers', element: <BrokersPage /> },
              {
                path: 'integrations',
                element: <IntegrationsPage />,
                children: [
                  { index: true, element: <Navigate to="/settings/integrations/tradingview" replace /> },
                  { path: 'tradingview', element: <TradingViewSettingsPage /> },
                ],
              },
            ],
          },
          // Back-compat: moved under /settings/integrations.
          { path: 'settings/tradingview', element: <Navigate to="/settings/integrations/tradingview" replace /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]

export const router = createBrowserRouter(routeConfig)

export function createTestRouter(initialEntries: string[] = ['/']) {
  return createMemoryRouter(routeConfig, { initialEntries })
}
