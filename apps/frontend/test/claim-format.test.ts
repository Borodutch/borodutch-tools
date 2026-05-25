import { describe, expect, it } from 'bun:test'
import { formatBoroAllocation } from '../src/claim-format'

describe('claim allocation formatting', () => {
  it('formats raw $BORO allocations with token decimals', () => {
    expect(formatBoroAllocation('1000000000000000000')).toBe('1 $BORO')
    expect(formatBoroAllocation('1234500000000000000')).toBe('1.2345 $BORO')
    expect(formatBoroAllocation('1000000000000000001')).toBe('1.000000000000000001 $BORO')
    expect(formatBoroAllocation('1500000000000')).toBe('0.0000015 $BORO')
    expect(formatBoroAllocation('123456789012345678901234567890')).toBe('123456789012.34567890123456789 $BORO')
  })

  it('keeps zero and tiny nonzero allocations distinct', () => {
    expect(formatBoroAllocation('0')).toBe('0 $BORO')
    expect(formatBoroAllocation('1')).toBe('0.000000000000000001 $BORO')
  })
})
