import { describe, expect, it } from 'bun:test'
import { isRealAddress, normalizedAddress, shortAddress, ZERO_ADDRESS } from '../src/launch-config'

describe('$BORO launch config helpers', () => {
  it('rejects placeholders as real production addresses', () => {
    expect(isRealAddress('')).toBe(false)
    expect(isRealAddress(ZERO_ADDRESS)).toBe(false)
    expect(isRealAddress('0x0000000000000000000000000000000000000001')).toBe(true)
  })

  it('normalizes only valid EVM addresses', () => {
    expect(normalizedAddress(' 0x0000000000000000000000000000000000000001 ')).toBe(
      '0x0000000000000000000000000000000000000001',
    )
    expect(normalizedAddress('pending')).toBe('')
  })

  it('shortens addresses for compact metrics', () => {
    expect(shortAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234...5678')
  })
})
