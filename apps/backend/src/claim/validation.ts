import { PublicKey } from '@solana/web3.js'
import { isAddress, getAddress } from 'viem'

export function normalizeSolanaAddress(value: unknown) {
  if (typeof value !== 'string' || value.length > 64) {
    throw new Error('invalid Solana address')
  }

  try {
    return new PublicKey(value).toBase58()
  } catch {
    throw new Error('invalid Solana address')
  }
}

export function normalizeEvmAddress(value: unknown) {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error('invalid EVM recipient address')
  }

  return getAddress(value)
}
