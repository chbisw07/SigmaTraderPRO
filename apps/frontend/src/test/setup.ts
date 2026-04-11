import '@testing-library/jest-dom/vitest'

import { afterEach, beforeAll, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeAll(() => {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input.toString()
    const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'http://localhost')
    const path = url.pathname

    if (path === '/health') {
      return jsonResponse({ status: 'ok' })
    }

    if (path === '/health/ready') {
      return jsonResponse({
        status: 'ready',
        postgres: { ok: true, error: null },
        redis: { ok: true, error: null },
        schema: { ok: true, error: null },
      })
    }

    if (path === '/api/v1/auth/me') {
      return jsonResponse({
        id: 1,
        email: 'dev@example.com',
        is_active: true,
        last_used_broker: null,
        include_broker_orders: true,
      })
    }

    if (path === '/api/v1/auth/me/preferences') {
      let lastUsedBroker: string | null = null
      let includeBrokerOrders: boolean | null = null
      try {
        const body = typeof init?.body === 'string' ? init.body : null
        if (body) {
          const parsed = JSON.parse(body) as { last_used_broker?: string | null; include_broker_orders?: boolean | null }
          lastUsedBroker = parsed.last_used_broker ?? null
          includeBrokerOrders = parsed.include_broker_orders ?? null
        }
      } catch {
        // ignore
      }
      return jsonResponse({
        id: 1,
        email: 'dev@example.com',
        is_active: true,
        last_used_broker: lastUsedBroker,
        include_broker_orders: includeBrokerOrders ?? true,
      })
    }

    if (path === '/api/v1/auth/login') {
      return jsonResponse({
        token_type: 'bearer',
        access_token: 'ACCESS_TOKEN_TEST',
        refresh_token: 'REFRESH_TOKEN_TEST',
        user: {
          id: 1,
          email: 'dev@example.com',
          is_active: true,
          last_used_broker: null,
          include_broker_orders: true,
        },
      })
    }

    if (path === '/api/v1/auth/refresh') {
      return jsonResponse({
        token_type: 'bearer',
        access_token: 'ACCESS_TOKEN_REFRESHED_TEST',
        refresh_token: 'REFRESH_TOKEN_REFRESHED_TEST',
        user: {
          id: 1,
          email: 'dev@example.com',
          is_active: true,
          last_used_broker: null,
          include_broker_orders: true,
        },
      })
    }

    if (path === '/api/v1/brokers/status') {
      return jsonResponse([
        {
          broker: 'angel',
          configured: true,
          enabled: true,
          state: 'connected',
          connected: true,
          stale: false,
          session_day: '2026-04-09',
          last_connected_at: '2026-04-09T09:00:00Z',
          last_error: null,
        },
        {
          broker: 'zerodha',
          configured: false,
          enabled: false,
          state: 'not_configured',
          connected: false,
          stale: false,
          session_day: null,
          last_connected_at: null,
          last_error: null,
        },
      ])
    }

    if (path === '/api/v1/brokers/zerodha/login-url') {
      return jsonResponse({ url: 'https://kite.zerodha.com/connect/login?api_key=K' })
    }

    if (path === '/api/v1/instruments/search') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      if (!q) return jsonResponse({ items: [] })

      if (q.includes('infy')) {
        return jsonResponse({
          items: [
            {
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
          ],
        })
      }

      if (q.includes('tcs')) {
        return jsonResponse({
          items: [
            {
              canonical_id: 'NSE_EQ:EQUITY:EQUITY:TCS',
              exchange: 'NSE_EQ',
              segment: 'EQUITY',
              instrument_type: 'EQUITY',
              symbol_root: 'TCS',
              display_symbol: 'TCS',
              underlying: null,
              expiry: null,
              strike: null,
              option_type: null,
              lot_size: 1,
              tick_size: 0.05,
              isin: 'INE467B01029',
              is_active: true,
              created_at: '2026-04-09T00:00:00Z',
              updated_at: '2026-04-09T00:00:00Z',
            },
          ],
        })
      }

      if (q.includes('fut')) {
        return jsonResponse({
          items: [
            {
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
          ],
        })
      }

      if (q.includes('nifty')) {
        return jsonResponse({
          items: [
            {
              canonical_id: 'NSE_FNO:INDEX:INDEX:NIFTY',
              exchange: 'NSE_FNO',
              segment: 'INDEX',
              instrument_type: 'INDEX',
              symbol_root: 'NIFTY',
              display_symbol: 'NIFTY',
              underlying: null,
              expiry: null,
              strike: null,
              option_type: null,
              lot_size: 50,
              tick_size: 0.05,
              isin: null,
              is_active: true,
              created_at: '2026-04-09T00:00:00Z',
              updated_at: '2026-04-09T00:00:00Z',
            },
          ],
        })
      }

      return jsonResponse({ items: [] })
    }

    if (path === '/api/v1/instruments/derivatives/expiries') {
      return jsonResponse({
        underlying: url.searchParams.get('underlying') ?? 'NIFTY',
        exchange: url.searchParams.get('exchange') ?? 'NSE_FNO',
        instrument_type: url.searchParams.get('instrument_type') ?? 'OPTION',
        expiries: ['2026-04-25'],
      })
    }

    if (path === '/api/v1/instruments/derivatives/strikes') {
      return jsonResponse({
        underlying: url.searchParams.get('underlying') ?? 'NIFTY',
        exchange: url.searchParams.get('exchange') ?? 'NSE_FNO',
        expiry: url.searchParams.get('expiry') ?? '2026-04-25',
        option_type: url.searchParams.get('option_type') ?? 'CE',
        strikes: [23100, 23200],
      })
    }

    if (path === '/api/v1/instruments/derivatives/options') {
      const underlying = (url.searchParams.get('underlying') ?? '').toUpperCase()
      const expiry = url.searchParams.get('expiry') ?? '2026-04-25'
      const optionType = url.searchParams.get('option_type') ?? 'CE'
      if (!underlying) return jsonResponse({ items: [] })
      return jsonResponse({
        items: [
          {
            canonical_id: `NSE_FNO:OPTION:OPTION:${underlying}:${expiry}:23100:${optionType}`,
            exchange: 'NSE_FNO',
            segment: 'OPTION',
            instrument_type: 'OPTION',
            symbol_root: `${underlying}${expiry}23100${optionType}`,
            display_symbol: `${underlying}${expiry}23100${optionType}`,
            underlying,
            expiry,
            strike: 23100,
            option_type: optionType,
            lot_size: 50,
            tick_size: 0.05,
            isin: null,
            is_active: true,
            created_at: '2026-04-09T00:00:00Z',
            updated_at: '2026-04-09T00:00:00Z',
          },
          {
            canonical_id: `NSE_FNO:OPTION:OPTION:${underlying}:${expiry}:23200:${optionType}`,
            exchange: 'NSE_FNO',
            segment: 'OPTION',
            instrument_type: 'OPTION',
            symbol_root: `${underlying}${expiry}23200${optionType}`,
            display_symbol: `${underlying}${expiry}23200${optionType}`,
            underlying,
            expiry,
            strike: 23200,
            option_type: optionType,
            lot_size: 50,
            tick_size: 0.05,
            isin: null,
            is_active: true,
            created_at: '2026-04-09T00:00:00Z',
            updated_at: '2026-04-09T00:00:00Z',
          },
        ],
      })
    }

    if (path === '/api/v1/orders/preview') {
      return jsonResponse({
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
        routing: {
          broker: 'angel',
          exchange: 'NSE',
          trading_symbol: 'INFY-EQ',
        },
        side: 'BUY',
        quantity: 1,
        product: 'CNC',
        order_type: 'MARKET',
        limit_price: null,
        warnings: [],
      })
    }

    if (path === '/api/v1/orders/fno/preview') {
      return jsonResponse({
        instrument: {
          canonical_id: 'NSE_FNO:OPTION:OPTION:NIFTY:2026-05-05:2010000:CE',
          exchange: 'NSE_FNO',
          segment: 'OPTION',
          instrument_type: 'OPTION',
          symbol_root: 'NIFTY',
          display_symbol: 'NIFTY 05 May 2026 2010000 CE',
          underlying: 'NIFTY',
          expiry: '2026-05-05',
          strike: 2010000,
          option_type: 'CE',
          lot_size: 50,
          tick_size: 0.05,
          isin: null,
          is_active: true,
          created_at: '2026-04-09T00:00:00Z',
          updated_at: '2026-04-09T00:00:00Z',
        },
        routing: {
          broker: 'angel',
          exchange: 'NFO',
          trading_symbol: 'NIFTY05MAY2620100CE',
        },
        side: 'BUY',
        lots: 1,
        quantity: 50,
        product: 'NRML',
        order_type: 'LIMIT',
        limit_price: 100,
        warnings: [],
      })
    }

    const method = (init?.method ?? 'GET').toUpperCase()

    if (path === '/api/v1/orders' && method === 'POST') {
      return jsonResponse({
        order_id: 1,
        status: 'submitted',
        broker_order_id: 'BROKER_ORDER_1',
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
          routing: {
            broker: 'angel',
            exchange: 'NSE',
            trading_symbol: 'INFY-EQ',
          },
          side: 'BUY',
          quantity: 1,
          product: 'CNC',
          order_type: 'MARKET',
          limit_price: null,
          warnings: [],
        },
      })
    }

    if (path === '/api/v1/orders/fno') {
      return jsonResponse({
        order_id: 2,
        status: 'submitted',
        broker_order_id: 'BROKER_FNO_ORDER_1',
        preview: {
          instrument: {
            canonical_id: 'NSE_FNO:OPTION:OPTION:NIFTY:2026-05-05:2010000:CE',
            exchange: 'NSE_FNO',
            segment: 'OPTION',
            instrument_type: 'OPTION',
            symbol_root: 'NIFTY',
            display_symbol: 'NIFTY 05 May 2026 2010000 CE',
            underlying: 'NIFTY',
            expiry: '2026-05-05',
            strike: 2010000,
            option_type: 'CE',
            lot_size: 50,
            tick_size: 0.05,
            isin: null,
            is_active: true,
            created_at: '2026-04-09T00:00:00Z',
            updated_at: '2026-04-09T00:00:00Z',
          },
          routing: {
            broker: 'angel',
            exchange: 'NFO',
            trading_symbol: 'NIFTY05MAY2620100CE',
          },
          side: 'BUY',
          lots: 1,
          quantity: 50,
          product: 'NRML',
          order_type: 'LIMIT',
          limit_price: 100,
          warnings: [],
        },
      })
    }

    if (path === '/api/v1/orders' && method === 'GET') {
      return jsonResponse({
        items: [
          {
            id: 1,
            created_at: '2026-04-09T00:00:00Z',
            updated_at: '2026-04-09T00:00:00Z',
            broker: 'angel',
            canonical_id: 'NSE_EQ:EQUITY:EQUITY:INFY',
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
            side: 'BUY',
            quantity: 1,
            lots: null,
            product: 'CNC',
            order_type: 'MARKET',
            placed_price: null,
            avg_executed_price: null,
            status: 'PENDING',
            broker_order_id: 'BROKER_ORDER_1',
            rejection_reason: null,
            source: 'manual_ui',
            intent_type: 'ENTRY',
            trigger_mode: 'MARKET',
            linked_position_id: 1,
          },
        ],
      })
    }

    if (path === '/api/v1/orders/workspace') {
      return jsonResponse({
        items: [
          {
            row_id: 'm:1:angel:BROKER_ORDER_1',
            source_origin: 'merged',
            reconciliation_state: 'matched',
            broker: 'angel',
            internal_order_id: 1,
            broker_order_id: 'BROKER_ORDER_1',
            exchange_order_id: 'EXCH_1',
            canonical_id: 'NSE_EQ:EQUITY:EQUITY:INFY',
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
            symbol_display: 'INFY',
            side: 'BUY',
            product: 'CNC',
            quantity: 1,
            lots: null,
            order_type: 'MARKET',
            placed_price: null,
            avg_price: null,
            status: 'PENDING',
            rejection_reason: null,
            placed_at: '2026-04-09T00:00:00Z',
            source: 'manual_ui',
            intent_type: 'ENTRY',
            linked_position_id: 1,
          },
        ],
        meta: { include_broker_orders: true, mode: 'merged', broker_errors: {} },
      })
    }

    if (
      path.startsWith('/api/v1/orders/') &&
      !['/api/v1/orders/repeat', '/api/v1/orders/reverse', '/api/v1/orders/reconcile'].includes(path) &&
      !path.endsWith('/preview') &&
      !path.endsWith('/fno') &&
      !path.endsWith('/fno/preview')
    ) {
      // order detail
      return jsonResponse({
        order: {
          id: 1,
          created_at: '2026-04-09T00:00:00Z',
          updated_at: '2026-04-09T00:00:00Z',
          broker: 'angel',
          canonical_id: 'NSE_EQ:EQUITY:EQUITY:INFY',
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
          side: 'BUY',
          quantity: 1,
          lots: null,
          product: 'CNC',
          order_type: 'MARKET',
          placed_price: null,
          avg_executed_price: null,
          status: 'PENDING',
          broker_order_id: 'BROKER_ORDER_1',
          rejection_reason: null,
          source: 'manual_ui',
          intent_type: 'ENTRY',
          trigger_mode: 'MARKET',
          linked_position_id: 1,
        },
        preview_snapshot_json: { canonical_id: 'NSE_EQ:EQUITY:EQUITY:INFY' },
        broker_payload_json: { trading_symbol: 'INFY-EQ' },
      })
    }

    if (path === '/api/v1/orders/repeat') {
      return jsonResponse({
        draft: {
          mode: 'contract',
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
          broker: 'angel',
          side: 'BUY',
          quantity: 1,
          lots: null,
          product: 'CNC',
          order_type: 'MARKET',
          limit_price: null,
          reference_price: null,
          intent: {
            source: 'manual_ui',
            intent_type: 'ENTRY',
            trigger_mode: 'MARKET',
            risk_mode: null,
            sl_value: null,
            tp_value: null,
            trailing_value: null,
            parent_order_id: 1,
            linked_position_id: 1,
            broker_context: 'angel',
          },
        },
      })
    }

    if (path === '/api/v1/orders/reverse') {
      return jsonResponse({
        draft: {
          mode: 'contract',
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
          broker: 'angel',
          side: 'SELL',
          quantity: 1,
          lots: null,
          product: 'CNC',
          order_type: 'MARKET',
          limit_price: null,
          reference_price: null,
          intent: {
            source: 'manual_ui',
            intent_type: 'EXIT',
            trigger_mode: 'MARKET',
            risk_mode: null,
            sl_value: null,
            tp_value: null,
            trailing_value: null,
            parent_order_id: 1,
            linked_position_id: 1,
            broker_context: 'angel',
          },
        },
      })
    }

    if (path === '/api/v1/orders/reconcile') {
      return jsonResponse({ status: 'ok', message: 'reconcile deferred in ML1' })
    }

    if (path === '/api/v1/positions') {
      return jsonResponse({
        items: [
          {
            id: 1,
            opened_at: '2026-04-09T00:00:00Z',
            updated_at: '2026-04-09T00:00:00Z',
            broker: 'angel',
            canonical_id: 'NSE_EQ:EQUITY:EQUITY:INFY',
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
            side: 'BUY',
            quantity: 1,
            lots: null,
            avg_price: 10,
            last_price: null,
            realized_pnl: null,
            unrealized_pnl: null,
            mtm: null,
            linked_orders_count: 1,
            source: 'manual_ui',
          },
        ],
      })
    }

    if (path.startsWith('/api/v1/positions/') && (path.endsWith('/squareoff') || path.endsWith('/reverse'))) {
      return jsonResponse({
        draft: {
          mode: 'contract',
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
          broker: 'angel',
          side: 'SELL',
          quantity: 1,
          lots: null,
          product: 'CNC',
          order_type: 'MARKET',
          limit_price: null,
          reference_price: null,
          intent: {
            source: 'manual_ui',
            intent_type: 'EXIT',
            trigger_mode: 'MARKET',
            risk_mode: null,
            sl_value: null,
            tp_value: null,
            trailing_value: null,
            parent_order_id: null,
            linked_position_id: 1,
            broker_context: 'angel',
          },
        },
      })
    }

    if (path.startsWith('/api/v1/positions/') && path.endsWith('/refresh')) {
      return jsonResponse({ status: 'ok', message: 'refresh deferred in ML1' })
    }

    return jsonResponse({ detail: 'Not found' }, 404)
  })
})

afterEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})
