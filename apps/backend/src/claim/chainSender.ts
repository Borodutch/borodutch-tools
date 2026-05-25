import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { BASE_SEPOLIA_CHAIN_ID, type TokenSender } from './types.ts'
import { normalizeEvmAddress } from './validation.ts'

const erc20Abi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])

export class BaseSepoliaTokenSender implements TokenSender {
  private readonly sender: IdempotentSerializedTokenSender

  constructor(env: Record<string, string | undefined>) {
    this.sender = new IdempotentSerializedTokenSender(new BaseSepoliaTokenTransferSender(env))
  }

  sendTestcoin(input: { recipient: string; amountRaw: bigint; idempotencyKey: string }) {
    return this.sender.sendTestcoin(input)
  }
}

export class IdempotentSerializedTokenSender implements TokenSender {
  private readonly sendsByIdempotencyKey = new Map<string, { transferKey: string; promise: Promise<string> }>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly delegate: TokenSender) {}

  sendTestcoin(input: { recipient: string; amountRaw: bigint; idempotencyKey: string }) {
    const idempotencyKey = input.idempotencyKey.trim()

    if (!idempotencyKey) {
      return Promise.reject(new Error('idempotency key is required'))
    }

    const recipient = normalizeEvmAddress(input.recipient)
    const transferKey = `${recipient}:${input.amountRaw.toString()}`
    const existing = this.sendsByIdempotencyKey.get(idempotencyKey)

    if (existing) {
      if (existing.transferKey !== transferKey) {
        return Promise.reject(new Error('idempotency key reused for a different transfer'))
      }

      return existing.promise
    }

    const promise = this.enqueue(() =>
      this.delegate.sendTestcoin({
        ...input,
        recipient,
        idempotencyKey,
      }),
    )

    this.sendsByIdempotencyKey.set(idempotencyKey, { transferKey, promise })
    promise.catch(() => {
      if (this.sendsByIdempotencyKey.get(idempotencyKey)?.promise === promise) {
        this.sendsByIdempotencyKey.delete(idempotencyKey)
      }
    })

    return promise
  }

  private enqueue<T>(operation: () => Promise<T>) {
    const queued = this.queue.catch(() => undefined).then(operation)
    this.queue = queued.then(
      () => undefined,
      () => undefined,
    )
    return queued
  }
}

class BaseSepoliaTokenTransferSender implements TokenSender {
  private readonly rpcUrl: string
  private readonly tokenAddress: `0x${string}`
  private readonly privateKey: `0x${string}`

  constructor(env: Record<string, string | undefined>) {
    const rpcUrl = resolveRpcUrl(env)

    if (!rpcUrl) {
      throw new Error('missing BASE_SEPOLIA_RPC_URL or ALCHEMY_BASE_SEPOLIA_API_KEY')
    }

    if (!env.BASE_SEPOLIA_TESTCOIN_ADDRESS) {
      throw new Error('missing BASE_SEPOLIA_TESTCOIN_ADDRESS')
    }

    if (!env.BASE_SEPOLIA_AIRDROP_PRIVATE_KEY) {
      throw new Error('missing BASE_SEPOLIA_AIRDROP_PRIVATE_KEY')
    }

    this.rpcUrl = rpcUrl
    this.tokenAddress = normalizeEvmAddress(env.BASE_SEPOLIA_TESTCOIN_ADDRESS) as `0x${string}`
    this.privateKey = normalizePrivateKey(env.BASE_SEPOLIA_AIRDROP_PRIVATE_KEY)
  }

  async sendTestcoin(input: { recipient: string; amountRaw: bigint; idempotencyKey: string }) {
    const account = privateKeyToAccount(this.privateKey)
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(this.rpcUrl),
    })
    const walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(this.rpcUrl),
    })
    const chainId = await publicClient.getChainId()

    if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
      throw new Error('base sepolia rpc returned unexpected chain id')
    }

    return walletClient.writeContract({
      address: this.tokenAddress,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [normalizeEvmAddress(input.recipient) as `0x${string}`, input.amountRaw],
    })
  }
}

export function getMissingRuntimeEnv(env: Record<string, string | undefined>) {
  const missing: string[] = []

  if (!env.DATABASE_URL) {
    missing.push('DATABASE_URL')
  }

  if (!resolveRpcUrl(env)) {
    missing.push('BASE_SEPOLIA_RPC_URL or ALCHEMY_BASE_SEPOLIA_API_KEY')
  }

  for (const name of ['BASE_SEPOLIA_TESTCOIN_ADDRESS', 'BASE_SEPOLIA_AIRDROP_PRIVATE_KEY', 'TESTCOIN_CLAIM_POOL_RAW']) {
    if (!env[name]) {
      missing.push(name)
    }
  }

  return missing
}

function resolveRpcUrl(env: Record<string, string | undefined>) {
  if (env.BASE_SEPOLIA_RPC_URL) {
    return env.BASE_SEPOLIA_RPC_URL
  }

  if (env.ALCHEMY_BASE_SEPOLIA_API_KEY) {
    return `https://base-sepolia.g.alchemy.com/v2/${env.ALCHEMY_BASE_SEPOLIA_API_KEY}`
  }

  return undefined
}

function normalizePrivateKey(value: string): `0x${string}` {
  const privateKey = value.startsWith('0x') ? value : `0x${value}`

  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('invalid BASE_SEPOLIA_AIRDROP_PRIVATE_KEY')
  }

  return privateKey as `0x${string}`
}
