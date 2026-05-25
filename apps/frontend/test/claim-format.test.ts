import { describe, expect, it } from 'bun:test'
import { formatTestcoinAllocation } from '../src/claim-format'

describe('claim allocation formatting', () => {
  it('formats raw $testcoin allocations with token decimals', () => {
    expect(formatTestcoinAllocation('1000000000000000000')).toBe('1 $testcoin')
    expect(formatTestcoinAllocation('1234500000000000000')).toBe('1.2345 $testcoin')
    expect(formatTestcoinAllocation('1000000000000000001')).toBe('1.000000000000000001 $testcoin')
    expect(formatTestcoinAllocation('1500000000000')).toBe('0.0000015 $testcoin')
    expect(formatTestcoinAllocation('123456789012345678901234567890')).toBe('123456789012.34567890123456789 $testcoin')
  })

  it('keeps zero and tiny nonzero allocations distinct', () => {
    expect(formatTestcoinAllocation('0')).toBe('0 $testcoin')
    expect(formatTestcoinAllocation('1')).toBe('0.000000000000000001 $testcoin')
  })
})
