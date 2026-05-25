import { createHash } from 'node:crypto'
import { BORO_MAINNET_CLAIM_CONFIG, DOMAIN, type ClaimRuntimeConfig, type SnapshotMetadata } from './types.ts'

export function buildClaimMessage(input: {
  snapshot: SnapshotMetadata
  solanaAddress: string
  evmRecipient: string
  holderBdtchRaw: string
  claimAmountRaw: string
  nonce: string
  claimConfig?: ClaimRuntimeConfig
}) {
  const claimConfig = input.claimConfig ?? BORO_MAINNET_CLAIM_CONFIG

  return [
    `${DOMAIN}`,
    '',
    `Purpose: ${claimConfig.purpose}`,
    `Solana wallet: ${input.solanaAddress}`,
    `EVM recipient: ${input.evmRecipient}`,
    `$bdtch mint: ${input.snapshot.mint}`,
    `Snapshot id: ${input.snapshot.id}`,
    `Helius indexed slot: ${input.snapshot.heliusLastIndexedSlot}`,
    `Finalized slot range: ${input.snapshot.finalizedSlotStart}-${input.snapshot.finalizedSlotEnd}`,
    `$bdtch holder raw balance: ${input.holderBdtchRaw}`,
    `$bdtch snapshot supply raw: ${input.snapshot.supplyRaw}`,
    `${claimConfig.tokenSymbol} claim amount raw: ${input.claimAmountRaw}`,
    `Nonce: ${input.nonce}`,
    '',
    `Signing this message authorizes the centralized backend to send this ${claimConfig.networkName} ${claimConfig.tokenSymbol} claim to the EVM recipient above. It does not grant token approvals or custody of your Solana assets.`,
  ].join('\n')
}

export function buildAllocationCheckMessage(input: {
  snapshot: SnapshotMetadata
  solanaAddress: string
  claimConfig?: ClaimRuntimeConfig
}) {
  const claimConfig = input.claimConfig ?? BORO_MAINNET_CLAIM_CONFIG

  return [
    `${DOMAIN}`,
    '',
    `Purpose: Check ${claimConfig.networkName} ${claimConfig.tokenSymbol} allocation`,
    `Solana wallet: ${input.solanaAddress}`,
    `$bdtch mint: ${input.snapshot.mint}`,
    `Snapshot id: ${input.snapshot.id}`,
    `Helius indexed slot: ${input.snapshot.heliusLastIndexedSlot}`,
    '',
    'Signing this message proves wallet ownership for an allocation lookup. It does not claim tokens, approve transfers, or grant custody of your Solana assets.',
  ].join('\n')
}

export function digestMessage(message: string) {
  return createHash('sha256').update(message, 'utf8').digest('hex')
}
