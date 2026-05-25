import { describe, expect, it } from 'bun:test'
import {
  BASE_MAINNET_BORO_ADDRESS,
  BASE_MAINNET_BORO_LOCK_ADDRESS,
  isRealAddress,
  normalizedAddress,
  shortAddress,
  ZERO_ADDRESS,
} from '../src/launch-config'

describe('$BORO launch config helpers', () => {
  it('rejects placeholders as real production addresses', () => {
    expect(isRealAddress('')).toBe(false)
    expect(isRealAddress(ZERO_ADDRESS)).toBe(false)
    expect(isRealAddress('0x0000000000000000000000000000000000000001')).toBe(true)
  })

  it('keeps the confirmed Base mainnet BORO proxy address available as the default', () => {
    expect(BASE_MAINNET_BORO_ADDRESS).toBe('0x91f11Ad8fa616E95b41C88dFFde95D415F3F9C3c')
    expect(isRealAddress(BASE_MAINNET_BORO_ADDRESS)).toBe(true)
  })

  it('keeps the confirmed Base mainnet BORO lock proxy address available as the default', () => {
    expect(BASE_MAINNET_BORO_LOCK_ADDRESS).toBe('0xfDD50a8eB2fc3Ef7325606aED1cf3FFBF3dC72e2')
    expect(isRealAddress(BASE_MAINNET_BORO_LOCK_ADDRESS)).toBe(true)
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
