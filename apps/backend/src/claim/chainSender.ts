import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { legacyTestnetClaimConfig, type ClaimRuntimeConfig, type ClaimRuntimeEnv } from './config.ts'
import type { TokenSender, TransferRecoveryState } from './types.ts'
import { normalizeEvmAddress } from './validation.ts'

const erc20Abi = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
])

export class ClaimTokenSender implements TokenSender {
  private readonly sender: IdempotentSerializedTokenSender

  constructor(env: ClaimRuntimeEnv, config: ClaimRuntimeConfig) {
    this.sender = new IdempotentSerializedTokenSender(new ConfiguredTokenTransferSender(env, config))
  }

  sendClaimToken(input: { recipient: string; amountRaw: bigint; idempotencyKey: string }) {
    return this.sender.sendClaimToken(input)
  }

  getTransferRecoveryState(input: { recipient: string; amountRaw: bigint; txHash: string | null }) {
    return this.sender.getTransferRecoveryState(input)
  }
}

export class BaseSepoliaTokenSender extends ClaimTokenSender {
  constructor(env: ClaimRuntimeEnv) {
    super(env, legacyTestnetClaimConfig)
  }
}

export class IdempotentSerializedTokenSender implements TokenSender {
  private readonly sendsByIdempotencyKey = new Map<string, { transferKey: string; promise: Promise<string> }>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly delegate: TokenSender) {}

  sendClaimToken(input: { recipient: string; amountRaw: bigint; idempotencyKey: string }) {
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
      this.delegate.sendClaimToken({
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

  getTransferRecoveryState(input: { recipient: string; amountRaw: bigint; txHash: string | null }) {
    return this.delegate.getTransferRecoveryState(input)
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

class ConfiguredTokenTransferSender implements TokenSender {
  private readonly privateKey: `0x${string}`
  private readonly rpcUrl: string
  private readonly tokenAddress: `0x${string}`

  constructor(
    env: ClaimRuntimeEnv,
    private readonly config: ClaimRuntimeConfig,
  ) {
    const rpcUrl = env[config.rpcUrlEnv]
    const tokenAddress = env[config.tokenAddressEnv]
    const privateKey = env[config.privateKeyEnv]

    if (!rpcUrl) {
      throw new Error(`missing ${config.rpcUrlEnv}`)
    }

    if (!tokenAddress) {
      throw new Error(`missing ${config.tokenAddressEnv}`)
    }

    if (!privateKey) {
      throw new Error(`missing ${config.privateKeyEnv}`)
    }

    this.rpcUrl = rpcUrl
    this.tokenAddress = normalizeEvmAddress(tokenAddress) as `0x${string}`
    this.privateKey = normalizePrivateKey(privateKey, config.privateKeyEnv)
  }

  async sendClaimToken(input: { recipient: string; amountRaw: bigint; idempotencyKey: string }) {
    const account = privateKeyToAccount(this.privateKey)
    const publicClient = createPublicClient({
      chain: this.config.chain,
      transport: http(this.rpcUrl),
    })
    const walletClient = createWalletClient({
      account,
      chain: this.config.chain,
      transport: http(this.rpcUrl),
    })
    const chainId = await publicClient.getChainId()

    if (chainId !== this.config.chainId) {
      throw new Error(`${this.config.chainName} RPC returned unexpected chain id`)
    }

    const recipient = normalizeEvmAddress(input.recipient) as `0x${string}`
    const simulation = await publicClient.simulateContract({
      address: this.tokenAddress,
      abi: erc20Abi,
      account,
      functionName: 'transfer',
      args: [recipient, input.amountRaw],
    })

    if (simulation.result !== true) {
      throw new Error(`${this.config.tokenName} transfer simulation returned false`)
    }

    const txHash = await walletClient.writeContract(simulation.request)
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash }).catch((error) => {
      throw new TokenTransferFailedError(
        error instanceof Error ? error.message : `${this.config.tokenName} transfer transaction was not confirmed`,
        txHash,
      )
    })

    if (receipt.status !== 'success') {
      throw new TokenTransferFailedError(`${this.config.tokenName} transfer transaction reverted`, txHash)
    }

    return txHash
  }

  async getTransferRecoveryState(input: {
    recipient: string
    amountRaw: bigint
    txHash: string | null
  }): Promise<TransferRecoveryState> {
    const publicClient = createPublicClient({
      chain: this.config.chain,
      transport: http(this.rpcUrl),
    })
    const chainId = await publicClient.getChainId()

    if (chainId !== this.config.chainId) {
      throw new Error(`${this.config.chainName} RPC returned unexpected chain id`)
    }

    let txStatus: TransferRecoveryState['txStatus'] = 'not_checked'

    if (input.txHash) {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash: input.txHash as `0x${string}` })
        txStatus = receipt.status === 'success' ? 'success' : 'reverted'
      } catch {
        try {
          await publicClient.getTransaction({ hash: input.txHash as `0x${string}` })
          txStatus = 'pending'
        } catch {
          txStatus = 'not_found'
        }
      }
    }

    const recipientBalance = await publicClient.readContract({
      address: this.tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [normalizeEvmAddress(input.recipient) as `0x${string}`],
    })

    return {
      txStatus,
      recipientBalanceCoversAmount: recipientBalance >= input.amountRaw,
    }
  }
}

class TokenTransferFailedError extends Error {
  constructor(
    message: string,
    readonly txHash: string,
  ) {
    super(message)
  }
}

function normalizePrivateKey(value: string, envName: string): `0x${string}` {
  const privateKey = value.startsWith('0x') ? value : `0x${value}`

  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(`invalid ${envName}`)
  }

  return privateKey as `0x${string}`
}
