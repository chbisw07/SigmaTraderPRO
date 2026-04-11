import { fireEvent, render, screen, within } from '@testing-library/react'

import { Providers } from '@/app/Providers'
import { FnoOrderDialog } from '@/features/orders/FnoOrderDialog'
import { StockOrderDialog } from '@/features/orders/StockOrderDialog'
import { useAuthStore } from '@/store/authStore'

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

test('stock order dialog shows blocked reason + correlation id', async () => {
  ;(globalThis as unknown as { __mockApiOverrides?: unknown }).__mockApiOverrides = {
    ordersCreate: {
      status: 200,
      body: {
        order_id: 11,
        status: 'BLOCKED',
        broker_order_id: null,
        correlation_id: 'CORR_BLOCK_STOCK_1',
        blocked_reason_code: 'BROKER_SESSION_STALE',
        blocked_reason_message: 'Order blocked: broker session is stale. Reconnect broker and try again.',
        failure_reason_code: null,
        failure_reason_message: null,
        preview: {
          instrument: {
            canonical_id: 'NSE_EQ:EQUITY:EQUITY:INFY',
            exchange: 'NSE_EQ',
            segment: 'EQUITY',
            instrument_type: 'EQUITY',
            symbol_root: 'INFY',
            display_symbol: 'INFY',
            underlying: null,
            expiry: null,
            strike: null,
            option_type: null,
            lot_size: 1,
            tick_size: 0.05,
            isin: 'INE009A01021',
            is_active: true,
            created_at: '2026-04-09T00:00:00Z',
            updated_at: '2026-04-09T00:00:00Z',
          },
          routing: { broker: 'angel', exchange: 'NSE', trading_symbol: 'INFY-EQ' },
          side: 'BUY',
          quantity: 1,
          product: 'CNC',
          order_type: 'MARKET',
          limit_price: null,
          warnings: [],
        },
      },
    },
  }

  render(
    <Providers>
      <StockOrderDialog
        open
        onOpenChange={() => {}}
        launch={{
          mode: 'contract',
          broker: 'angel',
          instrument: {
            canonical_id: 'NSE_EQ:EQUITY:EQUITY:INFY',
            exchange: 'NSE_EQ',
            segment: 'EQUITY',
            instrument_type: 'EQUITY',
            symbol_root: 'INFY',
            display_symbol: 'INFY',
            underlying: null,
            expiry: null,
            strike: null,
            option_type: null,
            lot_size: 1,
            tick_size: 0.05,
            isin: 'INE009A01021',
            is_active: true,
            created_at: '2026-04-09T00:00:00Z',
            updated_at: '2026-04-09T00:00:00Z',
          },
          referencePrice: 1500,
        }}
      />
    </Providers>,
  )

  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Preview' }))
  await screen.findByText(/Routing:/i)

  fireEvent.click(within(dialog).getByRole('button', { name: /Place buy/i }))
  expect(await screen.findByText(/Order blocked/i)).toBeInTheDocument()
  expect(screen.getByText(/Correlation ID:/i)).toBeInTheDocument()
  expect(screen.getByText(/CORR_BLOCK_STOCK_1/i)).toBeInTheDocument()
})

test('fno order dialog shows blocked reason + correlation id', async () => {
  ;(globalThis as unknown as { __mockApiOverrides?: unknown }).__mockApiOverrides = {
    ordersFnoCreate: {
      status: 200,
      body: {
        order_id: 22,
        status: 'BLOCKED',
        broker_order_id: null,
        correlation_id: 'CORR_BLOCK_FNO_1',
        blocked_reason_code: 'BROKER_SESSION_MISSING',
        blocked_reason_message: 'Order blocked: broker session is missing or invalid. Reconnect broker and try again.',
        failure_reason_code: null,
        failure_reason_message: null,
        preview: {
          instrument: {
            canonical_id: 'NSE_FNO:FUTURE:FUTURE:NIFTY:2026-04-25',
            exchange: 'NSE_FNO',
            segment: 'FUTURE',
            instrument_type: 'FUTURE',
            symbol_root: 'NIFTY',
            display_symbol: 'NIFTY 25 Apr 2026 FUT',
            underlying: 'NIFTY',
            expiry: '2026-04-25',
            strike: null,
            option_type: null,
            lot_size: 50,
            tick_size: 0.05,
            isin: null,
            is_active: true,
            created_at: '2026-04-09T00:00:00Z',
            updated_at: '2026-04-09T00:00:00Z',
          },
          routing: { broker: 'angel', exchange: 'NFO', trading_symbol: 'NIFTY26APR25FUT' },
          side: 'BUY',
          lots: 1,
          quantity: 50,
          product: 'NRML',
          order_type: 'MARKET',
          limit_price: null,
          warnings: [],
        },
      },
    },
  }

  render(
    <Providers>
      <FnoOrderDialog
        open
        onOpenChange={() => {}}
        launch={{
          mode: 'contract',
          broker: 'angel',
          instrument: {
            canonical_id: 'NSE_FNO:FUTURE:FUTURE:NIFTY:2026-04-25',
            exchange: 'NSE_FNO',
            segment: 'FUTURE',
            instrument_type: 'FUTURE',
            symbol_root: 'NIFTY',
            display_symbol: 'NIFTY 25 Apr 2026 FUT',
            underlying: 'NIFTY',
            expiry: '2026-04-25',
            strike: null,
            option_type: null,
            lot_size: 50,
            tick_size: 0.05,
            isin: null,
            is_active: true,
            created_at: '2026-04-09T00:00:00Z',
            updated_at: '2026-04-09T00:00:00Z',
          },
        }}
      />
    </Providers>,
  )

  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Preview' }))
  await screen.findByText(/Routing:/i)

  fireEvent.click(within(dialog).getByRole('button', { name: /Place buy/i }))
  expect(await screen.findByText(/Order blocked/i)).toBeInTheDocument()
  expect(screen.getByText(/Correlation ID:/i)).toBeInTheDocument()
  expect(screen.getByText(/CORR_BLOCK_FNO_1/i)).toBeInTheDocument()
})

