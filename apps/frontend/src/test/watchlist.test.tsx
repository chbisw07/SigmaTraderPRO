import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  try {
    window.localStorage.removeItem('sigmatraderpro.watchlist.layout')
  } catch {
    // ignore
  }
  try {
    window.localStorage.removeItem('sigmatraderpro.watchlist.view')
  } catch {
    // ignore
  }
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
  renderAt('/search')

  expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Default' })).toBeInTheDocument()
  expect(screen.getByText('Empty watchlist')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Go to Search' })).toBeInTheDocument()
})

test('can rename a watchlist from watchlist settings', async () => {
  renderAt('/search')

  expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument()
  expect(await screen.findByRole('heading', { name: 'Default' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Watchlist settings' }))

  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getAllByRole('button', { name: 'Rename watchlist' })[0])

  fireEvent.change(within(dialog).getByDisplayValue('Default'), {
    target: { value: 'FNO' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

  await waitFor(() => {
    expect(within(dialog).getAllByText('FNO').length).toBeGreaterThan(0)
  })
})

test('search can add an instrument to default watchlist and watchlist shows quick actions', async () => {
  renderAt('/search')

  expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Instrument search query'), {
    target: { value: 'INFY' },
  })

  const infyId = await screen.findByText('NSE_EQ:EQUITY:EQUITY:INFY')
  const infyRow = infyId.closest('div')?.parentElement?.parentElement
  if (!infyRow) throw new Error('INFY row not found')
  fireEvent.click(within(infyRow).getByRole('button', { name: 'Add' }))

  expect(await screen.findByRole('heading', { name: 'Default' })).toBeInTheDocument()

  const list = await screen.findByTestId('watchlist-items')
  const infy = await within(list).findByText('INFY')
  const row = infy.closest('[data-testid^="watchlist-row-"]')
  expect(row).toBeTruthy()
  if (!row) return

  fireEvent.mouseEnter(row)

  expect(within(row).getByRole('button', { name: 'Buy' })).toBeInTheDocument()
  expect(within(row).getByRole('button', { name: 'Sell' })).toBeInTheDocument()
  expect(within(row).getByRole('button', { name: 'More' })).toBeInTheDocument()
})
