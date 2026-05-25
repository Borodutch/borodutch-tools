export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export type BoroLaunchConfig = {
  tokenAddress: string
  tokenConfigured: boolean
  tokenExplorerUrl: string
}

export function getBoroLaunchConfig(): BoroLaunchConfig {
  const tokenAddress = normalizedAddress(import.meta.env.VITE_BASE_MAINNET_BORO_ADDRESS ?? '')
  return {
    tokenAddress,
    tokenConfigured: isRealAddress(tokenAddress),
    tokenExplorerUrl: tokenAddress ? `https://basescan.org/token/${tokenAddress}` : '',
  }
}

export function isRealAddress(value: string): boolean {
  return isAddress(value) && value.toLowerCase() !== ZERO_ADDRESS
}

export function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim())
}

export function normalizedAddress(value: string): string {
  const trimmed = value.trim()
  return isAddress(trimmed) ? trimmed : ''
}

export function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}
