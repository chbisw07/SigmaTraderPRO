export function formatNumber(value: number | null | undefined, opts?: Intl.NumberFormatOptions): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, ...opts }).format(value)
}

export function formatQty(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)
}

export function formatMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

export function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${formatNumber(value, { maximumFractionDigits: 2 })}%`
}

const INDEX_UNDERLYINGS = new Set(['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'SENSEX'])

function normalizeStrikeForDisplay(strike: number, underlying?: string | null): number {
  const u = (underlying ?? '').toUpperCase()
  // Some broker instrument masters (and older ingests) store option strikes scaled by 100.
  // Normalize for UI so display matches broker terminals.
  if (strike >= 100_000) return strike / 100
  // Only apply the "non-index divisible by 100" heuristic when the underlying is known.
  // Otherwise index strikes like 23100 would incorrectly render as 231.
  if (u && !INDEX_UNDERLYINGS.has(u) && strike >= 1_000 && strike % 100 === 0) return strike / 100
  return strike
}

export function formatStrikeHuman(strike: number | null | undefined, underlying?: string | null): string {
  if (strike == null || Number.isNaN(strike)) return '—'
  const v = normalizeStrikeForDisplay(strike, underlying)
  if (Number.isInteger(v)) return String(Math.trunc(v))
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(v)
}
