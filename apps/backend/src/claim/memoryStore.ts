import { holdersByOwner, snapshotMetadata } from './snapshot.ts'
import type {
  ClaimChallenge,
  ClaimRecord,
  ClaimStore,
  ExistingClaimResult,
  HolderAllocation,
  SnapshotMetadata,
} from './types.ts'

export class MemoryClaimStore implements ClaimStore {
  private readonly challenges = new Map<string, ClaimChallenge>()
  private readonly claims = new Map<string, ClaimRecord>()

  async initialize() {}

  getSnapshot(): SnapshotMetadata {
    return snapshotMetadata
  }

  getHolder(solanaAddress: string): HolderAllocation | undefined {
    return holdersByOwner.get(solanaAddress)
  }

  async getClaimById(id: string) {
    return this.claims.get(id)
  }

  async getClaimBySolana(solanaAddress: string) {
    return [...this.claims.values()].find((claim) => claim.solanaAddress === solanaAddress)
  }

  async getClaimByRecipient(evmRecipient: string) {
    return [...this.claims.values()].find((claim) => claim.evmRecipient === evmRecipient)
  }

  async createChallenge(input: Omit<ClaimChallenge, 'usedAt'>) {
    const challenge = { ...input, usedAt: null }
    this.challenges.set(challenge.id, challenge)
    return challenge
  }

  async getChallenge(id: string) {
    return this.challenges.get(id)
  }

  async markChallengeUsed(id: string) {
    const challenge = this.challenges.get(id)

    if (challenge) {
      this.challenges.set(id, { ...challenge, usedAt: new Date() })
    }
  }

  async createPendingClaim(input: Omit<ClaimRecord, 'createdAt' | 'updatedAt'>): Promise<ExistingClaimResult> {
    const existing = [...this.claims.values()].find(
      (claim) =>
        claim.solanaAddress === input.solanaAddress ||
        claim.evmRecipient === input.evmRecipient ||
        claim.challengeId === input.challengeId,
    )

    if (existing) {
      return { inserted: false, claim: existing }
    }

    const now = new Date()
    const claim = { ...input, createdAt: now, updatedAt: now }
    this.claims.set(claim.id, claim)
    return { inserted: true, claim }
  }

  async prepareClaimRetry(id: string) {
    const claim = this.claims.get(id)

    if (!claim || claim.status !== 'failed') {
      return undefined
    }

    const updated = { ...claim, txHash: null, status: 'pending' as const, errorCode: null, updatedAt: new Date() }
    this.claims.set(id, updated)
    return updated
  }

  async updateClaimSent(id: string, txHash: string) {
    const claim = this.claims.get(id)

    if (!claim) {
      throw new Error('claim not found')
    }

    const updated = { ...claim, txHash, status: 'sent' as const, errorCode: null, updatedAt: new Date() }
    this.claims.set(id, updated)
    return updated
  }

  async updateClaimFailed(id: string, errorCode: string, txHash?: string) {
    const claim = this.claims.get(id)

    if (!claim) {
      throw new Error('claim not found')
    }

    const updated = { ...claim, txHash: txHash ?? null, status: 'failed' as const, errorCode, updatedAt: new Date() }
    this.claims.set(id, updated)
    return updated
  }
}
