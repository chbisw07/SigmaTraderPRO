import type { RouteObject } from 'react-router-dom'
import { Navigate, createBrowserRouter, createMemoryRouter } from 'react-router-dom'

import { BrokersPage } from '@/pages/BrokersPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { LoginPage } from '@/pages/LoginPage'
import { OrdersPage } from '@/pages/OrdersPage'
import { PositionsPage } from '@/pages/PositionsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { StrategiesPage } from '@/pages/StrategiesPage'
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
          { path: 'brokers', element: <BrokersPage /> },
          { path: 'strategies', element: <StrategiesPage /> },
          { path: 'positions', element: <PositionsPage /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'settings', element: <SettingsPage /> },
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
