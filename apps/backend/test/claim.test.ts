import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import { describe, expect, it, vi } from 'vitest'
import { calculateClaimAmountRaw } from '../src/claim/math.ts'
import { buildAllocationCheckMessage, buildClaimMessage } from '../src/claim/message.ts'
import { MemoryClaimStore } from '../src/claim/memoryStore.ts'
import { verifySolanaSignature } from '../src/claim/signature.ts'
import { ClaimService } from '../src/claim/service.ts'
import { snapshotMetadata } from '../src/claim/snapshot.ts'
import type { TokenSender } from '../src/claim/types.ts'
import { normalizeEvmAddress } from '../src/claim/validation.ts'

describe('claim math', () => {
  it('uses integer floor math for proportional allocations', () => {
    expect(
      calculateClaimAmountRaw({
        claimPoolRaw: 1000n,
        holderBdtchRaw: 333n,
        snapshotSupplyRaw: 1000n,
      }),
    ).toBe(333n)

    expect(
      calculateClaimAmountRaw({
        claimPoolRaw: 10n,
        holderBdtchRaw: 1n,
        snapshotSupplyRaw: 3n,
      }),
    ).toBe(3n)
  })
})

describe('validation and signature binding', () => {
  it('normalizes EVM recipient addresses', () => {
    expect(normalizeEvmAddress('0x000000000000000000000000000000000000dead')).toBe(
      '0x000000000000000000000000000000000000dEaD',
    )
  })

  it('verifies only the exact Solana wallet and message bytes', () => {
    const wallet = Keypair.generate()
    const otherWallet = Keypair.generate()
    const message = buildClaimMessage({
      snapshot: snapshotMetadata,
      solanaAddress: wallet.publicKey.toBase58(),
      evmRecipient: '0x000000000000000000000000000000000000dEaD',
      holderBdtchRaw: '10',
      claimAmountRaw: '1',
      nonce: 'nonce',
    })
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey))

    expect(
      verifySolanaSignature({
        solanaAddress: wallet.publicKey.toBase58(),
        message,
        signatureBase58: signature,
      }),
    ).toBe(true)
    expect(
      verifySolanaSignature({
        solanaAddress: otherWallet.publicKey.toBase58(),
        message,
        signatureBase58: signature,
      }),
    ).toBe(false)
    expect(
      verifySolanaSignature({
        solanaAddress: wallet.publicKey.toBase58(),
        message: message.replace('dEaD', '0000'),
        signatureBase58: signature,
      }),
    ).toBe(false)
  })

  it('verifies allocation-check signatures before returning allocation data', async () => {
    const store = new MemoryClaimStore()
    const service = new ClaimService(store, mockSender('0xabc'), 1000000n)
    const wallet = Keypair.generate()
    const holderAddress = wallet.publicKey.toBase58()

    seedHolder(store, holderAddress)
    const message = buildAllocationCheckMessage({
      snapshot: snapshotMetadata,
      solanaAddress: holderAddress,
    })
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), wallet.secretKey))
    const allocation = await service.checkAllocation({
      solanaAddress: holderAddress,
      signatureBase58: signature,
    })

    expect(allocation.eligible).toBe(true)
    await expect(
      service.checkAllocation({
        solanaAddress: holderAddress,
        signatureBase58: bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), Keypair.generate().secretKey)),
      }),
    ).rejects.toMatchObject({ code: 'invalid_signature' })
  })
})

describe('claim service', () => {
  it('rejects nonce replay and already-claimed Solana wallets', async () => {
    const store = new MemoryClaimStore()
    const sender = mockSender('0xabc')
    const service = new ClaimService(store, sender, 1000000n)
    const wallet = Keypair.generate()
    const holderAddress = wallet.publicKey.toBase58()

    seedHolder(store, holderAddress)
    const challenge = await service.createChallenge({
      solanaAddress: holderAddress,
      evmRecipient: '0x000000000000000000000000000000000000dEaD',
    })
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey))

    await service.submitClaim({
      challengeId: challenge.challengeId,
      solanaAddress: holderAddress,
      evmRecipient: '0x000000000000000000000000000000000000dEaD',
      signatureBase58: signature,
    })

    await expect(
      service.createChallenge({
        solanaAddress: holderAddress,
        evmRecipient: '0x0000000000000000000000000000000000000001',
      }),
    ).rejects.toMatchObject({ code: 'already_claimed' })
  })

  it('does not send twice for concurrent duplicate submissions', async () => {
    const store = new MemoryClaimStore()
    const sender = mockSender('0xabc')
    const service = new ClaimService(store, sender, 1000000n)
    const wallet = Keypair.generate()
    const holderAddress = wallet.publicKey.toBase58()

    seedHolder(store, holderAddress)
    const challenge = await service.createChallenge({
      solanaAddress: holderAddress,
      evmRecipient: '0x000000000000000000000000000000000000dEaD',
    })
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey))
    const submit = {
      challengeId: challenge.challengeId,
      solanaAddress: holderAddress,
      evmRecipient: '0x000000000000000000000000000000000000dEaD',
      signatureBase58: signature,
    }

    const results = await Promise.all([service.submitClaim(submit), service.submitClaim(submit)])

    expect(results.some((result) => result.claim.txHash === '0xabc')).toBe(true)
    expect(sender.sendTestcoin).toHaveBeenCalledTimes(1)
  })
})

function mockSender(txHash: string): TokenSender {
  return {
    sendTestcoin: vi.fn(async () => txHash),
  }
}

function seedHolder(store: MemoryClaimStore, owner: string) {
  const holder = store.getHolder('8FJG8Am7X7kD69nDs3v4f5pBJkVahp39MQvvUuB2Kk4A')

  if (!holder) {
    throw new Error('snapshot fixture holder missing')
  }

  const holdersMap = store as unknown as { getHolder(address: string): typeof holder | undefined }
  vi.spyOn(holdersMap, 'getHolder').mockImplementation((address: string) => {
    if (address === owner) {
      return { ...holder, owner }
    }

    return undefined
  })
}
