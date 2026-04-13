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
    queueCreate: {
      status: 200,
      body: {
        id: 11,
        created_at: '2026-04-11T12:00:00Z',
        updated_at: '2026-04-11T12:00:00Z',
        source_type: 'manual_ui',
        source_ref: 'contract',
        correlation_id: 'CORR_BLOCK_STOCK_1',
        idempotency_key: 'IDEM_STOCK_1',
        broker: 'angel',
        canonical_id: 'NSE_EQ:EQUITY:EQUITY:INFY',
        instrument: null,
        side: 'BUY',
        quantity: 1,
        lots: null,
        product: 'CNC',
        order_type: 'MARKET',
        limit_price: null,
        managed_exits: false,
        execution_mode: 'auto_dispatch',
        status: 'blocked',
        validation_state: 'blocked',
        block_reason_code: 'BROKER_SESSION_STALE',
        block_reason_message: 'Order blocked: broker session is stale. Reconnect broker and try again.',
        resolution_state: 'unresolved',
        resolution: { execution_ready: false, unresolved_fields: ['entry.broker'] },
        dispatched_order_id: null,
        notes: null,
        expires_at: null,
        execution_intent: { entry: { broker: 'angel', canonical_id: 'NSE_EQ:EQUITY:EQUITY:INFY', side: 'BUY', quantity: 1, product: 'CNC', order_type: 'MARKET' }, plan: { managed_exits: false } },
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
    queueCreate: {
      status: 200,
      body: {
        id: 22,
        created_at: '2026-04-11T12:00:00Z',
        updated_at: '2026-04-11T12:00:00Z',
        source_type: 'manual_ui',
        source_ref: 'contract',
        correlation_id: 'CORR_BLOCK_FNO_1',
        idempotency_key: 'IDEM_FNO_1',
        broker: 'angel',
        canonical_id: 'NSE_FNO:FUTURE:FUTURE:NIFTY:2026-04-25',
        instrument: null,
        side: 'BUY',
        quantity: 50,
        lots: 1,
        product: 'NRML',
        order_type: 'MARKET',
        limit_price: null,
        managed_exits: false,
        execution_mode: 'auto_dispatch',
        status: 'blocked',
        validation_state: 'blocked',
        block_reason_code: 'BROKER_SESSION_MISSING',
        block_reason_message: 'Order blocked: broker session is missing or invalid. Reconnect broker and try again.',
        resolution_state: 'unresolved',
        resolution: { execution_ready: false, unresolved_fields: ['entry.broker'] },
        dispatched_order_id: null,
        notes: null,
        expires_at: null,
        execution_intent: { entry: { broker: 'angel', canonical_id: 'NSE_FNO:FUTURE:FUTURE:NIFTY:2026-04-25', side: 'BUY', quantity: 50, lots: 1, product: 'NRML', order_type: 'MARKET' }, plan: { managed_exits: false } },
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
