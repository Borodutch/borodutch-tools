import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'
import { describe, expect, it, vi } from 'vitest'
import { calculateClaimAmountRaw } from '../src/claim/math.ts'
import { buildAllocationCheckMessage, buildClaimMessage } from '../src/claim/message.ts'
import { MemoryClaimStore } from '../src/claim/memoryStore.ts'
import {
  getClaimRuntimeConfig,
  getLegacyTestnetClaimsEnabled,
  getMissingRuntimeEnv,
} from '../src/claim/chainSender.ts'
import { createClaimStore, getClaimRuntimeReady } from '../src/claim/runtime.ts'
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
    expect(sender.sendToken).toHaveBeenCalledTimes(1)
  })

  it('keeps the claim failed when a submitted transfer does not confirm', async () => {
    const store = new MemoryClaimStore()
    const sendError = Object.assign(new Error('reverted'), { txHash: '0xreverted' })
    const sender = {
      sendToken: vi.fn<TokenSender["sendToken"]>().mockRejectedValueOnce(sendError),
      getTransferRecoveryState: vi.fn<TokenSender['getTransferRecoveryState']>(),
    }
    const service = new ClaimService(store, sender, 1000000n)
    const wallet = Keypair.generate()
    const holderAddress = wallet.publicKey.toBase58()

    seedHolder(store, holderAddress)
    const challenge = await service.createChallenge({
      solanaAddress: holderAddress,
      evmRecipient: '0x000000000000000000000000000000000000dEaD',
    })
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey))

    await expect(
      service.submitClaim({
        challengeId: challenge.challengeId,
        solanaAddress: holderAddress,
        evmRecipient: '0x000000000000000000000000000000000000dEaD',
        signatureBase58: signature,
      }),
    ).rejects.toMatchObject({ code: 'chain_send_failed' })

    const failed = await store.getClaimBySolana(holderAddress)
    expect(failed).toMatchObject({
      status: 'failed',
      txHash: '0xreverted',
      errorCode: 'chain_send_failed',
    })
  })

  it('allows an admin to retry a failed claim without sending duplicates', async () => {
    const store = new MemoryClaimStore()
    const sendError = Object.assign(new Error('temporary rpc failure'), { txHash: '0xreverted' })
    const sender = {
      sendToken: vi
        .fn<TokenSender["sendToken"]>()
        .mockRejectedValueOnce(sendError)
        .mockImplementationOnce(async () => {
          const retrying = await store.getClaimBySolana(holderAddress)
          expect(retrying).toMatchObject({ status: 'pending', txHash: null, errorCode: null })
          return '0xretry'
        }),
      getTransferRecoveryState: vi.fn<TokenSender['getTransferRecoveryState']>().mockResolvedValue({
        txStatus: 'reverted',
        recipientBalanceCoversAmount: false,
      }),
    }
    const service = new ClaimService(store, sender, 1000000n)
    const wallet = Keypair.generate()
    const holderAddress = wallet.publicKey.toBase58()

    seedHolder(store, holderAddress)
    const challenge = await service.createChallenge({
      solanaAddress: holderAddress,
      evmRecipient: '0x000000000000000000000000000000000000dEaD',
    })
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey))

    await expect(
      service.submitClaim({
        challengeId: challenge.challengeId,
        solanaAddress: holderAddress,
        evmRecipient: '0x000000000000000000000000000000000000dEaD',
        signatureBase58: signature,
      }),
    ).rejects.toMatchObject({ code: 'chain_send_failed' })

    const failed = await store.getClaimBySolana(holderAddress)
    expect(failed?.status).toBe('failed')

    const retry = await service.retryFailedClaim({ claimId: failed?.id })

    expect(retry.claim).toMatchObject({
      id: failed?.id,
      status: 'sent',
      txHash: '0xretry',
      errorCode: null,
    })
    expect(sender.sendToken).toHaveBeenCalledTimes(2)
    expect(sender.sendToken).toHaveBeenLastCalledWith({
      recipient: normalizeEvmAddress('0x000000000000000000000000000000000000dEaD'),
      amountRaw: BigInt(challenge.claimAmountRaw),
      idempotencyKey: failed?.id,
    })
  })

  it('recovers a failed claim without resending when the recorded transaction succeeded', async () => {
    const store = new MemoryClaimStore()
    const sendError = Object.assign(new Error('timeout after accept'), { txHash: '0xaccepted' })
    const sender = {
      sendToken: vi.fn<TokenSender["sendToken"]>().mockRejectedValueOnce(sendError),
      getTransferRecoveryState: vi.fn<TokenSender['getTransferRecoveryState']>().mockResolvedValue({
        txStatus: 'success',
        recipientBalanceCoversAmount: false,
      }),
    }
    const service = new ClaimService(store, sender, 1000000n)
    const wallet = Keypair.generate()
    const holderAddress = wallet.publicKey.toBase58()

    seedHolder(store, holderAddress)
    const challenge = await service.createChallenge({
      solanaAddress: holderAddress,
      evmRecipient: '0x000000000000000000000000000000000000dEaD',
    })
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey))

    await expect(
      service.submitClaim({
        challengeId: challenge.challengeId,
        solanaAddress: holderAddress,
        evmRecipient: '0x000000000000000000000000000000000000dEaD',
        signatureBase58: signature,
      }),
    ).rejects.toMatchObject({ code: 'chain_send_failed' })

    const failed = await store.getClaimBySolana(holderAddress)
    const retry = await service.retryFailedClaim({ claimId: failed?.id })

    expect(retry).toMatchObject({
      recovered: true,
      claim: { id: failed?.id, status: 'sent', txHash: '0xaccepted', errorCode: null },
    })
    expect(sender.sendToken).toHaveBeenCalledTimes(1)
  })

  it('blocks missing recorded transaction retry unless the admin explicitly allows it', async () => {
    const store = new MemoryClaimStore()
    const sendError = Object.assign(new Error('dropped after accept'), { txHash: '0xdropped' })
    const sender = {
      sendToken: vi
        .fn<TokenSender["sendToken"]>()
        .mockRejectedValueOnce(sendError)
        .mockResolvedValueOnce('0xretry'),
      getTransferRecoveryState: vi.fn<TokenSender['getTransferRecoveryState']>().mockResolvedValue({
        txStatus: 'not_found',
        recipientBalanceCoversAmount: false,
      }),
    }
    const service = new ClaimService(store, sender, 1000000n)
    const wallet = Keypair.generate()
    const holderAddress = wallet.publicKey.toBase58()

    seedHolder(store, holderAddress)
    const challenge = await service.createChallenge({
      solanaAddress: holderAddress,
      evmRecipient: '0x000000000000000000000000000000000000dEaD',
    })
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey))

    await expect(
      service.submitClaim({
        challengeId: challenge.challengeId,
        solanaAddress: holderAddress,
        evmRecipient: '0x000000000000000000000000000000000000dEaD',
        signatureBase58: signature,
      }),
    ).rejects.toMatchObject({ code: 'chain_send_failed' })

    const failed = await store.getClaimBySolana(holderAddress)
    await expect(service.retryFailedClaim({ claimId: failed?.id })).rejects.toMatchObject({
      code: 'claim_retry_tx_unconfirmed',
    })

    const retry = await service.retryFailedClaim({ claimId: failed?.id, allowMissingTxRetry: true })
    expect(retry.claim).toMatchObject({ id: failed?.id, status: 'sent', txHash: '0xretry' })
    expect(sender.sendToken).toHaveBeenCalledTimes(2)
  })

  it('recovers without resending when the recipient balance already covers the claim', async () => {
    const store = new MemoryClaimStore()
    const sender = {
      sendToken: vi.fn<TokenSender["sendToken"]>().mockRejectedValueOnce(new Error('rpc timeout')),
      getTransferRecoveryState: vi.fn<TokenSender['getTransferRecoveryState']>().mockResolvedValue({
        txStatus: 'not_checked',
        recipientBalanceCoversAmount: true,
      }),
    }
    const service = new ClaimService(store, sender, 1000000n)
    const wallet = Keypair.generate()
    const holderAddress = wallet.publicKey.toBase58()

    seedHolder(store, holderAddress)
    const challenge = await service.createChallenge({
      solanaAddress: holderAddress,
      evmRecipient: '0x000000000000000000000000000000000000dEaD',
    })
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey))

    await expect(
      service.submitClaim({
        challengeId: challenge.challengeId,
        solanaAddress: holderAddress,
        evmRecipient: '0x000000000000000000000000000000000000dEaD',
        signatureBase58: signature,
      }),
    ).rejects.toMatchObject({ code: 'chain_send_failed' })

    const failed = await store.getClaimBySolana(holderAddress)
    const retry = await service.retryFailedClaim({ claimId: failed?.id })

    expect(retry).toMatchObject({
      recovered: true,
      claim: { id: failed?.id, status: 'confirmed', txHash: null, errorCode: null },
    })
    expect(sender.sendToken).toHaveBeenCalledTimes(1)
  })

  it('rejects admin retry for claims that are not failed', async () => {
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
    const result = await service.submitClaim({
      challengeId: challenge.challengeId,
      solanaAddress: holderAddress,
      evmRecipient: '0x000000000000000000000000000000000000dEaD',
      signatureBase58: signature,
    })

    await expect(service.retryFailedClaim({ claimId: result.claim.id })).rejects.toMatchObject({
      code: 'claim_retry_not_failed',
    })
    expect(sender.sendToken).toHaveBeenCalledTimes(1)
  })
})

describe('claim runtime configuration', () => {
  it('uses Base mainnet BORO claims by default', () => {
    const env = completeBoroEnv()

    expect(getClaimRuntimeConfig(env)).toMatchObject({
      networkId: 'base-mainnet-boro',
      chainId: 8453,
      tokenSymbol: '$BORO',
      poolEnvName: 'BORO_CLAIM_POOL_RAW',
    })
    expect(getMissingRuntimeEnv(env)).toEqual([])
  })

  it('reports incomplete BORO mainnet runtime env as disabled config input', () => {
    expect(getMissingRuntimeEnv({ NODE_ENV: 'production' })).toEqual([
      'DATABASE_URL',
      'BASE_MAINNET_RPC_URL',
      'BASE_MAINNET_BORO_ADDRESS',
      'BORO_CLAIM_SENDER_PRIVATE_KEY',
      'BORO_CLAIM_POOL_RAW',
    ])
  })

  it('disables legacy testnet claims in production even if explicitly requested', () => {
    expect(getLegacyTestnetClaimsEnabled({ NODE_ENV: 'production' })).toBe(false)
    expect(getLegacyTestnetClaimsEnabled({ NODE_ENV: 'production', ENABLE_TESTNET_CLAIMS: 'true' })).toBe(false)
  })

  it('enables legacy testnet claims only when explicitly requested outside production', () => {
    expect(getLegacyTestnetClaimsEnabled({ NODE_ENV: 'development' })).toBe(false)
    expect(getLegacyTestnetClaimsEnabled({ NODE_ENV: 'test' })).toBe(false)
    expect(getLegacyTestnetClaimsEnabled({ NODE_ENV: 'staging', ENABLE_TESTNET_CLAIMS: 'true' })).toBe(true)
    expect(getClaimRuntimeConfig({ NODE_ENV: 'staging', ENABLE_TESTNET_CLAIMS: 'true' })).toMatchObject({
      networkId: 'base-sepolia-testcoin',
      chainId: 84532,
      poolEnvName: 'TESTCOIN_CLAIM_POOL_RAW',
    })
  })

  it('fails closed in production when DATABASE_URL is missing', async () => {
    const env = {
      NODE_ENV: 'production',
      BASE_MAINNET_RPC_URL: 'https://example.invalid',
      BASE_MAINNET_BORO_ADDRESS: '0x000000000000000000000000000000000000dEaD',
      BORO_CLAIM_SENDER_PRIVATE_KEY: privateKey,
      BORO_CLAIM_POOL_RAW: '1',
    }

    expect(getClaimRuntimeReady(env, ['DATABASE_URL'])).toBe(false)
    await expect(createClaimStore(env)).rejects.toThrow('DATABASE_URL is required for production claim persistence.')
  })

  it('rejects explicit in-memory claims in production', async () => {
    const env = {
      NODE_ENV: 'production',
      ALLOW_IN_MEMORY_CLAIMS: 'true',
      BASE_MAINNET_RPC_URL: 'https://example.invalid',
      BASE_MAINNET_BORO_ADDRESS: '0x000000000000000000000000000000000000dEaD',
      BORO_CLAIM_SENDER_PRIVATE_KEY: privateKey,
      BORO_CLAIM_POOL_RAW: '1',
    }

    expect(() => getClaimRuntimeReady(env, ['DATABASE_URL'])).toThrow(
      'ALLOW_IN_MEMORY_CLAIMS=true is not allowed in production.',
    )
    await expect(createClaimStore(env)).rejects.toThrow('ALLOW_IN_MEMORY_CLAIMS=true is not allowed in production.')
  })

  it('allows explicit in-memory claims outside production', async () => {
    const env = {
      NODE_ENV: 'development',
      ALLOW_IN_MEMORY_CLAIMS: 'true',
      BASE_MAINNET_RPC_URL: 'https://example.invalid',
      BASE_MAINNET_BORO_ADDRESS: '0x000000000000000000000000000000000000dEaD',
      BORO_CLAIM_SENDER_PRIVATE_KEY: privateKey,
      BORO_CLAIM_POOL_RAW: '1',
    }

    expect(getClaimRuntimeReady(env, ['DATABASE_URL'])).toBe(true)
    await expect(createClaimStore(env)).resolves.toBeInstanceOf(MemoryClaimStore)
  })

  it('requires explicit in-memory opt-in outside production', async () => {
    const env = {
      NODE_ENV: 'test',
      BASE_MAINNET_RPC_URL: 'https://example.invalid',
      BASE_MAINNET_BORO_ADDRESS: '0x000000000000000000000000000000000000dEaD',
      BORO_CLAIM_SENDER_PRIVATE_KEY: privateKey,
      BORO_CLAIM_POOL_RAW: '1',
    }

    expect(getClaimRuntimeReady(env, ['DATABASE_URL'])).toBe(false)
    await expect(createClaimStore(env)).rejects.toThrow(
      'DATABASE_URL is required unless ALLOW_IN_MEMORY_CLAIMS=true is set for local development or test.',
    )
  })

  it('rejects in-memory claims outside local development and test', async () => {
    const env = {
      NODE_ENV: 'staging',
      ALLOW_IN_MEMORY_CLAIMS: 'true',
      BASE_MAINNET_RPC_URL: 'https://example.invalid',
      BASE_MAINNET_BORO_ADDRESS: '0x000000000000000000000000000000000000dEaD',
      BORO_CLAIM_SENDER_PRIVATE_KEY: privateKey,
      BORO_CLAIM_POOL_RAW: '1',
    }

    expect(getClaimRuntimeReady(env, ['DATABASE_URL'])).toBe(false)
    await expect(createClaimStore(env)).rejects.toThrow(
      'DATABASE_URL is required unless ALLOW_IN_MEMORY_CLAIMS=true is set for local development or test.',
    )
  })
})

function mockSender(txHash: string): TokenSender {
  return {
    sendToken: vi.fn(async () => txHash),
    getTransferRecoveryState: vi.fn(async () => ({
      txStatus: 'not_checked' as const,
      recipientBalanceCoversAmount: false,
    })),
  }
}

const privateKey = `0x${'1'.repeat(64)}`

function completeBoroEnv() {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://user:password@example.invalid:5432/borodutch_tools',
    BASE_MAINNET_RPC_URL: 'https://mainnet.base.org',
    BASE_MAINNET_BORO_ADDRESS: '0x91f11Ad8fa616E95b41C88dFFde95D415F3F9C3c',
    BORO_CLAIM_SENDER_PRIVATE_KEY: privateKey,
    BORO_CLAIM_POOL_RAW: '1000000000000000000000000000',
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
