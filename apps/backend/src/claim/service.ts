import { randomBytes, randomUUID } from 'node:crypto'
import { calculateClaimAmountRaw, parsePositiveRawAmount } from './math.ts'
import { buildAllocationCheckMessage, buildClaimMessage, digestMessage } from './message.ts'
import { verifySolanaSignatureDetailed } from './signature.ts'
import {
  BORO_MAINNET_CLAIM_CONFIG,
  DOMAIN,
  type ClaimRuntimeConfig,
  type ClaimRecord,
  type ClaimStore,
  type TokenSender,
} from './types.ts'
import { normalizeEvmAddress, normalizeSolanaAddress } from './validation.ts'

const challengeTtlMs = 15 * 60 * 1000

export class ClaimService {
  constructor(
    private readonly store: ClaimStore,
    private readonly sender: TokenSender,
    private readonly claimPoolRaw: bigint,
    private readonly claimConfig: ClaimRuntimeConfig = BORO_MAINNET_CLAIM_CONFIG,
  ) {}

  getConfig(missingRuntimeEnv: string[]) {
    const snapshot = this.store.getSnapshot()

    return {
      app: DOMAIN,
      purpose: this.claimConfig.purpose,
      enabled: missingRuntimeEnv.length === 0,
      network: this.claimConfig.networkName,
      tokenSymbol: this.claimConfig.tokenSymbol,
      chainId: this.claimConfig.chainId,
      snapshot,
      claimPoolRaw: this.claimPoolRaw.toString(),
      missingRuntimeEnv,
    }
  }

  async getAllocation(solanaAddressInput: unknown) {
    const solanaAddress = normalizeSolanaAddress(solanaAddressInput)
    const holder = this.store.getHolder(solanaAddress)
    const existingClaim = await this.store.getClaimBySolana(solanaAddress)

    if (!holder) {
      return { eligible: false, solanaAddress, existingClaim: serializeClaim(existingClaim) }
    }

    const claimAmountRaw = calculateClaimAmountRaw({
      claimPoolRaw: this.claimPoolRaw,
      holderBdtchRaw: BigInt(holder.amountRaw),
      snapshotSupplyRaw: BigInt(this.store.getSnapshot().supplyRaw),
    })

    return {
      eligible: claimAmountRaw > 0n,
      solanaAddress,
      holder,
      claimAmountRaw: claimAmountRaw.toString(),
      snapshot: this.store.getSnapshot(),
      existingClaim: serializeClaim(existingClaim),
    }
  }

  getAllocationCheckMessage(solanaAddressInput: unknown) {
    const solanaAddress = normalizeSolanaAddress(solanaAddressInput)
    const message = buildAllocationCheckMessage({
      snapshot: this.store.getSnapshot(),
      solanaAddress,
      claimConfig: this.claimConfig,
    })

    return {
      solanaAddress,
      message,
      messageDigest: digestMessage(message),
    }
  }

  async checkAllocation(input: { solanaAddress: unknown; signatureBase58: unknown; diagnostics?: unknown }) {
    if (typeof input.signatureBase58 !== 'string' || input.signatureBase58.length < 32) {
      throw new ClaimError('invalid_signature', 'Signature is required.')
    }

    const { solanaAddress, message } = this.getAllocationCheckMessage(input.solanaAddress)

    const verification = verifySolanaSignatureDetailed({
      solanaAddress,
      message,
      signatureBase58: input.signatureBase58,
    })

    if (!verification.valid) {
      logSignatureVerificationFailure('allocation-check', solanaAddress, message, verification, input.diagnostics)
      throw new ClaimError('invalid_signature', 'Solana signature does not verify for this allocation check.')
    }

    return this.getAllocation(solanaAddress)
  }

  async createChallenge(input: { solanaAddress: unknown; evmRecipient: unknown }) {
    const solanaAddress = normalizeSolanaAddress(input.solanaAddress)
    const evmRecipient = normalizeEvmAddress(input.evmRecipient)
    const holder = this.store.getHolder(solanaAddress)

    if (!holder) {
      throw new ClaimError('not_eligible', 'Solana wallet is not eligible in the $bdtch snapshot.')
    }

    const [existingSolanaClaim, existingRecipientClaim] = await Promise.all([
      this.store.getClaimBySolana(solanaAddress),
      this.store.getClaimByRecipient(evmRecipient),
    ])

    if (existingSolanaClaim) {
      throw new ClaimError('already_claimed', 'This Solana wallet already has a claim.', serializeClaim(existingSolanaClaim))
    }

    if (existingRecipientClaim) {
      throw new ClaimError('recipient_already_used', 'This EVM recipient was already used for a claim.')
    }

    const claimAmountRaw = calculateClaimAmountRaw({
      claimPoolRaw: this.claimPoolRaw,
      holderBdtchRaw: BigInt(holder.amountRaw),
      snapshotSupplyRaw: BigInt(this.store.getSnapshot().supplyRaw),
    })

    if (claimAmountRaw <= 0n) {
      throw new ClaimError('zero_allocation', `This wallet has a zero ${this.claimConfig.tokenSymbol} allocation.`)
    }

    const nonce = randomBytes(18).toString('hex')
    const message = buildClaimMessage({
      snapshot: this.store.getSnapshot(),
      solanaAddress,
      evmRecipient,
      holderBdtchRaw: holder.amountRaw,
      claimAmountRaw: claimAmountRaw.toString(),
      nonce,
      claimConfig: this.claimConfig,
    })

    const challenge = await this.store.createChallenge({
      id: randomUUID(),
      nonce,
      solanaAddress,
      evmRecipient,
      holderBdtchRaw: holder.amountRaw,
      claimAmountRaw: claimAmountRaw.toString(),
      message,
      messageDigest: digestMessage(message),
      expiresAt: new Date(Date.now() + challengeTtlMs),
    })

    return {
      challengeId: challenge.id,
      solanaAddress,
      evmRecipient,
      claimAmountRaw: challenge.claimAmountRaw,
      holderBdtchRaw: challenge.holderBdtchRaw,
      expiresAt: challenge.expiresAt.toISOString(),
      message: challenge.message,
      messageDigest: challenge.messageDigest,
    }
  }

  async submitClaim(input: {
    challengeId: unknown
    solanaAddress: unknown
    evmRecipient: unknown
    signatureBase58: unknown
    diagnostics?: unknown
  }) {
    if (typeof input.challengeId !== 'string') {
      throw new ClaimError('invalid_challenge', 'Challenge id is required.')
    }

    if (typeof input.signatureBase58 !== 'string' || input.signatureBase58.length < 32) {
      throw new ClaimError('invalid_signature', 'Signature is required.')
    }

    const solanaAddress = normalizeSolanaAddress(input.solanaAddress)
    const evmRecipient = normalizeEvmAddress(input.evmRecipient)
    const challenge = await this.store.getChallenge(input.challengeId)

    if (!challenge) {
      throw new ClaimError('invalid_challenge', 'Claim challenge was not found.')
    }

    if (challenge.usedAt || challenge.expiresAt.getTime() < Date.now()) {
      throw new ClaimError('expired_challenge', 'Claim challenge expired. Create a new message and sign again.')
    }

    if (challenge.solanaAddress !== solanaAddress || challenge.evmRecipient !== evmRecipient) {
      throw new ClaimError('challenge_mismatch', 'Signed challenge does not match the submitted wallet or recipient.')
    }

    const verification = verifySolanaSignatureDetailed({
      solanaAddress,
      message: challenge.message,
      signatureBase58: input.signatureBase58,
    })

    if (!verification.valid) {
      logSignatureVerificationFailure('claim-submit', solanaAddress, challenge.message, verification, input.diagnostics)
      throw new ClaimError('invalid_signature', 'Solana signature does not verify for this message and wallet.')
    }

    const pending = await this.store.createPendingClaim({
      id: randomUUID(),
      challengeId: challenge.id,
      nonce: challenge.nonce,
      solanaAddress,
      evmRecipient,
      holderBdtchRaw: challenge.holderBdtchRaw,
      claimAmountRaw: challenge.claimAmountRaw,
      messageDigest: challenge.messageDigest,
      signatureBase58: input.signatureBase58,
      txHash: null,
      status: 'pending',
      errorCode: null,
    })

    await this.store.markChallengeUsed(challenge.id)

    if (!pending.inserted) {
      return { claim: serializeClaim(pending.claim)!, idempotent: true }
    }

    try {
      const txHash = await this.sender.sendToken({
        recipient: evmRecipient,
        amountRaw: BigInt(challenge.claimAmountRaw),
        idempotencyKey: pending.claim.id,
      })
      const claim = await this.store.updateClaimSent(pending.claim.id, txHash)
      return { claim: serializeClaim(claim)!, idempotent: false }
    } catch (error) {
      const claim = await this.store.updateClaimFailed(pending.claim.id, 'chain_send_failed', txHashFromError(error))
      throw new ClaimError(
        'chain_send_failed',
        `The claim was recorded but the ${this.claimConfig.networkName} transfer failed. It can be retried by an admin.`,
        serializeClaim(claim),
      )
    }
  }

  async retryFailedClaim(input: { claimId: unknown; allowMissingTxRetry?: boolean }) {
    if (typeof input.claimId !== 'string' || input.claimId.length === 0) {
      throw new ClaimError('invalid_claim', 'Claim id is required.')
    }

    const existing = await this.store.getClaimById(input.claimId)

    if (!existing) {
      throw new ClaimError('claim_not_found', 'Claim was not found.')
    }

    if (existing.status !== 'failed') {
      throw new ClaimError('claim_retry_not_failed', 'Only failed claims can be retried by an admin.', serializeClaim(existing))
    }

    const recoveryState = await this.sender.getTransferRecoveryState({
      recipient: existing.evmRecipient,
      amountRaw: BigInt(existing.claimAmountRaw),
      txHash: existing.txHash,
    })

    if (existing.txHash && recoveryState.txStatus === 'success') {
      const claim = await this.store.updateClaimSent(existing.id, existing.txHash)
      return { claim: serializeClaim(claim)!, recovered: true }
    }

    if (recoveryState.recipientBalanceCoversAmount) {
      const claim = await this.store.updateClaimConfirmed(existing.id, existing.txHash)
      return { claim: serializeClaim(claim)!, recovered: true }
    }

    if (recoveryState.txStatus === 'pending') {
      throw new ClaimError(
        'claim_retry_tx_unconfirmed',
        'The recorded transfer transaction is still pending. Retry is blocked to avoid a duplicate send.',
        { claim: serializeClaim(existing), recoveryState },
      )
    }

    if (recoveryState.txStatus === 'not_found' && !input.allowMissingTxRetry) {
      throw new ClaimError(
        'claim_retry_tx_unconfirmed',
        'The recorded transfer transaction was not found. Retry requires allowMissingTxRetry after admin verification.',
        { claim: serializeClaim(existing), recoveryState },
      )
    }

    const claimToRetry = await this.store.prepareClaimRetry(existing.id)

    if (!claimToRetry) {
      throw new ClaimError('claim_retry_not_failed', 'Only failed claims can be retried by an admin.', serializeClaim(existing))
    }

    try {
      const txHash = await this.sender.sendToken({
        recipient: claimToRetry.evmRecipient,
        amountRaw: BigInt(claimToRetry.claimAmountRaw),
        idempotencyKey: claimToRetry.id,
      })
      const claim = await this.store.updateClaimSent(claimToRetry.id, txHash)
      return { claim: serializeClaim(claim)! }
    } catch (error) {
      const claim = await this.store.updateClaimFailed(claimToRetry.id, 'chain_send_failed', txHashFromError(error))
      throw new ClaimError(
        'chain_send_failed',
        `The admin retry was recorded, but the ${this.claimConfig.networkName} transfer failed.`,
        serializeClaim(claim),
      )
    }
  }
}

export class ClaimError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

function logSignatureVerificationFailure(
  phase: 'allocation-check' | 'claim-submit',
  solanaAddress: string,
  message: string,
  verification: ReturnType<typeof verifySolanaSignatureDetailed>,
  diagnostics: unknown,
) {
  const clientDiagnostics = parseSignatureDiagnostics(diagnostics)
  console.warn(
    JSON.stringify({
      event: 'solana_signature_verification_failed',
      phase,
      solanaAddress,
      messageDigest: digestMessage(message),
      clientDiagnostics,
      ...verification,
    }),
  )
}

function parseSignatureDiagnostics(diagnostics: unknown) {
  if (!diagnostics || typeof diagnostics !== 'object') return undefined

  const value = diagnostics as Record<string, unknown>
  return {
    client: typeof value.client === 'string' ? value.client.slice(0, 80) : undefined,
    messageDigest: typeof value.messageDigest === 'string' ? value.messageDigest : undefined,
    signatureByteLength: typeof value.signatureByteLength === 'number' ? value.signatureByteLength : undefined,
    walletLabel: typeof value.walletLabel === 'string' ? value.walletLabel.slice(0, 80) : undefined,
  }
}

export function createClaimService(input: {
  store: ClaimStore
  sender: TokenSender
  env: Record<string, string | undefined>
  claimConfig?: ClaimRuntimeConfig
}) {
  const claimConfig = input.claimConfig ?? BORO_MAINNET_CLAIM_CONFIG

  return new ClaimService(
    input.store,
    input.sender,
    parsePositiveRawAmount(input.env[claimConfig.poolEnvName], claimConfig.poolEnvName),
    claimConfig,
  )
}

function serializeClaim(claim: ClaimRecord | undefined) {
  if (!claim) {
    return undefined
  }

  return {
    id: claim.id,
    solanaAddress: claim.solanaAddress,
    evmRecipient: claim.evmRecipient,
    claimAmountRaw: claim.claimAmountRaw,
    status: claim.status,
    txHash: claim.txHash,
    errorCode: claim.errorCode,
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
  }
}

function txHashFromError(error: unknown) {
  if (typeof error === 'object' && error !== null && 'txHash' in error && typeof error.txHash === 'string') {
    return error.txHash
  }

  return undefined
}
