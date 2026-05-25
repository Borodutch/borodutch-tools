import { BASE_MAINNET_BORO_ADDRESS, isRealAddress, normalizedAddress } from './launch-config'

export { isAddress } from './launch-config'

export type EthereumProvider = {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>
  on?(event: string, handler: (...args: unknown[]) => void): void
  removeListener?(event: string, handler: (...args: unknown[]) => void): void
}

declare global {
  interface Window {
    ethereum?: EthereumProvider
  }
}

export type LockConfig = {
  blockExplorerUrl: string
  chainId: string
  chainIdDecimal: number
  chainName: string
  configured: boolean
  tokenAddress: string
  tokenLabel: string
  lockAddress: string
  rpcUrl: string
  maturedPageSize: bigint
}

export type LockPosition = {
  id: bigint
  owner: string
  amount: bigint
  lockedAt: bigint
  unlockAt: bigint
  withdrawn: boolean
}

const BASE_MAINNET_CHAIN_ID = '0x2105'
const BASE_MAINNET_CHAIN_ID_DECIMAL = 8453
const ZERO_WORD = '0'.repeat(64)

const selectors = {
  activePositionCount: '0x48423de5',
  allowance: '0xdd62ed3e',
  approve: '0x095ea7b3',
  balanceOf: '0x70a08231',
  decimals: '0x313ce567',
  getPositionIds: '0xff03d877',
  lock: '0xdd467064',
  lockedAmountOf: '0x8b9d6899',
  maturedLockedAmountOf: '0x0c5df963',
  maturedLockedTotal: '0xf2f60862',
  positions: '0x99fbab88',
  symbol: '0x95d89b41',
  totalLocked: '0x56891412',
  withdraw: '0x2e1a7d4d',
  withdrawMatured: '0x533ebf75',
}

export function getLockConfig(): LockConfig {
  const tokenAddress = normalizedAddress(import.meta.env.VITE_BASE_MAINNET_BORO_ADDRESS ?? BASE_MAINNET_BORO_ADDRESS)
  const lockAddress = normalizedAddress(import.meta.env.VITE_BORO_LOCK_ADDRESS ?? '')

  return {
    blockExplorerUrl: 'https://basescan.org',
    chainId: BASE_MAINNET_CHAIN_ID,
    chainIdDecimal: BASE_MAINNET_CHAIN_ID_DECIMAL,
    chainName: 'Base mainnet',
    configured: isRealAddress(tokenAddress) && isRealAddress(lockAddress),
    tokenAddress,
    tokenLabel: '$BORO',
    lockAddress,
    rpcUrl: import.meta.env.VITE_BASE_MAINNET_RPC_URL ?? 'https://mainnet.base.org',
    maturedPageSize: BigInt(import.meta.env.VITE_BORO_LOCK_MATURED_PAGE_SIZE ?? '500'),
  }
}

export function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

export async function getConnectedAccount(provider: EthereumProvider): Promise<string | null> {
  const accounts = (await provider.request({ method: 'eth_accounts' })) as string[]
  return accounts[0] ?? null
}

export async function connectWallet(provider: EthereumProvider): Promise<string> {
  await ensureConfiguredChain(provider)
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[]
  return accounts[0] ?? ''
}

export async function ensureConfiguredChain(provider: EthereumProvider, config = getLockConfig()) {
  const chainId = await provider.request({ method: 'eth_chainId' })
  if (chainId === config.chainId) return

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: config.chainId }],
    })
  } catch (error) {
    if (!hasErrorCode(error, 4902)) throw error

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          blockExplorerUrls: [config.blockExplorerUrl],
          chainId: config.chainId,
          chainName: config.chainName,
          nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
          rpcUrls: [config.rpcUrl],
        },
      ],
    })
  }
}

export async function readTokenDetails(provider: EthereumProvider, tokenAddress: string) {
  const decimals = Number(decodeUint(await ethCall(provider, tokenAddress, selectors.decimals)))
  const symbol = decodeString(await ethCall(provider, tokenAddress, selectors.symbol)) || 'BORO'
  return { decimals, symbol }
}

export async function readTokenBalance(
  provider: EthereumProvider,
  tokenAddress: string,
  account: string,
): Promise<bigint> {
  return decodeUint(await ethCall(provider, tokenAddress, encodeCall(selectors.balanceOf, addressArg(account))))
}

export async function readAllowance(
  provider: EthereumProvider,
  tokenAddress: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  return decodeUint(
    await ethCall(provider, tokenAddress, encodeCall(selectors.allowance, addressArg(owner), addressArg(spender))),
  )
}

export async function readLockedAmount(
  provider: EthereumProvider,
  lockAddress: string,
  owner: string,
): Promise<bigint> {
  return decodeUint(await ethCall(provider, lockAddress, encodeCall(selectors.lockedAmountOf, addressArg(owner))))
}

export async function readMaturedAmount(
  provider: EthereumProvider,
  lockAddress: string,
  owner: string,
): Promise<bigint> {
  return decodeUint(
    await ethCall(provider, lockAddress, encodeCall(selectors.maturedLockedAmountOf, addressArg(owner))),
  )
}

export async function readTotalLocked(provider: EthereumProvider, lockAddress: string): Promise<bigint> {
  return decodeUint(await ethCall(provider, lockAddress, selectors.totalLocked))
}

export async function readActivePositionCount(provider: EthereumProvider, lockAddress: string): Promise<bigint> {
  return decodeUint(await ethCall(provider, lockAddress, selectors.activePositionCount))
}

export async function readMaturedLockedTotal(
  provider: EthereumProvider,
  lockAddress: string,
  pageSize: bigint,
): Promise<{ amount: bigint; partial: boolean }> {
  let cursor = 0n
  let amount = 0n
  let partial = false

  for (let page = 0; page < 20; page++) {
    const [pageAmount, nextCursor, done] = decodeMaturedTotal(
      await ethCall(provider, lockAddress, encodeCall(selectors.maturedLockedTotal, uintArg(cursor), uintArg(pageSize))),
    )
    amount += pageAmount
    cursor = nextCursor
    if (done) return { amount, partial }
  }

  partial = true
  return { amount, partial }
}

export async function readPositions(
  provider: EthereumProvider,
  lockAddress: string,
  owner: string,
): Promise<LockPosition[]> {
  const [ids] = decodeUintArrayResult(
    await ethCall(provider, lockAddress, encodeCall(selectors.getPositionIds, addressArg(owner), uintArg(0n), uintArg(100n))),
  )

  const positions = await Promise.all(
    ids.map(async (id) => decodePosition(id, await ethCall(provider, lockAddress, encodeCall(selectors.positions, uintArg(id))))),
  )

  return positions.sort((a, b) => Number(b.id - a.id))
}

export async function approveToken(
  provider: EthereumProvider,
  tokenAddress: string,
  owner: string,
  spender: string,
  amount: bigint,
): Promise<string> {
  return sendTransaction(provider, owner, tokenAddress, encodeCall(selectors.approve, addressArg(spender), uintArg(amount)))
}

export async function lockToken(
  provider: EthereumProvider,
  lockAddress: string,
  owner: string,
  amount: bigint,
): Promise<string> {
  return sendTransaction(provider, owner, lockAddress, encodeCall(selectors.lock, uintArg(amount)))
}

export async function withdrawPosition(
  provider: EthereumProvider,
  lockAddress: string,
  owner: string,
  id: bigint,
): Promise<string> {
  return sendTransaction(provider, owner, lockAddress, encodeCall(selectors.withdraw, uintArg(id)))
}

export async function withdrawAllMatured(
  provider: EthereumProvider,
  lockAddress: string,
  owner: string,
): Promise<string> {
  return sendTransaction(provider, owner, lockAddress, selectors.withdrawMatured)
}

export function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n
  const raw = negative ? -value : value
  const scale = 10n ** BigInt(decimals)
  const whole = raw / scale
  const fraction = raw % scale
  const fractionText = fraction.toString().padStart(decimals, '0').replace(/0+$/, '').slice(0, 6)
  return `${negative ? '-' : ''}${whole.toString()}${fractionText ? `.${fractionText}` : ''}`
}

export function parseUnits(value: string, decimals: number): bigint {
  const normalized = value.trim()
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new Error('Enter a valid positive amount.')

  const [whole, fraction = ''] = normalized.split('.')
  if (fraction.length > decimals) throw new Error(`Use no more than ${decimals} decimal places.`)

  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
}

export function formatDate(timestamp: bigint): string {
  return new Date(Number(timestamp) * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function explorerTxUrl(hash: string, config = getLockConfig()): string {
  return `${config.blockExplorerUrl}/tx/${hash}`
}

export function chainLabel(config = getLockConfig()): string {
  return `${config.chainName} (${config.chainIdDecimal})`
}

function encodeCall(selector: string, ...args: string[]): string {
  return `${selector}${args.join('')}`
}

function addressArg(address: string): string {
  return cleanHex(address).padStart(64, '0')
}

function uintArg(value: bigint): string {
  return value.toString(16).padStart(64, '0')
}

async function ethCall(provider: EthereumProvider, to: string, data: string): Promise<string> {
  const result = (await provider.request({
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
  })) as string
  return result || `0x${ZERO_WORD}`
}

async function sendTransaction(
  provider: EthereumProvider,
  from: string,
  to: string,
  data: string,
): Promise<string> {
  return (await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from, to, data }],
  })) as string
}

function decodeUint(result: string): bigint {
  return BigInt(`0x${cleanHex(result).slice(0, 64) || '0'}`)
}

function decodeBool(word: string): boolean {
  return BigInt(`0x${word || '0'}`) !== 0n
}

function decodeString(result: string): string {
  const hex = cleanHex(result)
  if (hex.length === 64) {
    return hexToUtf8(hex.replace(/0+$/, ''))
  }

  const length = Number(BigInt(`0x${hex.slice(64, 128) || '0'}`))
  if (!length) return ''

  return hexToUtf8(hex.slice(128, 128 + length * 2))
}

function decodeUintArrayResult(result: string): [bigint[], bigint, boolean] {
  const words = splitWords(result)
  const length = Number(BigInt(`0x${words[1] ?? '0'}`))
  const ids = words.slice(2, 2 + length).map((word) => BigInt(`0x${word}`))
  const tailIndex = 2 + length
  return [ids, BigInt(`0x${words[tailIndex] ?? '0'}`), decodeBool(words[tailIndex + 1] ?? '0')]
}

function decodeMaturedTotal(result: string): [bigint, bigint, boolean] {
  const words = splitWords(result)
  return [BigInt(`0x${words[0] ?? '0'}`), BigInt(`0x${words[1] ?? '0'}`), decodeBool(words[2] ?? '0')]
}

function decodePosition(id: bigint, result: string): LockPosition {
  const words = splitWords(result)
  return {
    amount: BigInt(`0x${words[1] ?? '0'}`),
    id,
    lockedAt: BigInt(`0x${words[2] ?? '0'}`),
    owner: `0x${(words[0] ?? '').slice(24)}`,
    unlockAt: BigInt(`0x${words[3] ?? '0'}`),
    withdrawn: decodeBool(words[4] ?? '0'),
  }
}

function splitWords(result: string): string[] {
  const hex = cleanHex(result)
  return hex.match(/.{1,64}/g) ?? []
}

function cleanHex(value: string): string {
  return value.replace(/^0x/i, '').toLowerCase()
}

function hexToUtf8(hex: string): string {
  const bytes = hex.match(/.{1,2}/g) ?? []
  return bytes.map((byte) => String.fromCharCode(Number.parseInt(byte, 16))).join('')
}

function hasErrorCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === code
}
