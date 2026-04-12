import '@testing-library/jest-dom/vitest'

import { afterEach, beforeAll, vi } from 'vitest'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

type MockWatchlist = { id: number; name: string; is_default: boolean }
type MockWatchlistItem = {
  id: number
  watchlist_id: number
  position: number
  canonical_id: string | null
  display_symbol: string
}

type MockApiOverride = { status?: number; body: unknown }

let mockWatchlists: MockWatchlist[] = [{ id: 1, name: 'Default', is_default: true }]
let mockWatchlistItems: MockWatchlistItem[] = []
let nextWatchlistId = 2
let nextWatchlistItemId = 1

function resetWatchlists() {
  mockWatchlists = [{ id: 1, name: 'Default', is_default: true }]
  mockWatchlistItems = []
  nextWatchlistId = 2
  nextWatchlistItemId = 1
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

    if (path === '/api/v1/watchlists' && (!init?.method || init.method === 'GET')) {
      return jsonResponse({ items: mockWatchlists })
    }

    if (path === '/api/v1/watchlists' && init?.method === 'POST') {
      const body = typeof init.body === 'string' ? init.body : '{}'
      const parsed = JSON.parse(body) as { name?: string; make_default?: boolean }
      const name = String(parsed.name ?? '').trim() || 'Watchlist'
      const makeDefault = Boolean(parsed.make_default)
      if (makeDefault) {
        mockWatchlists = mockWatchlists.map((w) => ({ ...w, is_default: false }))
      }
      const wl = { id: nextWatchlistId++, name, is_default: makeDefault }
      mockWatchlists = [...mockWatchlists, wl]
      if (!mockWatchlists.some((w) => w.is_default)) {
        mockWatchlists[0] = { ...mockWatchlists[0], is_default: true }
      }
      return jsonResponse(wl, 201)
    }

    if (path.startsWith('/api/v1/watchlists/') && init?.method === 'PATCH') {
      const idStr = path.split('/')[4]
      const wlId = Number(idStr)
      const body = typeof init.body === 'string' ? init.body : '{}'
      const parsed = JSON.parse(body) as { name?: string; is_default?: boolean }
      if (parsed.is_default) {
        mockWatchlists = mockWatchlists.map((w) => ({ ...w, is_default: w.id === wlId }))
      }
      mockWatchlists = mockWatchlists.map((w) =>
        w.id === wlId && parsed.name ? { ...w, name: String(parsed.name) } : w,
      )
      const wl = mockWatchlists.find((w) => w.id === wlId)
      if (!wl) return jsonResponse({ detail: 'Not found' }, 404)
      return jsonResponse(wl)
    }

    if (path.startsWith('/api/v1/watchlists/') && init?.method === 'DELETE') {
      const idStr = path.split('/')[4]
      const wlId = Number(idStr)
      mockWatchlists = mockWatchlists.filter((w) => w.id !== wlId)
      mockWatchlistItems = mockWatchlistItems.filter((i) => i.watchlist_id !== wlId)
      if (!mockWatchlists.length) {
        resetWatchlists()
      } else if (!mockWatchlists.some((w) => w.is_default)) {
        mockWatchlists[0] = { ...mockWatchlists[0], is_default: true }
      }
      return new Response(null, { status: 204 })
    }

    if (path.startsWith('/api/v1/watchlists/default/items') && init?.method === 'POST') {
      const def = mockWatchlists.find((w) => w.is_default) ?? mockWatchlists[0]
      const body = typeof init.body === 'string' ? init.body : '{}'
      const parsed = JSON.parse(body) as { canonical_id?: string | null }
      const canonicalId = parsed.canonical_id ?? null
      if (!canonicalId) return jsonResponse({ detail: 'canonical_id required' }, 400)

      const exists = mockWatchlistItems.find((i) => i.watchlist_id === def.id && i.canonical_id === canonicalId)
      if (exists) {
        return jsonResponse({
          id: exists.id,
          position: exists.position,
          symbol_key: canonicalId,
          canonical_id: canonicalId,
          instrument: null,
          display_symbol: canonicalId.split(':').slice(-1)[0],
          exchange: null,
          segment: null,
          instrument_type: null,
          underlying: null,
          expiry: null,
          strike: null,
          option_type: null,
        }, 201)
      }

      const position = Math.max(0, ...mockWatchlistItems.filter((i) => i.watchlist_id === def.id).map((i) => i.position)) + 1
      const item: MockWatchlistItem = {
        id: nextWatchlistItemId++,
        watchlist_id: def.id,
        position,
        canonical_id: canonicalId,
        display_symbol: canonicalId.split(':').slice(-1)[0],
      }
      mockWatchlistItems = [...mockWatchlistItems, item]
      return jsonResponse({
        id: item.id,
        position: item.position,
        symbol_key: canonicalId,
        canonical_id: canonicalId,
        instrument: {
          canonical_id: canonicalId,
          exchange: 'NSE_EQ',
          segment: 'EQUITY',
          instrument_type: 'EQUITY',
          symbol_root: item.display_symbol,
          display_symbol: item.display_symbol,
          underlying: null,
          expiry: null,
          strike: null,
          option_type: null,
          lot_size: 1,
          tick_size: 0.05,
          isin: null,
          is_active: true,
          created_at: '2026-04-09T00:00:00Z',
          updated_at: '2026-04-09T00:00:00Z',
        },
        display_symbol: item.display_symbol,
        exchange: 'NSE_EQ',
        segment: 'EQUITY',
        instrument_type: 'EQUITY',
        underlying: null,
        expiry: null,
        strike: null,
        option_type: null,
      }, 201)
    }

    if (path.startsWith('/api/v1/watchlists/') && path.endsWith('/items') && (!init?.method || init.method === 'GET')) {
      const wlId = Number(path.split('/')[4])
      const wl = mockWatchlists.find((w) => w.id === wlId)
      if (!wl) return jsonResponse({ detail: 'Not found' }, 404)
      const items = mockWatchlistItems
        .filter((i) => i.watchlist_id === wlId)
        .sort((a, b) => a.position - b.position)
        .map((i) => ({
          id: i.id,
          position: i.position,
          symbol_key: i.canonical_id ?? `ITEM:${i.id}`,
          canonical_id: i.canonical_id,
          instrument: i.canonical_id
            ? {
                canonical_id: i.canonical_id,
                exchange: 'NSE_EQ',
                segment: 'EQUITY',
                instrument_type: 'EQUITY',
                symbol_root: i.display_symbol,
                display_symbol: i.display_symbol,
                underlying: null,
                expiry: null,
                strike: null,
                option_type: null,
                lot_size: 1,
                tick_size: 0.05,
                isin: null,
                is_active: true,
                created_at: '2026-04-09T00:00:00Z',
                updated_at: '2026-04-09T00:00:00Z',
              }
            : null,
          display_symbol: i.display_symbol,
          exchange: 'NSE_EQ',
          segment: 'EQUITY',
          instrument_type: 'EQUITY',
          underlying: null,
          expiry: null,
          strike: null,
          option_type: null,
        }))
      return jsonResponse({ watchlist: wl, items })
    }

    if (path.startsWith('/api/v1/watchlists/') && path.endsWith('/items') && init?.method === 'POST') {
      const wlId = Number(path.split('/')[4])
      const wl = mockWatchlists.find((w) => w.id === wlId)
      if (!wl) return jsonResponse({ detail: 'Not found' }, 404)
      const body = typeof init.body === 'string' ? init.body : '{}'
      const parsed = JSON.parse(body) as { canonical_id?: string | null }
      const canonicalId = parsed.canonical_id ?? null
      if (!canonicalId) return jsonResponse({ detail: 'canonical_id required' }, 400)
      const def = mockWatchlists.find((w) => w.id === wlId)!
      const position = Math.max(0, ...mockWatchlistItems.filter((i) => i.watchlist_id === def.id).map((i) => i.position)) + 1
      const item: MockWatchlistItem = {
        id: nextWatchlistItemId++,
        watchlist_id: def.id,
        position,
        canonical_id: canonicalId,
        display_symbol: canonicalId.split(':').slice(-1)[0],
      }
      mockWatchlistItems = [...mockWatchlistItems, item]
      return jsonResponse({
        id: item.id,
        position: item.position,
        symbol_key: canonicalId,
        canonical_id: canonicalId,
        instrument: null,
        display_symbol: item.display_symbol,
        exchange: null,
        segment: null,
        instrument_type: null,
        underlying: null,
        expiry: null,
        strike: null,
        option_type: null,
      }, 201)
    }

    if (path.includes('/items/') && init?.method === 'DELETE' && path.startsWith('/api/v1/watchlists/')) {
      const parts = path.split('/')
      const wlId = Number(parts[4])
      const itemId = Number(parts[6])
      mockWatchlistItems = mockWatchlistItems.filter((i) => !(i.watchlist_id === wlId && i.id === itemId))
      return new Response(null, { status: 204 })
    }

    if (path.endsWith('/items/reorder') && init?.method === 'POST' && path.startsWith('/api/v1/watchlists/')) {
      const wlId = Number(path.split('/')[4])
      const body = typeof init.body === 'string' ? init.body : '{}'
      const parsed = JSON.parse(body) as { item_ids?: number[] }
      const ids = parsed.item_ids ?? []
      let pos = 1
      for (const id of ids) {
        mockWatchlistItems = mockWatchlistItems.map((i) => (i.watchlist_id === wlId && i.id === id ? { ...i, position: pos++ } : i))
      }
      return jsonResponse({ status: 'ok' })
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

    if (path === '/api/v1/quotes') {
      const broker = url.searchParams.get('broker') ?? 'angel'
      const ids = url.searchParams.getAll('canonical_ids')
      const items = ids.map((id) => {
        const sym = id.split(':').slice(-1)[0] ?? id
        const ltp = sym === 'INFY' ? 1499.5 : sym === 'TCS' ? 3788.2 : 100
        const change = sym === 'INFY' ? 10.2 : sym === 'TCS' ? -5.4 : 0.5
        const pct = sym === 'INFY' ? 0.68 : sym === 'TCS' ? -0.14 : 0.25
        return {
          canonical_id: id,
          ltp,
          change,
          change_percent: pct,
          previous_close: ltp - change,
          as_of: '2026-04-09T00:00:00Z',
        }
      })
      return jsonResponse({ broker, items, warning: null })
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
      const override = (globalThis as unknown as { __mockApiOverrides?: { ordersCreate?: MockApiOverride } }).__mockApiOverrides
        ?.ordersCreate
      if (override) return jsonResponse(override.body, override.status ?? 200)
      return jsonResponse({
        order_id: 1,
        status: 'ACKNOWLEDGED',
        broker_order_id: 'BROKER_ORDER_1',
        correlation_id: 'CORR_TEST_1',
        blocked_reason_code: null,
        blocked_reason_message: null,
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
      const override = (globalThis as unknown as { __mockApiOverrides?: { ordersFnoCreate?: MockApiOverride } }).__mockApiOverrides
        ?.ordersFnoCreate
      if (override) return jsonResponse(override.body, override.status ?? 200)
      return jsonResponse({
        order_id: 2,
        status: 'ACKNOWLEDGED',
        broker_order_id: 'BROKER_FNO_ORDER_1',
        correlation_id: 'CORR_TEST_2',
        blocked_reason_code: null,
        blocked_reason_message: null,
        failure_reason_code: null,
        failure_reason_message: null,
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

    if (path === '/api/v1/system-events' && method === 'GET') {
      return jsonResponse({
        items: [
          {
            id: 1,
            created_at: '2026-04-11T15:00:00Z',
            level: 'WARNING',
            category: 'order_dispatch',
            message: 'Order dispatch blocked: broker session stale',
            correlation_id: 'CORR_EVENT_1',
            broker: 'angel',
            symbol: 'INFY-EQ',
            metadata: { order_id: 1, reason_code: 'BROKER_SESSION_STALE' },
          },
        ],
      })
    }

    if (path === '/api/v1/system-events/cleanup') {
      return jsonResponse({ status: 'ok', deleted: 1 })
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
            correlation_id: 'c-11111111-1111-1111-1111-111111111111',
            placed_at: '2026-04-09T00:00:00Z',
            source: 'manual_ui',
            intent_type: 'ENTRY',
            linked_position_id: 1,
          },
          {
            row_id: 'i:2',
            source_origin: 'sigmatrader',
            reconciliation_state: 'internal_only',
            broker: 'angel',
            internal_order_id: 2,
            broker_order_id: null,
            exchange_order_id: null,
            canonical_id: 'NSE_EQ:EQUITY:EQUITY:TCS',
            instrument: {
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
              isin: null,
              is_active: true,
              created_at: '2026-04-09T00:00:00Z',
              updated_at: '2026-04-09T00:00:00Z',
            },
            symbol_display: 'TCS',
            side: 'BUY',
            product: 'CNC',
            quantity: 1,
            lots: null,
            order_type: 'MARKET',
            placed_price: null,
            avg_price: null,
            status: 'BLOCKED',
            rejection_reason: null,
            correlation_id: 'c-22222222-2222-2222-2222-222222222222',
            blocked_reason_code: 'BROKER_SESSION_STALE',
            blocked_reason_message: 'Broker session is stale. Reconnect broker and try again.',
            placed_at: '2026-04-09T00:01:00Z',
            source: 'manual_ui',
            intent_type: 'ENTRY',
            linked_position_id: null,
          },
          {
            row_id: 'i:3',
            source_origin: 'sigmatrader',
            reconciliation_state: 'internal_only',
            broker: 'angel',
            internal_order_id: 3,
            broker_order_id: null,
            exchange_order_id: null,
            canonical_id: 'NSE_EQ:EQUITY:EQUITY:INFY',
            instrument: null,
            symbol_display: 'INFY',
            side: 'SELL',
            product: 'CNC',
            quantity: 1,
            lots: null,
            order_type: 'MARKET',
            placed_price: null,
            avg_price: null,
            status: 'DISPATCH_FAILED',
            rejection_reason: null,
            correlation_id: 'c-33333333-3333-3333-3333-333333333333',
            failure_reason_code: 'BROKER_DISPATCH_ERROR',
            failure_reason_message: 'Order dispatch failed before broker acknowledgement.',
            placed_at: '2026-04-09T00:02:00Z',
            source: 'manual_ui',
            intent_type: 'ENTRY',
            linked_position_id: null,
          },
          {
            row_id: 'm:4:angel:BROKER_ORDER_4',
            source_origin: 'merged',
            reconciliation_state: 'matched',
            broker: 'angel',
            internal_order_id: 4,
            broker_order_id: 'BROKER_ORDER_4',
            exchange_order_id: 'EXCH_4',
            canonical_id: 'NSE_EQ:EQUITY:EQUITY:INFY',
            instrument: null,
            symbol_display: 'INFY',
            side: 'BUY',
            product: 'CNC',
            quantity: 1,
            lots: null,
            order_type: 'MARKET',
            placed_price: null,
            avg_price: null,
            status: 'ACKNOWLEDGED',
            rejection_reason: null,
            correlation_id: 'c-44444444-4444-4444-4444-444444444444',
            placed_at: '2026-04-09T00:03:00Z',
            source: 'manual_ui',
            intent_type: 'ENTRY',
            linked_position_id: null,
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

    if (path === '/api/v1/holdings') {
      return jsonResponse({
        items: [
          {
            row_id: 'h:zerodha:INFY',
            broker: 'zerodha',
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
            exchange: 'NSE',
            isin: 'INE009A01021',
            quantity: 10,
            t1_quantity: 0,
            average_price: 1000,
            last_price: 1100,
            invested_value: 10000,
            current_value: 11000,
            pnl: 1000,
            day_change: 10,
            day_change_percentage: 0.9,
          },
        ],
        meta: { broker_errors: {} },
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

    if (path === '/api/v1/positions/sync') {
      return jsonResponse({
        status: 'ok',
        message: 'Synced 1 positions, closed 0',
        synced: 1,
        closed: 0,
        skipped_unmapped: 0,
        broker_errors: {},
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
  ;(globalThis as unknown as { __mockApiOverrides?: unknown }).__mockApiOverrides = undefined
  resetWatchlists()
  localStorage.clear()
})
