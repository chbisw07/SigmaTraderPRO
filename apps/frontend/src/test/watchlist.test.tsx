import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    status: 'authenticated',
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    user: {
      id: 1,
      email: 'dev@example.com',
      is_active: true,
      last_used_broker: 'angel',
      include_broker_orders: true,
    },
    isRefreshing: false,
    error: null,
    revision: 0,
  })
})

test('watchlist renders empty state', async () => {
  renderAt('/watchlist')

  expect(await screen.findByRole('heading', { name: 'Watchlist' })).toBeInTheDocument()
  expect(screen.getByText('Empty watchlist')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Go to Search' })).toBeInTheDocument()
})

test('can create a watchlist from watchlist page', async () => {
  renderAt('/watchlist')

  expect(await screen.findByRole('heading', { name: 'Watchlist' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Watchlist settings' }))

  fireEvent.change(await screen.findByPlaceholderText('New watchlist name'), {
    target: { value: 'FNO' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))

  await waitFor(() => {
    expect(screen.getAllByText('FNO').length).toBeGreaterThan(0)
  })
})

test('search can add an instrument to default watchlist and watchlist shows quick actions', async () => {
  const router = renderAt('/search')

  expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Instrument search query'), {
    target: { value: 'INFY' },
  })

  expect(await screen.findByText('INFY')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Add' }))

  await act(async () => {
    await router.navigate('/watchlist')
  })

  expect(await screen.findByRole('heading', { name: 'Watchlist' })).toBeInTheDocument()

  await screen.findByText('INFY')
  const table = screen.getByRole('table')
  expect(within(table).getByRole('button', { name: 'Buy' })).toBeInTheDocument()
  expect(within(table).getByRole('button', { name: 'Sell' })).toBeInTheDocument()
  expect(within(table).getByRole('button', { name: 'View orders' })).toBeInTheDocument()
  expect(within(table).getByRole('button', { name: 'View positions' })).toBeInTheDocument()
  expect(within(table).getByRole('button', { name: 'Remove from watchlist' })).toBeInTheDocument()
})
