import { describe, expect, it } from 'bun:test'
import { boroTokenBasescanUrl, configuredBoroTokenAddress } from '../src/boro-address'

describe('BORO contract address helpers', () => {
  it('accepts confirmed nonzero EVM addresses', () => {
    expect(configuredBoroTokenAddress('0x1234567890abcdef1234567890ABCDEF12345678')).toBe(
      '0x1234567890abcdef1234567890ABCDEF12345678',
    )
  })

  it('treats missing, invalid, and zero addresses as pending', () => {
    expect(configuredBoroTokenAddress(undefined)).toBeNull()
    expect(configuredBoroTokenAddress('')).toBeNull()
    expect(configuredBoroTokenAddress('not-an-address')).toBeNull()
    expect(configuredBoroTokenAddress('0x0000000000000000000000000000000000000000')).toBeNull()
  })

  it('builds the Base mainnet explorer URL', () => {
    expect(boroTokenBasescanUrl('0x1234567890abcdef1234567890ABCDEF12345678')).toBe(
      'https://basescan.org/address/0x1234567890abcdef1234567890ABCDEF12345678',
    )
  })
})
