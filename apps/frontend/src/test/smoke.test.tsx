import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from 'react-router-dom'

import { Providers } from '@/app/Providers'
import { FnoOrderDialog } from '@/features/orders/FnoOrderDialog'
import { StockOrderDialog } from '@/features/orders/StockOrderDialog'
import { createTestRouter } from '@/routes/router'
import { useAuthStore } from '@/store/authStore'
import { useQuoteStore } from '@/store/quoteStore'

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
  useQuoteStore.setState({ premiumsByCanonicalId: {}, spotsByUnderlying: {} })
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

test('search page renders and returns canonical results', async () => {
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

  renderAt('/search')

  expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Instrument search query'), {
    target: { value: 'INFY' },
  })

  expect(await screen.findByText('INFY')).toBeInTheDocument()
  expect(screen.getByText('NSE_EQ:EQUITY:EQUITY:INFY')).toBeInTheDocument()
})

test('stock order dialog opens from search and previews order', async () => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    user: {
      id: 1,
      email: 'dev@example.com',
      is_active: true,
      last_used_broker: 'angel',
    },
    isRefreshing: false,
    error: null,
    revision: 0,
  })

  renderAt('/search')

  expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Instrument search query'), {
    target: { value: 'INFY' },
  })

  fireEvent.click(await screen.findByRole('button', { name: 'Trade' }))

  expect(await screen.findByText('Stock order')).toBeInTheDocument()
  const stockDialog = screen.getByRole('dialog')
  expect(within(stockDialog).getByText('NSE_EQ:EQUITY:EQUITY:INFY')).toBeInTheDocument()
  expect(within(stockDialog).getByLabelText('Order quantity')).toHaveValue(1)
  expect(within(stockDialog).getByText('Prefilled')).toBeInTheDocument()

  fireEvent.click(within(stockDialog).getByRole('button', { name: 'Preview' }))
  expect(await within(stockDialog).findByText(/Routing:/i)).toBeInTheDocument()
})

test('strike discovery renders option chain for selected underlying', async () => {
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

  renderAt('/search')

  expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Underlying search query'), {
    target: { value: 'NIFTY' },
  })

  fireEvent.click(await screen.findByRole('button', { name: /NIFTY/i }))

  await screen.findByRole('option', { name: '2026-04-25' })

  fireEvent.change(screen.getByLabelText('Expiry select'), {
    target: { value: '2026-04-25' },
  })

  expect(await screen.findByText(/contracts/i)).toBeInTheDocument()
  expect(await screen.findByText('23100')).toBeInTheDocument()
})

test('F&O order dialog opens from option chain and previews order', async () => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    user: {
      id: 1,
      email: 'dev@example.com',
      is_active: true,
      last_used_broker: 'angel',
    },
    isRefreshing: false,
    error: null,
    revision: 0,
  })

  renderAt('/search')

  expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Underlying search query'), {
    target: { value: 'NIFTY' },
  })

  fireEvent.click(await screen.findByRole('button', { name: /NIFTY/i }))

  await screen.findByRole('option', { name: '2026-04-25' })

  fireEvent.change(screen.getByLabelText('Expiry select'), {
    target: { value: '2026-04-25' },
  })

  // Trade button exists on option chain rows.
  fireEvent.click((await screen.findAllByRole('button', { name: 'Trade' }))[0])

  expect(await screen.findByText('F&O order')).toBeInTheDocument()
  const fnoDialog = screen.getByRole('dialog')
  expect(within(fnoDialog).getByLabelText('F&O underlying')).toHaveValue('NIFTY')
  await within(fnoDialog).findByRole('option', { name: '2026-04-25' })
  expect(within(fnoDialog).getByLabelText('F&O expiry')).toHaveValue('2026-04-25')
  expect(within(fnoDialog).getByLabelText('F&O strike')).toHaveValue('23100')
  expect(within(fnoDialog).getByText('Prefilled')).toBeInTheDocument()

  fireEvent.click(within(fnoDialog).getByRole('button', { name: 'Preview' }))
  expect(await within(fnoDialog).findByText(/Routing:/i)).toBeInTheDocument()
})

test('F&O strike row Trade prefills premium and shows ATM/ITM/OTM labels', async () => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    user: {
      id: 1,
      email: 'dev@example.com',
      is_active: true,
      last_used_broker: 'angel',
    },
    isRefreshing: false,
    error: null,
    revision: 0,
  })

  useQuoteStore.getState().setPremium('NSE_FNO:OPTION:OPTION:NIFTY:2026-04-25:23100:CE', 118.5)
  useQuoteStore.getState().setPremium('NSE_FNO:OPTION:OPTION:NIFTY:2026-04-25:23200:CE', 122.0)

  renderAt('/search')
  expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Underlying search query'), {
    target: { value: 'NIFTY' },
  })
  fireEvent.click(await screen.findByRole('button', { name: /NIFTY/i }))

  await screen.findByRole('option', { name: '2026-04-25' })
  fireEvent.change(screen.getByLabelText('Expiry select'), {
    target: { value: '2026-04-25' },
  })

  fireEvent.click((await screen.findAllByRole('button', { name: 'Trade' }))[0])

  expect(await screen.findByText('F&O order')).toBeInTheDocument()
  const dialog = screen.getByRole('dialog')
  const limitPrice = within(dialog).getByLabelText('F&O limit price')
  expect(limitPrice).toHaveValue(118.5)

  // strike labels should include moneyness
  await within(dialog).findByRole('option', { name: /23100.*ATM/i })
  await within(dialog).findByRole('option', { name: /23200.*OTM/i })

  fireEvent.change(within(dialog).getByLabelText('F&O strike'), {
    target: { value: '23200' },
  })
  expect(within(dialog).getByLabelText('F&O limit price')).toHaveValue(122.0)
})

test('future Trade click opens F&O dialog with contract prefill', async () => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    user: {
      id: 1,
      email: 'dev@example.com',
      is_active: true,
      last_used_broker: 'angel',
    },
    isRefreshing: false,
    error: null,
    revision: 0,
  })

  renderAt('/search')
  expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Instrument search query'), {
    target: { value: 'NIFTY FUT' },
  })

  const futId = await screen.findByText('NSE_FNO:FUTURE:FUTURE:NIFTY:2026-04-25')
  const futRow = futId.parentElement?.parentElement
  if (!futRow) throw new Error('Future row not found')
  fireEvent.click(within(futRow).getByRole('button', { name: 'Trade' }))

  expect(await screen.findByText('F&O order')).toBeInTheDocument()
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByLabelText('F&O underlying')).toHaveValue('NIFTY')
  await within(dialog).findByRole('option', { name: '2026-04-25' })
  expect(within(dialog).getByLabelText('F&O expiry')).toHaveValue('2026-04-25')
  expect(within(dialog).queryByLabelText('F&O strike')).toBeNull()
})

test('manual launch opens blank dialogs (no contract prefill)', async () => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    user: {
      id: 1,
      email: 'dev@example.com',
      is_active: true,
      last_used_broker: 'angel',
    },
    isRefreshing: false,
    error: null,
    revision: 0,
  })

  render(
    <Providers>
      <StockOrderDialog open onOpenChange={() => {}} launch={{ mode: 'manual', broker: 'angel' }} />
      <FnoOrderDialog open onOpenChange={() => {}} launch={{ mode: 'manual', broker: 'angel' }} />
    </Providers>,
  )

  expect(await screen.findByText('Stock order')).toBeInTheDocument()
  expect(screen.getByText(/No instrument selected/i)).toBeInTheDocument()

  expect(await screen.findByText('F&O order')).toBeInTheDocument()
  expect(screen.getByLabelText('F&O underlying')).toHaveValue('')
  expect(screen.getByLabelText('F&O expiry')).toHaveValue('')
})

test('reopening Trade on another row hydrates dialog state', async () => {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'ACCESS_TOKEN',
    refreshToken: 'REFRESH_TOKEN',
    user: {
      id: 1,
      email: 'dev@example.com',
      is_active: true,
      last_used_broker: 'angel',
    },
    isRefreshing: false,
    error: null,
    revision: 0,
  })

  renderAt('/search')
  expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Instrument search query'), {
    target: { value: 'INFY' },
  })
  const infyRowId = await screen.findByText('NSE_EQ:EQUITY:EQUITY:INFY')
  const infyRow = infyRowId.parentElement?.parentElement
  if (!infyRow) throw new Error('INFY row not found')
  fireEvent.click(within(infyRow).getByRole('button', { name: 'Trade' }))
  expect(await screen.findByText('Stock order')).toBeInTheDocument()
  const dialog1 = screen.getByRole('dialog')
  expect(within(dialog1).getByText('NSE_EQ:EQUITY:EQUITY:INFY')).toBeInTheDocument()
  fireEvent.click(within(dialog1).getByText('Close'))

  fireEvent.change(screen.getByLabelText('Instrument search query'), {
    target: { value: 'TCS' },
  })
  const tcsRowId = await screen.findByText('NSE_EQ:EQUITY:EQUITY:TCS')
  const tcsRow = tcsRowId.parentElement?.parentElement
  if (!tcsRow) throw new Error('TCS row not found')
  fireEvent.click(within(tcsRow).getByRole('button', { name: 'Trade' }))
  expect(await screen.findByText('Stock order')).toBeInTheDocument()
  const dialog2 = screen.getByRole('dialog')
  expect(within(dialog2).getByText('NSE_EQ:EQUITY:EQUITY:TCS')).toBeInTheDocument()
})
