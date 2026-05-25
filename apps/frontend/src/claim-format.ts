export const TESTCOIN_DECIMALS = 18
export const TESTCOIN_SYMBOL = '$testcoin'

export function formatTestcoinAllocation(rawAmount: string): string {
  const formatted = formatUnits(BigInt(rawAmount), TESTCOIN_DECIMALS)

  return `${formatted} ${TESTCOIN_SYMBOL}`
}

function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n
  const raw = negative ? -value : value
  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const fraction = raw % scale

  if (fraction === 0n) {
    return `${negative ? '-' : ''}${whole.toString()}`
  }

  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole.toString()}.${fractionText}`
}
