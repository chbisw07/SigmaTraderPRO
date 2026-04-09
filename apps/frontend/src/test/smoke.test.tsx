import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider } from 'react-router-dom'

import { Providers } from '@/app/Providers'
import { createTestRouter } from '@/routes/router'
import { useAuthStore } from '@/store/authStore'

function renderAt(path: string) {
  const router = createTestRouter([path])
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
  return router
}

beforeEach(() => {
  useAuthStore.setState({
    status: 'unauthenticated',
    accessToken: null,
    refreshToken: null,
    user: null,
    isRefreshing: false,
    error: null,
    revision: 0,
  })
})

test('renders login page', () => {
  renderAt('/login')

  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  expect(screen.getByLabelText('Email')).toBeInTheDocument()
  expect(screen.getByLabelText('Password')).toBeInTheDocument()
})

test('redirects unauthenticated users to login', async () => {
  renderAt('/positions')

  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
})

test('login redirects back to intended route', async () => {
  renderAt('/positions')

  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'dev@example.com' },
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'password123' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

  expect(await screen.findByRole('heading', { name: 'Positions' })).toBeInTheDocument()
})

test('renders the protected shell when authenticated', async () => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    user: {
      id: 1,
      email: 'dev@example.com',
      is_active: true,
      last_used_broker: null,
    },
    isRefreshing: false,
    error: null,
  })

  renderAt('/')

  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  await waitFor(() => {
    expect(screen.getAllByText('SigmaTraderPRO').length).toBeGreaterThan(0)
  })
})

test('logout clears auth state and redirects to login', async () => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    user: {
      id: 1,
      email: 'dev@example.com',
      is_active: true,
      last_used_broker: null,
    },
    isRefreshing: false,
    error: null,
  })

  renderAt('/')

  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()

  // mimic persisted auth presence prior to logout
  localStorage.setItem(
    'sigmatraderpro.auth',
    JSON.stringify({
      state: {
        accessToken: 'ACCESS_TOKEN',
        refreshToken: 'REFRESH_TOKEN',
        user: {
          id: 1,
          email: 'dev@example.com',
          is_active: true,
          last_used_broker: null,
        },
      },
      version: 1,
    }),
  )

  fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
  fireEvent.click(screen.getByRole('button', { name: 'Logout' }))

  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()

  expect(useAuthStore.getState().status).toBe('unauthenticated')
  expect(useAuthStore.getState().accessToken).toBeNull()
  expect(useAuthStore.getState().refreshToken).toBeNull()
  expect(useAuthStore.getState().user).toBeNull()

  // persisted auth artifacts should be gone after logout
  expect(localStorage.getItem('sigmatraderpro.auth')).toBeNull()
})

test('brokers page renders broker cards', async () => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    user: {
      id: 1,
      email: 'dev@example.com',
      is_active: true,
      last_used_broker: null,
    },
    isRefreshing: false,
    error: null,
    revision: 0,
  })

  renderAt('/brokers')

  expect(await screen.findByRole('heading', { name: 'Brokers' })).toBeInTheDocument()
  expect(screen.getByText('Angel One (SmartAPI)')).toBeInTheDocument()
  expect(screen.getByText('Zerodha (Kite Connect)')).toBeInTheDocument()
  expect(screen.getByText('Fyers (coming soon)')).toBeInTheDocument()
})
