# Watchlist structure v1 (7-slot + groups)

Date: 2026-04-24

## Goal

Refactor the existing AngelOne-style watchlist card to support:

- Fixed 7 watchlist “slots” (Zerodha-style bottom tabs)
- Grouped entries inside each watchlist (collapsible groups)
- UI-level enforcement of a `250` entry cap per watchlist

Search UX and Buy/Sell flows remain unchanged.

## What was reused

- Existing watchlist UI and flows in `apps/frontend/src/pages/WatchlistPage.tsx`
  - Add/search dropdown, list rows, Buy/Sell dialogs, row menus
  - React Query data fetching via `apps/frontend/src/lib/api/watchlists.ts`
- Existing broker selector + auth integration
- Existing layout preferences store `apps/frontend/src/store/watchlistLayoutStore.ts`

## What was extended

### 1) Slot-based watchlists (7 tabs)

Implemented a fixed 7-slot mapping (slot `1..7`) to backend watchlists:

- New persisted Zustand store `apps/frontend/src/store/watchlistStructureStore.ts`
  - `slotToWatchlistId`: maps each slot to a backend `watchlist.id`
  - `activeSlot`: persisted selected slot
- `WatchlistPage` now renders numeric bottom tabs (`1..7`) and switches the active backend watchlist id based on the selected slot.
- If the user has fewer than 7 backend watchlists, `WatchlistPage` will lazily create the missing ones via the existing `POST /api/v1/watchlists` API to make all 7 slots functional.

Selection persistence:

- Active slot is persisted via Zustand (`localStorage`)
- Active backend watchlist id is still written to `sigmatraderpro.watchlist.active_id` so Search page “Add to watchlist” continues to target the same active list.

### 2) Group support (client-side persistence)

Groups are implemented as a lightweight client-side layer on top of the existing backend “flat” watchlist items:

- Store fields (per `watchlist.id`):
  - `groupsByWatchlistId`: ordered groups with `collapsed` state
  - `activeGroupByWatchlistId`: the group used as the target for new adds
  - `entryGroupByKeyByWatchlistId`: entry → group mapping keyed by `canonical_id` (or `symbol_key` when `canonical_id` is absent)
- Default group:
  - Always present (id: `default`)
  - Cannot be deleted
- Delete group:
  - Allowed only if empty (UI enforced)

### 3) Entry limit (250)

UI-level enforcement was added in:

- `apps/frontend/src/pages/WatchlistPage.tsx` (watchlist add dropdown + underlying add)
- `apps/frontend/src/pages/SearchPage.tsx` (when adding via Search)

Search page uses React Query cache for the active watchlist (`['watchlists','items', activeId]`) to avoid extra requests.

## Data model (frontend)

This refactor keeps the existing API shapes and extends the frontend structure with the following concepts:

- `WatchlistSlot` (derived):
  - `slot` (`1..7`)
  - `watchlistId` (backend id)
  - `name` (from backend watchlist)
- `WatchlistGroup` (new):
  - `id` (string, stable; default is `default`)
  - `name`
  - `collapsed`
  - `sort_order`
- `WatchlistEntry` (reused from backend):
  - existing `WatchlistItemOut` already supports equity/index/futures/options structurally (expiry/strike/option_type) via `instrument` snapshot + fields.

## Known limitations

- Groups and group membership are persisted locally (not synced to backend yet).
- If the backend contains more than 7 watchlists, only the 7 slotted watchlists are exposed in the watchlist card UI.
- Entry counts for non-active slots are not fetched (only active watchlist shows a live count).

## Performance notes

- Grouping uses `Map`-based O(n) bucketing and memoization in `WatchlistPage`.
- No list virtualization is added in this iteration; max `250` entries remains responsive in local testing due to the capped size and memoized grouping.

