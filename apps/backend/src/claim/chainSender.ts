import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { BASE_SEPOLIA_CHAIN_ID, type TokenSender, type TransferRecoveryState } from './types.ts'
import { normalizeEvmAddress } from './validation.ts'

const erc20Abi = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
])

export class BaseSepoliaTokenSender implements TokenSender {
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

    const recipient = normalizeEvmAddress(input.recipient) as `0x${string}`
    const simulation = await publicClient.simulateContract({
      address: this.tokenAddress,
      abi: erc20Abi,
      account,
      functionName: 'transfer',
      args: [recipient, input.amountRaw],
    })

    if (simulation.result !== true) {
      throw new Error('testcoin transfer simulation returned false')
    }

    const txHash = await walletClient.writeContract(simulation.request)
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

    if (receipt.status !== 'success') {
      throw new TokenTransferFailedError('testcoin transfer transaction reverted', txHash)
    }

    return txHash
  }

  async getTransferRecoveryState(input: {
    recipient: string
    amountRaw: bigint
    txHash: string | null
  }): Promise<TransferRecoveryState> {
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(this.rpcUrl),
    })
    const chainId = await publicClient.getChainId()

    if (chainId !== BASE_SEPOLIA_CHAIN_ID) {
      throw new Error('base sepolia rpc returned unexpected chain id')
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
