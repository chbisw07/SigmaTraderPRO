import { describe, expect, test } from 'vitest'

import { formatStrikeHuman } from '@/lib/format'

describe('formatStrikeHuman', () => {
  test('normalizes scaled strikes for non-index underlyings', () => {
    expect(formatStrikeHuman(135000, 'AUROPHARMA')).toBe('1350')
    expect(formatStrikeHuman(45000, 'HDFCBANK')).toBe('450')
  })

  test('normalizes large scaled strikes for index underlyings', () => {
    expect(formatStrikeHuman(2405000, 'NIFTY')).toBe('24050')
  })

  test('does not scale normal index strikes', () => {
    expect(formatStrikeHuman(24000, 'NIFTY')).toBe('24000')
    expect(formatStrikeHuman(24050, 'NIFTY')).toBe('24050')
  })

  test('avoids mis-scaling when underlying is unknown', () => {
    expect(formatStrikeHuman(23100)).toBe('23100')
    expect(formatStrikeHuman(2405000)).toBe('24050')
  })
})
