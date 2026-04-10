import type { OptionType } from '@/lib/api/instruments'

export type Moneyness = 'ATM' | 'ITM' | 'OTM'

export function computeAtmStrike(
  strikes: number[],
  opts: { spot?: number | null; anchorStrike?: number | null },
): number | null {
  const clean = strikes.filter((s) => typeof s === 'number' && Number.isFinite(s))
  if (!clean.length) return null

  const spot = opts.spot ?? null
  if (spot !== null && Number.isFinite(spot)) {
    let best = clean[0]
    let bestDiff = Math.abs(best - spot)
    for (const s of clean) {
      const d = Math.abs(s - spot)
      if (d < bestDiff) {
        best = s
        bestDiff = d
      }
    }
    return best
  }

  const anchor = opts.anchorStrike ?? null
  if (anchor !== null && Number.isFinite(anchor)) return anchor

  const sorted = [...clean].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null
}

export function computeMoneyness(
  strike: number,
  opts: { optionType: OptionType; spot: number | null; atmStrike: number | null },
): Moneyness {
  const { optionType, spot, atmStrike } = opts
  if (atmStrike !== null && strike === atmStrike) return 'ATM'

  const ref = spot ?? atmStrike
  if (ref === null) return 'ATM'

  if (optionType === 'CE') {
    return strike < ref ? 'ITM' : 'OTM'
  }
  // PE reverses ITM/OTM relative to strike vs reference spot.
  return strike > ref ? 'ITM' : 'OTM'
}

export function moneynessBadgeClasses(m: Moneyness): string {
  if (m === 'ATM') return 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'
  if (m === 'ITM') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  return 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300'
}
