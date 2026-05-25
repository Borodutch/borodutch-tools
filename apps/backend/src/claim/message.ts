import { createHash } from 'node:crypto'
import { DOMAIN, type SnapshotMetadata } from './types.ts'

export function buildClaimMessage(input: {
  chainName: string
  purpose: string
  tokenSymbol: string
  snapshot: SnapshotMetadata
  solanaAddress: string
  evmRecipient: string
  holderBdtchRaw: string
  claimAmountRaw: string
  nonce: string
}) {
  return [
    `${DOMAIN}`,
    '',
    `Purpose: ${input.purpose}`,
    `Solana wallet: ${input.solanaAddress}`,
    `EVM recipient: ${input.evmRecipient}`,
    `$bdtch mint: ${input.snapshot.mint}`,
    `Snapshot id: ${input.snapshot.id}`,
    `Helius indexed slot: ${input.snapshot.heliusLastIndexedSlot}`,
    `Finalized slot range: ${input.snapshot.finalizedSlotStart}-${input.snapshot.finalizedSlotEnd}`,
    `$bdtch holder raw balance: ${input.holderBdtchRaw}`,
    `$bdtch snapshot supply raw: ${input.snapshot.supplyRaw}`,
    `${input.tokenSymbol} claim amount raw: ${input.claimAmountRaw}`,
    `Nonce: ${input.nonce}`,
    '',
    `Signing this message authorizes the centralized backend to send this ${input.chainName} ${input.tokenSymbol} claim to the EVM recipient above. It does not grant token approvals or custody of your Solana assets.`,
  ].join('\n')
}

export function buildAllocationCheckMessage(input: {
  chainName: string
  tokenSymbol: string
  snapshot: SnapshotMetadata
  solanaAddress: string
}) {
  return [
    `${DOMAIN}`,
    '',
    `Purpose: Check ${input.chainName} ${input.tokenSymbol} allocation`,
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
