export function calculateClaimAmountRaw(input: {
  claimPoolRaw: bigint
  holderBdtchRaw: bigint
  snapshotSupplyRaw: bigint
}) {
  if (input.claimPoolRaw <= 0n) {
    throw new Error('claim pool must be positive')
  }

  if (input.holderBdtchRaw < 0n || input.snapshotSupplyRaw <= 0n) {
    throw new Error('invalid allocation inputs')
  }

  return (input.claimPoolRaw * input.holderBdtchRaw) / input.snapshotSupplyRaw
}

export function parsePositiveRawAmount(value: string | undefined, name: string) {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer raw token amount`)
  }

  return BigInt(value)
}

export function formatRawToken(raw: string | bigint, decimals: number) {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw)
  const divisor = 10n ** BigInt(decimals)
  const whole = value / divisor
  const fraction = value % divisor

  if (fraction === 0n) {
    return whole.toString()
  }

  return `${whole.toString()}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}
