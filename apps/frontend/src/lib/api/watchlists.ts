import { apiRequest } from '@/lib/api/client'
import type { InstrumentOut } from '@/lib/api/instruments'

export type WatchlistOut = {
  id: number
  name: string
  is_default: boolean
  created_at?: string | null
  updated_at?: string | null
}

export type WatchlistItemOut = {
  id: number
  position: number
  symbol_key: string
  canonical_id: string | null
  instrument: InstrumentOut | null
  display_symbol: string
  exchange: string | null
  segment: string | null
  instrument_type: string | null
  underlying: string | null
  expiry: string | null
  strike: number | null
  option_type: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type WatchlistListResponse = { items: WatchlistOut[] }

export type WatchlistItemsResponse = {
  watchlist: WatchlistOut
  items: WatchlistItemOut[]
}

export async function listWatchlists(accessToken: string): Promise<WatchlistListResponse> {
  return apiRequest<WatchlistListResponse>('/api/v1/watchlists', {
    method: 'GET',
    accessToken,
  })
}

export async function createWatchlist(
  accessToken: string,
  payload: { name: string; make_default?: boolean },
): Promise<WatchlistOut> {
  return apiRequest<WatchlistOut>('/api/v1/watchlists', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function updateWatchlist(
  accessToken: string,
  watchlistId: number,
  payload: { name?: string; is_default?: boolean },
): Promise<WatchlistOut> {
  return apiRequest<WatchlistOut>(`/api/v1/watchlists/${watchlistId}`, {
    method: 'PATCH',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function deleteWatchlist(accessToken: string, watchlistId: number): Promise<void> {
  await apiRequest(`/api/v1/watchlists/${watchlistId}`, {
    method: 'DELETE',
    accessToken,
  })
}

export async function listWatchlistItems(accessToken: string, watchlistId: number): Promise<WatchlistItemsResponse> {
  return apiRequest<WatchlistItemsResponse>(`/api/v1/watchlists/${watchlistId}/items`, {
    method: 'GET',
    accessToken,
  })
}

export async function addWatchlistItem(
  accessToken: string,
  watchlistId: number,
  payload: { canonical_id?: string | null; underlying?: string | null },
): Promise<WatchlistItemOut> {
  return apiRequest<WatchlistItemOut>(`/api/v1/watchlists/${watchlistId}/items`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function addWatchlistItemDefault(
  accessToken: string,
  payload: { canonical_id?: string | null; underlying?: string | null },
): Promise<WatchlistItemOut> {
  return apiRequest<WatchlistItemOut>('/api/v1/watchlists/default/items', {
    method: 'POST',
    accessToken,
    body: JSON.stringify(payload),
  })
}

export async function removeWatchlistItem(accessToken: string, watchlistId: number, itemId: number): Promise<void> {
  await apiRequest(`/api/v1/watchlists/${watchlistId}/items/${itemId}`, {
    method: 'DELETE',
    accessToken,
  })
}

export async function reorderWatchlistItems(
  accessToken: string,
  watchlistId: number,
  itemIds: number[],
): Promise<void> {
  await apiRequest(`/api/v1/watchlists/${watchlistId}/items/reorder`, {
    method: 'POST',
    accessToken,
    body: JSON.stringify({ item_ids: itemIds }),
  })
}

