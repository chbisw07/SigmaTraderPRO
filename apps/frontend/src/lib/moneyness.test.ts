import { describe, expect, test } from 'vitest'

import { computeAtmStrike, computeMoneyness, moneynessBadgeClasses } from './moneyness'

describe('moneyness', () => {
  test('computeAtmStrike prefers spot when available', () => {
    const strikes = [24100, 24150, 24200]
    expect(computeAtmStrike(strikes, { spot: 24142, anchorStrike: null })).toBe(24150)
  })

  test('computeAtmStrike falls back to anchor strike when no spot', () => {
    const strikes = [24100, 24150, 24200]
    expect(computeAtmStrike(strikes, { spot: null, anchorStrike: 24100 })).toBe(24100)
  })

  test('computeMoneyness labels CE/PE correctly', () => {
    const atmStrike = 24150
    const spot = 24142

    // CE: lower ITM, higher OTM
    expect(computeMoneyness(24100, { optionType: 'CE', spot, atmStrike })).toBe('ITM')
    expect(computeMoneyness(24150, { optionType: 'CE', spot, atmStrike })).toBe('ATM')
    expect(computeMoneyness(24200, { optionType: 'CE', spot, atmStrike })).toBe('OTM')

    // PE: semantics reverse
    expect(computeMoneyness(24100, { optionType: 'PE', spot, atmStrike })).toBe('OTM')
    expect(computeMoneyness(24150, { optionType: 'PE', spot, atmStrike })).toBe('ATM')
    expect(computeMoneyness(24200, { optionType: 'PE', spot, atmStrike })).toBe('ITM')
  })

  test('badge classes include theme-safe variants', () => {
    expect(moneynessBadgeClasses('ATM')).toContain('dark:')
    expect(moneynessBadgeClasses('ITM')).toContain('dark:')
    expect(moneynessBadgeClasses('OTM')).toContain('dark:')
  })
})

