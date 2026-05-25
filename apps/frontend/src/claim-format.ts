export const BORO_DECIMALS = 18
export const BORO_SYMBOL = '$BORO'

export function formatBoroAllocation(rawAmount: string): string {
  const formatted = formatUnits(BigInt(rawAmount), BORO_DECIMALS)

  return `${formatted} ${BORO_SYMBOL}`
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
