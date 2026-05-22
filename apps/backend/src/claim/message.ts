import { createHash } from 'node:crypto'
import { DOMAIN, PURPOSE, type SnapshotMetadata } from './types.ts'

export function buildClaimMessage(input: {
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
    `Purpose: ${PURPOSE}`,
    `Solana wallet: ${input.solanaAddress}`,
    `EVM recipient: ${input.evmRecipient}`,
    `$bdtch mint: ${input.snapshot.mint}`,
    `Snapshot id: ${input.snapshot.id}`,
    `Helius indexed slot: ${input.snapshot.heliusLastIndexedSlot}`,
    `Finalized slot range: ${input.snapshot.finalizedSlotStart}-${input.snapshot.finalizedSlotEnd}`,
    `$bdtch holder raw balance: ${input.holderBdtchRaw}`,
    `$bdtch snapshot supply raw: ${input.snapshot.supplyRaw}`,
    `$testcoin claim amount raw: ${input.claimAmountRaw}`,
    `Nonce: ${input.nonce}`,
    '',
    'Signing this message authorizes the centralized backend to send this Base Sepolia $testcoin claim to the EVM recipient above. It does not grant token approvals or custody of your Solana assets.',
  ].join('\n')
}

export function digestMessage(message: string) {
  return createHash('sha256').update(message, 'utf8').digest('hex')
}
