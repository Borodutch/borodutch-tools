import { isConfiguredAddress } from './evm'

export const BASESCAN_ADDRESS_BASE_URL = 'https://basescan.org/address/'

export function configuredBoroTokenAddress(address: string | undefined): string | null {
  if (!address) return null

  const trimmed = address.trim()
  return isConfiguredAddress(trimmed) ? trimmed : null
}

export function boroTokenBasescanUrl(address: string): string {
  return `${BASESCAN_ADDRESS_BASE_URL}${address}`
}
