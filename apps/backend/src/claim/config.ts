import { base, baseSepolia, type Chain } from 'viem/chains'

export type ClaimRuntimeEnv = Record<string, string | undefined>

export type ClaimRuntimeConfig = {
  mode: 'boro-mainnet' | 'testnet'
  chain: Chain
  chainId: number
  chainName: string
  claimPoolRawEnv: string
  disabledReason: string
  privateKeyEnv: string
  purpose: string
  rpcUrlEnv: string
  tokenAddressEnv: string
  tokenName: string
  tokenSymbol: string
}

export const BASE_MAINNET_CHAIN_ID = 8453
export const BASE_SEPOLIA_CHAIN_ID = 84532

export const boroMainnetClaimConfig: ClaimRuntimeConfig = {
  mode: 'boro-mainnet',
  chain: base,
  chainId: BASE_MAINNET_CHAIN_ID,
  chainName: 'Base mainnet',
  claimPoolRawEnv: 'BORO_CLAIM_POOL_RAW',
  disabledReason: 'Base mainnet BORO claims are not fully configured in this deployment.',
  privateKeyEnv: 'BORO_CLAIM_SENDER_PRIVATE_KEY',
  purpose: 'Base mainnet $BORO claim',
  rpcUrlEnv: 'BASE_MAINNET_RPC_URL',
  tokenAddressEnv: 'BASE_MAINNET_BORO_ADDRESS',
  tokenName: 'BORO',
  tokenSymbol: '$BORO',
}

export const legacyTestnetClaimConfig: ClaimRuntimeConfig = {
  mode: 'testnet',
  chain: baseSepolia,
  chainId: BASE_SEPOLIA_CHAIN_ID,
  chainName: 'Base Sepolia',
  claimPoolRawEnv: 'TESTCOIN_CLAIM_POOL_RAW',
  disabledReason: 'Base Sepolia testnet claims are disabled in this deployment.',
  privateKeyEnv: 'BASE_SEPOLIA_AIRDROP_PRIVATE_KEY',
  purpose: 'Base Sepolia $testcoin claim',
  rpcUrlEnv: 'BASE_SEPOLIA_RPC_URL',
  tokenAddressEnv: 'BASE_SEPOLIA_TESTCOIN_ADDRESS',
  tokenName: 'testcoin',
  tokenSymbol: '$testcoin',
}

export function getClaimRuntimeConfig(env: ClaimRuntimeEnv): ClaimRuntimeConfig {
  return getTestnetClaimsEnabled(env) ? legacyTestnetClaimConfig : boroMainnetClaimConfig
}

export function getTestnetClaimsEnabled(env: ClaimRuntimeEnv) {
  return truthyEnv(env.ENABLE_TESTNET_CLAIMS)
}

export function getMissingRuntimeEnv(env: ClaimRuntimeEnv, config = getClaimRuntimeConfig(env)) {
  const missing: string[] = []

  if (!env.DATABASE_URL) {
    missing.push('DATABASE_URL')
  }

  for (const name of [config.rpcUrlEnv, config.tokenAddressEnv, config.privateKeyEnv, config.claimPoolRawEnv]) {
    if (!env[name]) {
      missing.push(name)
    }
  }

  return missing
}

export function getInvalidRuntimeEnv(env: ClaimRuntimeEnv, config = getClaimRuntimeConfig(env)) {
  const invalid: string[] = []
  const tokenAddress = env[config.tokenAddressEnv]
  const privateKey = env[config.privateKeyEnv]
  const claimPoolRaw = env[config.claimPoolRawEnv]

  if (tokenAddress && !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
    invalid.push(config.tokenAddressEnv)
  }

  if (privateKey) {
    const normalizedPrivateKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`
    if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedPrivateKey)) {
      invalid.push(config.privateKeyEnv)
    }
  }

  if (claimPoolRaw && !/^[1-9]\d*$/.test(claimPoolRaw)) {
    invalid.push(config.claimPoolRawEnv)
  }

  return invalid
}

function truthyEnv(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '')
}
