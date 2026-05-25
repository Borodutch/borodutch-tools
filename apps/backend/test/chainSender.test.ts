import { beforeEach, describe, expect, it, vi } from 'vitest'

const viemMocks = vi.hoisted(() => {
  let activeWrites = 0
  let maxActiveWrites = 0
  let txCounter = 0
  const simulateContract = vi.fn(async () => ({ result: true, request: { functionName: 'transfer' } }))
  const waitForTransactionReceipt = vi.fn(async () => ({ status: 'success' }))
  const getTransactionReceipt = vi.fn()
  const getTransaction = vi.fn()
  const readContract = vi.fn(async () => 0n)
  const writeContract = vi.fn(async () => {
    activeWrites += 1
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites)
    txCounter += 1
    const txHash = `0x${txCounter}`

    await new Promise((resolve) => setTimeout(resolve, 10))
    activeWrites -= 1
    return txHash
  })

  return {
    createPublicClient: vi.fn(() => ({
      getChainId: vi.fn(async () => 84532),
      simulateContract,
      waitForTransactionReceipt,
      getTransactionReceipt,
      getTransaction,
      readContract,
    })),
    createWalletClient: vi.fn(() => ({ writeContract })),
    getAddress: vi.fn((address: string) => address),
    http: vi.fn((url: string) => ({ url })),
    isAddress: vi.fn((address: string) => /^0x[0-9a-fA-F]{40}$/.test(address)),
    parseAbi: vi.fn((abi: string[]) => abi),
    privateKeyToAccount: vi.fn(() => ({ address: '0x0000000000000000000000000000000000000001' })),
    reset() {
      activeWrites = 0
      maxActiveWrites = 0
      txCounter = 0
      simulateContract.mockClear()
      waitForTransactionReceipt.mockClear()
      waitForTransactionReceipt.mockResolvedValue({ status: 'success' })
      getTransactionReceipt.mockClear()
      getTransaction.mockClear()
      readContract.mockClear()
      writeContract.mockClear()
    },
    simulateContract,
    waitForTransactionReceipt,
    getTransactionReceipt,
    getTransaction,
    readContract,
    writeContract,
    get maxActiveWrites() {
      return maxActiveWrites
    },
  }
})

vi.mock('viem', () => ({
  createPublicClient: viemMocks.createPublicClient,
  createWalletClient: viemMocks.createWalletClient,
  getAddress: viemMocks.getAddress,
  http: viemMocks.http,
  isAddress: viemMocks.isAddress,
  parseAbi: viemMocks.parseAbi,
}))

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: viemMocks.privateKeyToAccount,
}))

vi.mock('viem/chains', () => ({
  base: { id: 8453, name: 'Base' },
  baseSepolia: { id: 84532, name: 'Base Sepolia' },
}))

const { BaseSepoliaTokenSender, ClaimTokenSender } = await import('../src/claim/chainSender.ts')
const { boroMainnetClaimConfig } = await import('../src/claim/config.ts')

describe('Base Sepolia token sender', () => {
  beforeEach(() => {
    viemMocks.reset()
  })

  it('serializes concurrent sends from the airdrop wallet', async () => {
    const sender = createSender()

    await Promise.all([
      sender.sendClaimToken({
        recipient: '0x000000000000000000000000000000000000dEaD',
        amountRaw: 1n,
        idempotencyKey: 'claim-1',
      }),
      sender.sendClaimToken({
        recipient: '0x000000000000000000000000000000000000bEEF',
        amountRaw: 2n,
        idempotencyKey: 'claim-2',
      }),
    ])

    expect(viemMocks.writeContract).toHaveBeenCalledTimes(2)
    expect(viemMocks.maxActiveWrites).toBe(1)
  })

  it('uses idempotencyKey to reuse an in-flight send instead of broadcasting twice', async () => {
    const sender = createSender()

    const [firstTxHash, secondTxHash] = await Promise.all([
      sender.sendClaimToken({
        recipient: '0x000000000000000000000000000000000000dEaD',
        amountRaw: 1n,
        idempotencyKey: 'claim-1',
      }),
      sender.sendClaimToken({
        recipient: '0x000000000000000000000000000000000000dEaD',
        amountRaw: 1n,
        idempotencyKey: 'claim-1',
      }),
    ])

    expect(firstTxHash).toBe(secondTxHash)
    expect(viemMocks.writeContract).toHaveBeenCalledTimes(1)
  })

  it('rejects reuse of an idempotencyKey for a different transfer', async () => {
    const sender = createSender()

    await sender.sendClaimToken({
      recipient: '0x000000000000000000000000000000000000dEaD',
      amountRaw: 1n,
      idempotencyKey: 'claim-1',
    })

    await expect(
      sender.sendClaimToken({
        recipient: '0x000000000000000000000000000000000000bEEF',
        amountRaw: 1n,
        idempotencyKey: 'claim-1',
      }),
    ).rejects.toThrow('idempotency key reused')
    expect(viemMocks.writeContract).toHaveBeenCalledTimes(1)
  })

  it('keeps the transaction hash on receipt wait failures for admin recovery', async () => {
    const sender = createSender()
    viemMocks.waitForTransactionReceipt.mockRejectedValueOnce(new Error('receipt timeout'))

    await expect(
      sender.sendClaimToken({
        recipient: '0x000000000000000000000000000000000000dEaD',
        amountRaw: 1n,
        idempotencyKey: 'claim-1',
      }),
    ).rejects.toMatchObject({ txHash: '0x1' })
    expect(viemMocks.writeContract).toHaveBeenCalledTimes(1)
  })

  it('supports Base mainnet BORO sender env and rejects wrong-chain RPCs', async () => {
    viemMocks.createPublicClient.mockReturnValueOnce({
      getChainId: vi.fn(async () => 84532),
      simulateContract: viemMocks.simulateContract,
      waitForTransactionReceipt: viemMocks.waitForTransactionReceipt,
      getTransactionReceipt: viemMocks.getTransactionReceipt,
      getTransaction: viemMocks.getTransaction,
      readContract: viemMocks.readContract,
    })
    const sender = new ClaimTokenSender(
      {
        BASE_MAINNET_RPC_URL: 'https://base.example',
        BASE_MAINNET_BORO_ADDRESS: '0x000000000000000000000000000000000000c0Fe',
        BORO_CLAIM_SENDER_PRIVATE_KEY: '1'.repeat(64),
      },
      boroMainnetClaimConfig,
    )

    await expect(
      sender.sendClaimToken({
        recipient: '0x000000000000000000000000000000000000dEaD',
        amountRaw: 1n,
        idempotencyKey: 'claim-1',
      }),
    ).rejects.toThrow('Base mainnet RPC returned unexpected chain id')
    expect(viemMocks.writeContract).not.toHaveBeenCalled()
  })
})

function createSender() {
  return new BaseSepoliaTokenSender({
    BASE_SEPOLIA_RPC_URL: 'https://base-sepolia.example',
    BASE_SEPOLIA_TESTCOIN_ADDRESS: '0x000000000000000000000000000000000000c0Fe',
    BASE_SEPOLIA_AIRDROP_PRIVATE_KEY: '1'.repeat(64),
  })
}
