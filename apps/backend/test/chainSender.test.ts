import { beforeEach, describe, expect, it, vi } from 'vitest'

const viemMocks = vi.hoisted(() => {
  let activeWrites = 0
  let maxActiveWrites = 0
  let txCounter = 0
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
    createPublicClient: vi.fn(() => ({ getChainId: vi.fn(async () => 84532) })),
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
      writeContract.mockClear()
    },
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
  baseSepolia: { id: 84532, name: 'Base Sepolia' },
}))

const { BaseSepoliaTokenSender } = await import('../src/claim/chainSender.ts')

describe('Base Sepolia token sender', () => {
  beforeEach(() => {
    viemMocks.reset()
  })

  it('serializes concurrent sends from the airdrop wallet', async () => {
    const sender = createSender()

    await Promise.all([
      sender.sendTestcoin({
        recipient: '0x000000000000000000000000000000000000dEaD',
        amountRaw: 1n,
        idempotencyKey: 'claim-1',
      }),
      sender.sendTestcoin({
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
      sender.sendTestcoin({
        recipient: '0x000000000000000000000000000000000000dEaD',
        amountRaw: 1n,
        idempotencyKey: 'claim-1',
      }),
      sender.sendTestcoin({
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

    await sender.sendTestcoin({
      recipient: '0x000000000000000000000000000000000000dEaD',
      amountRaw: 1n,
      idempotencyKey: 'claim-1',
    })

    await expect(
      sender.sendTestcoin({
        recipient: '0x000000000000000000000000000000000000bEEF',
        amountRaw: 1n,
        idempotencyKey: 'claim-1',
      }),
    ).rejects.toThrow('idempotency key reused')
    expect(viemMocks.writeContract).toHaveBeenCalledTimes(1)
  })
})

function createSender() {
  return new BaseSepoliaTokenSender({
    BASE_SEPOLIA_RPC_URL: 'https://base-sepolia.example',
    BASE_SEPOLIA_TESTCOIN_ADDRESS: '0x000000000000000000000000000000000000c0Fe',
    BASE_SEPOLIA_AIRDROP_PRIVATE_KEY: '1'.repeat(64),
  })
}
