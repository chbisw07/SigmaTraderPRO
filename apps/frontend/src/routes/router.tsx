import type { RouteObject } from 'react-router-dom'
import { createBrowserRouter, createMemoryRouter } from 'react-router-dom'

import { BrokersPage } from '@/pages/BrokersPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { OrdersPage } from '@/pages/OrdersPage'
import { PositionsPage } from '@/pages/PositionsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { StrategiesPage } from '@/pages/StrategiesPage'
import { RootLayout } from '@/routes/RootLayout'

export const routeConfig: RouteObject[] = [
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
]

export const router = createBrowserRouter(routeConfig)

export function createTestRouter(initialEntries: string[] = ['/']) {
  return createMemoryRouter(routeConfig, { initialEntries })
}

