import { createPublicClient, createWalletClient, http, parseAbi, type Chain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { parsePositiveRawAmount } from './math.ts'
import {
  BORO_MAINNET_CLAIM_CONFIG,
  LEGACY_TESTNET_CLAIM_CONFIG,
  type ClaimNetworkId,
  type ClaimRuntimeConfig,
  type TokenSender,
  type TransferRecoveryState,
} from './types.ts'
import { normalizeEvmAddress } from './validation.ts'

const erc20Abi = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
])

type RuntimeEnv = Record<string, string | undefined>

type ChainSenderConfig = ClaimRuntimeConfig & {
  chain: Chain
  rpcEnvLabel: string
  tokenAddressEnvName: string
  privateKeyEnvName: string
}

const mainnetConfig: ChainSenderConfig = {
  ...BORO_MAINNET_CLAIM_CONFIG,
  chain: base,
  rpcEnvLabel: 'BASE_MAINNET_RPC_URL',
  tokenAddressEnvName: 'BASE_MAINNET_BORO_ADDRESS',
  privateKeyEnvName: 'BORO_CLAIM_SENDER_PRIVATE_KEY',
}

const legacyTestnetConfig: ChainSenderConfig = {
  ...LEGACY_TESTNET_CLAIM_CONFIG,
  chain: baseSepolia,
  rpcEnvLabel: 'BASE_SEPOLIA_RPC_URL or ALCHEMY_BASE_SEPOLIA_API_KEY',
  tokenAddressEnvName: 'BASE_SEPOLIA_TESTCOIN_ADDRESS',
  privateKeyEnvName: 'BASE_SEPOLIA_AIRDROP_PRIVATE_KEY',
}

export class BaseMainnetBoroTokenSender implements TokenSender {
  private readonly sender: IdempotentSerializedTokenSender

  constructor(env: RuntimeEnv) {
    this.sender = new IdempotentSerializedTokenSender(new ConfiguredTokenTransferSender(env, mainnetConfig))
  }

  sendToken(input: { recipient: string; amountRaw: bigint; idempotencyKey: string }) {
    return this.sender.sendToken(input)
  }

  getTransferRecoveryState(input: { recipient: string; amountRaw: bigint; txHash: string | null }) {
    return this.sender.getTransferRecoveryState(input)
  }
}

export class BaseSepoliaTokenSender implements TokenSender {
  private readonly sender: IdempotentSerializedTokenSender

  constructor(env: RuntimeEnv) {
    this.sender = new IdempotentSerializedTokenSender(new ConfiguredTokenTransferSender(env, legacyTestnetConfig))
  }

  sendToken(input: { recipient: string; amountRaw: bigint; idempotencyKey: string }) {
    return this.sender.sendToken(input)
  }

  getTransferRecoveryState(input: { recipient: string; amountRaw: bigint; txHash: string | null }) {
    return this.sender.getTransferRecoveryState(input)
  }
}

export class IdempotentSerializedTokenSender implements TokenSender {
  private readonly sendsByIdempotencyKey = new Map<string, { transferKey: string; promise: Promise<string> }>()
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly delegate: TokenSender) {}

  sendToken(input: { recipient: string; amountRaw: bigint; idempotencyKey: string }) {
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
      this.delegate.sendToken({
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
  private readonly rpcUrl: string
  private readonly tokenAddress: `0x${string}`
  private readonly privateKey: `0x${string}`

  constructor(
    env: RuntimeEnv,
    private readonly config: ChainSenderConfig,
  ) {
    const rpcUrl = resolveRpcUrl(env, config.networkId)

    if (!rpcUrl) {
      throw new Error(`missing ${config.rpcEnvLabel}`)
    }

    if (!env[config.tokenAddressEnvName]) {
      throw new Error(`missing ${config.tokenAddressEnvName}`)
    }

    if (!env[config.privateKeyEnvName]) {
      throw new Error(`missing ${config.privateKeyEnvName}`)
    }

    this.rpcUrl = rpcUrl
    this.tokenAddress = normalizeEvmAddress(env[config.tokenAddressEnvName]) as `0x${string}`
    this.privateKey = normalizePrivateKey(env[config.privateKeyEnvName], config.privateKeyEnvName)
  }

  async sendToken(input: { recipient: string; amountRaw: bigint; idempotencyKey: string }) {
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
      throw new Error(`${this.config.networkName} RPC returned unexpected chain id`)
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
      throw new Error(`${this.config.tokenSymbol} transfer simulation returned false`)
    }

    const txHash = await walletClient.writeContract(simulation.request)
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash }).catch((error) => {
      throw new TokenTransferFailedError(
        error instanceof Error ? error.message : `${this.config.tokenSymbol} transfer transaction was not confirmed`,
        txHash,
      )
    })

    if (receipt.status !== 'success') {
      throw new TokenTransferFailedError(`${this.config.tokenSymbol} transfer transaction reverted`, txHash)
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
      throw new Error(`${this.config.networkName} RPC returned unexpected chain id`)
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

export function getClaimRuntimeConfig(env: RuntimeEnv) {
  return getClaimNetworkId(env) === 'base-sepolia-testcoin' ? legacyTestnetConfig : mainnetConfig
}

export function getClaimNetworkId(env: RuntimeEnv): ClaimNetworkId {
  return getLegacyTestnetClaimsEnabled(env) ? 'base-sepolia-testcoin' : 'base-mainnet-boro'
}

export function getLegacyTestnetClaimsEnabled(env: RuntimeEnv) {
  const explicitValue = env.ENABLE_TESTNET_CLAIMS?.trim().toLowerCase()

  if (!explicitValue || !['1', 'true', 'yes', 'on'].includes(explicitValue)) {
    return false
  }

  return env.NODE_ENV !== 'production'
}

export function createClaimTokenSender(env: RuntimeEnv): TokenSender {
  return getClaimNetworkId(env) === 'base-sepolia-testcoin'
    ? new BaseSepoliaTokenSender(env)
    : new BaseMainnetBoroTokenSender(env)
}

export function getMissingRuntimeEnv(env: RuntimeEnv) {
  const config = getClaimRuntimeConfig(env)
  const missing: string[] = []

  if (!env.DATABASE_URL) {
    missing.push('DATABASE_URL')
  }

  if (!resolveRpcUrl(env, config.networkId)) {
    missing.push(config.rpcEnvLabel)
  }

  if (!isValidAddressValue(env[config.tokenAddressEnvName])) {
    missing.push(config.tokenAddressEnvName)
  }

  if (!isValidPrivateKeyValue(env[config.privateKeyEnvName])) {
    missing.push(config.privateKeyEnvName)
  }

  if (!isValidPositiveRawAmount(env[config.poolEnvName], config.poolEnvName)) {
    missing.push(config.poolEnvName)
  }

  return missing
}

function resolveRpcUrl(env: RuntimeEnv, networkId: ClaimNetworkId) {
  if (networkId === 'base-mainnet-boro') {
    return env.BASE_MAINNET_RPC_URL
  }

  if (env.BASE_SEPOLIA_RPC_URL) {
    return env.BASE_SEPOLIA_RPC_URL
  }

  if (env.ALCHEMY_BASE_SEPOLIA_API_KEY) {
    return `https://base-sepolia.g.alchemy.com/v2/${env.ALCHEMY_BASE_SEPOLIA_API_KEY}`
  }

  return undefined
}

function isValidAddressValue(value: string | undefined) {
  if (!value) return false

  try {
    normalizeEvmAddress(value)
    return true
  } catch {
    return false
  }
}

function isValidPrivateKeyValue(value: string | undefined) {
  if (!value) return false

  try {
    normalizePrivateKey(value, 'private key')
    return true
  } catch {
    return false
  }
}

function isValidPositiveRawAmount(value: string | undefined, envName: string) {
  try {
    parsePositiveRawAmount(value, envName)
    return true
  } catch {
    return false
  }
}

function normalizePrivateKey(value: string | undefined, envName: string): `0x${string}` {
  const privateKey = value?.startsWith('0x') ? value : `0x${value ?? ''}`

  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(`invalid ${envName}`)
  }

  return privateKey as `0x${string}`
}
