export const SNAPSHOT_ID = 'bdtch-2026-05-22-helius-421437667'
export const DOMAIN = 'Borodutch Tools'
export const PURPOSE = 'Base mainnet $BORO claim'
export const BASE_MAINNET_CHAIN_ID = 8453
export const BASE_SEPOLIA_CHAIN_ID = 84532

export type ClaimNetworkId = 'base-mainnet-boro' | 'base-sepolia-testcoin'

export type ClaimRuntimeConfig = {
  networkId: ClaimNetworkId
  networkName: string
  chainId: number
  purpose: string
  tokenSymbol: string
  poolEnvName: string
}

export const BORO_MAINNET_CLAIM_CONFIG: ClaimRuntimeConfig = {
  networkId: 'base-mainnet-boro',
  networkName: 'Base mainnet',
  chainId: BASE_MAINNET_CHAIN_ID,
  purpose: PURPOSE,
  tokenSymbol: '$BORO',
  poolEnvName: 'BORO_CLAIM_POOL_RAW',
}

export const LEGACY_TESTNET_CLAIM_CONFIG: ClaimRuntimeConfig = {
  networkId: 'base-sepolia-testcoin',
  networkName: 'Base Sepolia',
  chainId: BASE_SEPOLIA_CHAIN_ID,
  purpose: 'Base Sepolia $testcoin claim',
  tokenSymbol: '$testcoin',
  poolEnvName: 'TESTCOIN_CLAIM_POOL_RAW',
}

export type SnapshotMetadata = {
  id: string
  token: string
  mint: string
  decimals: number
  supplyRaw: string
  supply: string
  heliusLastIndexedSlot: number
  finalizedSlotStart: number
  finalizedSlotEnd: number
  startedAt: string
  completedAt: string
  uniqueHolders: number
}

export type HolderAllocation = {
  rank: number
  owner: string
  amountRaw: string
  amount: string
  tokenAccountCount: number
}

export type ClaimChallenge = {
  id: string
  nonce: string
  solanaAddress: string
  evmRecipient: string
  holderBdtchRaw: string
  claimAmountRaw: string
  message: string
  messageDigest: string
  expiresAt: Date
  usedAt: Date | null
}

export type ClaimStatus = 'pending' | 'sent' | 'confirmed' | 'failed'

export type ClaimRecord = {
  id: string
  challengeId: string
  nonce: string
  solanaAddress: string
  evmRecipient: string
  holderBdtchRaw: string
  claimAmountRaw: string
  messageDigest: string
  signatureBase58: string
  txHash: string | null
  status: ClaimStatus
  errorCode: string | null
  createdAt: Date
  updatedAt: Date
}

export type ExistingClaimResult = {
  inserted: boolean
  claim: ClaimRecord
}

export type ClaimStore = {
  initialize(): Promise<void>
  getSnapshot(): SnapshotMetadata
  getHolder(solanaAddress: string): HolderAllocation | undefined
  getClaimById(id: string): Promise<ClaimRecord | undefined>
  getClaimBySolana(solanaAddress: string): Promise<ClaimRecord | undefined>
  getClaimByRecipient(evmRecipient: string): Promise<ClaimRecord | undefined>
  createChallenge(input: Omit<ClaimChallenge, 'usedAt'>): Promise<ClaimChallenge>
  getChallenge(id: string): Promise<ClaimChallenge | undefined>
  markChallengeUsed(id: string): Promise<void>
  createPendingClaim(input: Omit<ClaimRecord, 'createdAt' | 'updatedAt'>): Promise<ExistingClaimResult>
  prepareClaimRetry(id: string): Promise<ClaimRecord | undefined>
  updateClaimSent(id: string, txHash: string): Promise<ClaimRecord>
  updateClaimConfirmed(id: string, txHash: string | null): Promise<ClaimRecord>
  updateClaimFailed(id: string, errorCode: string, txHash?: string): Promise<ClaimRecord>
}

export type TransferRecoveryState = {
  txStatus: 'success' | 'reverted' | 'pending' | 'not_found' | 'not_checked'
  recipientBalanceCoversAmount: boolean
}

export type TokenSender = {
  sendToken(input: { recipient: string; amountRaw: bigint; idempotencyKey: string }): Promise<string>
  getTransferRecoveryState(input: {
    recipient: string
    amountRaw: bigint
    txHash: string | null
  }): Promise<TransferRecoveryState>
}
