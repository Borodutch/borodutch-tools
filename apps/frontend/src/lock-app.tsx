import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import {
  type LockPosition,
  approveToken,
  chainLabel,
  connectWallet,
  ensureBaseSepolia,
  explorerTxUrl,
  formatDate,
  formatUnits,
  getConnectedAccount,
  getLockConfig,
  isAddress,
  lockToken,
  parseUnits,
  readActivePositionCount,
  readAllowance,
  readLockedAmount,
  readMaturedAmount,
  readMaturedLockedTotal,
  readPositions,
  readTokenBalance,
  readTokenDetails,
  readTotalLocked,
  shortAddress,
  withdrawAllMatured,
  withdrawPosition,
} from './evm'

type Dashboard = {
  activePositionCount: bigint
  allowance: bigint
  accountLocked: bigint
  accountMatured: bigint
  balance: bigint
  decimals: number
  globalMatured: bigint
  globalMaturedPartial: boolean
  lookupLocked: bigint
  lookupMatured: bigint
  positions: LockPosition[]
  symbol: string
  totalLocked: bigint
}

const config = getLockConfig()

export function App() {
  const provider = typeof window !== 'undefined' ? window.ethereum : undefined
  const [account, setAccount] = useState('')
  const [lookupAddress, setLookupAddress] = useState('')
  const [lockAmount, setLockAmount] = useState('')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [status, setStatus] = useState('Connect an EVM wallet to Base Sepolia.')
  const [txHash, setTxHash] = useState('')
  const [busy, setBusy] = useState(false)

  const configured = isAddress(config.tokenAddress) && isAddress(config.lockAddress)
  const activeLookupAddress = useMemo(
    () => (isAddress(lookupAddress) ? lookupAddress : account),
    [account, lookupAddress],
  )
  const parsedLockAmount = useMemo(() => {
    if (!dashboard || !lockAmount.trim()) return 0n
    try {
      return parseUnits(lockAmount, dashboard.decimals)
    } catch {
      return 0n
    }
  }, [dashboard, lockAmount])

  const refresh = useCallback(async () => {
    if (!provider) {
      setStatus('No injected EVM wallet detected.')
      return
    }

    if (!configured) {
      setStatus('Set VITE_BASE_SEPOLIA_TESTCOIN_ADDRESS and VITE_TESTCOIN_LOCK_ADDRESS.')
      return
    }

    const connected = account || (await getConnectedAccount(provider)) || ''
    if (connected && !account) setAccount(connected)

    const lookup = isAddress(activeLookupAddress) ? activeLookupAddress : ''
    const details = await readTokenDetails(provider, config.tokenAddress)
    const [totalLocked, globalMatured, activePositionCount] = await Promise.all([
      readTotalLocked(provider, config.lockAddress),
      readMaturedLockedTotal(provider, config.lockAddress, config.maturedPageSize),
      readActivePositionCount(provider, config.lockAddress),
    ])

    const [lookupLocked, lookupMatured] = lookup
      ? await Promise.all([
          readLockedAmount(provider, config.lockAddress, lookup),
          readMaturedAmount(provider, config.lockAddress, lookup),
        ])
      : [0n, 0n]

    const [balance, allowance, accountLocked, accountMatured, positions] =
      connected
        ? await Promise.all([
            readTokenBalance(provider, config.tokenAddress, connected),
            readAllowance(provider, config.tokenAddress, connected, config.lockAddress),
            readLockedAmount(provider, config.lockAddress, connected),
            readMaturedAmount(provider, config.lockAddress, connected),
            readPositions(provider, config.lockAddress, connected),
          ])
        : [0n, 0n, 0n, 0n, []]

    setDashboard({
      accountLocked,
      accountMatured,
      activePositionCount,
      allowance,
      balance,
      decimals: details.decimals,
      globalMatured: globalMatured.amount,
      globalMaturedPartial: globalMatured.partial,
      lookupLocked,
      lookupMatured,
      positions,
      symbol: details.symbol,
      totalLocked,
    })
    setStatus(connected ? `Connected to ${chainLabel()} as ${shortAddress(connected)}.` : 'Wallet ready.')
  }, [account, activeLookupAddress, configured, provider])

  useEffect(() => {
    refresh().catch((error: unknown) => setStatus(errorMessage(error)))
  }, [refresh])

  useEffect(() => {
    if (!provider?.on || !provider.removeListener) return undefined

    const handleAccounts = (accounts: unknown) => {
      setAccount(Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : '')
      setTxHash('')
    }
    const handleChain = () => {
      refresh().catch((error: unknown) => setStatus(errorMessage(error)))
    }

    provider.on('accountsChanged', handleAccounts)
    provider.on('chainChanged', handleChain)

    return () => {
      provider.removeListener?.('accountsChanged', handleAccounts)
      provider.removeListener?.('chainChanged', handleChain)
    }
  }, [provider, refresh])

  async function run(label: string, action: () => Promise<string | void>) {
    if (!provider || !account) return

    setBusy(true)
    setStatus(label)
    setTxHash('')

    try {
      await ensureBaseSepolia(provider, config.rpcUrl)
      const hash = await action()
      if (hash) setTxHash(hash)
      setStatus(hash ? 'Transaction submitted.' : 'Updated.')
      await refresh()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const needsApproval = parsedLockAmount > 0n && dashboard ? dashboard.allowance < parsedLockAmount : false
  const maturePositions = dashboard?.positions.filter((position) => !position.withdrawn && position.unlockAt <= nowSeconds()) ?? []

  return (
    <section class="bg-[#f8f7f2] text-neutral-950">
      <section class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 md:px-6">
        <header class="flex flex-col gap-4 border-b border-neutral-300 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p class="text-sm font-semibold uppercase tracking-wide text-emerald-700">tools.borodutch.com</p>
            <h1 class="mt-1 text-3xl font-semibold md:text-4xl">$testcoin one-year lock</h1>
            <p class="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
              Base Sepolia contract: lock now, withdraw after the 365 day cliff.
            </p>
          </div>
          <button
            class="h-11 rounded-md bg-neutral-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!provider || busy}
            onClick={() =>
              provider &&
              connectWallet(provider)
                .then(setAccount)
                .then(() => refresh())
                .catch((error: unknown) => setStatus(errorMessage(error)))
            }
            type="button"
          >
            {account ? shortAddress(account) : 'Connect wallet'}
          </button>
        </header>

        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section class="grid gap-4">
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Global locked" value={amountLabel(dashboard?.totalLocked, dashboard)} />
              <Metric
                label="Global matured"
                value={`${amountLabel(dashboard?.globalMatured, dashboard)}${dashboard?.globalMaturedPartial ? '+' : ''}`}
              />
              <Metric label="Active positions" value={dashboard?.activePositionCount.toString() ?? '-'} />
              <Metric label="Wallet balance" value={amountLabel(dashboard?.balance, dashboard)} />
            </div>

            <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <section class="rounded-lg border border-neutral-300 bg-white p-4">
                <div class="flex flex-col gap-2 border-b border-neutral-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 class="text-lg font-semibold">Lock {dashboard?.symbol ?? '$testcoin'}</h2>
                    <p class="text-sm text-neutral-600">Token {shortOrUnset(config.tokenAddress)}</p>
                  </div>
                  <span class="text-sm font-medium text-neutral-600">Lock contract {shortOrUnset(config.lockAddress)}</span>
                </div>

                <div class="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <input
                    class="h-11 rounded-md border border-neutral-300 px-3 text-base outline-none focus:border-neutral-950"
                    inputMode="decimal"
                    onInput={(event) => setLockAmount(event.currentTarget.value)}
                    placeholder="0.0"
                    value={lockAmount}
                  />
                  <button
                    class="h-11 rounded-md border border-neutral-950 px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!account || !configured || !needsApproval || busy}
                    onClick={() =>
                      run('Submitting approval...', () =>
                        approveToken(provider!, config.tokenAddress, account, config.lockAddress, parsedLockAmount),
                      )
                    }
                    type="button"
                  >
                    Approve
                  </button>
                  <button
                    class="h-11 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!account || !configured || parsedLockAmount <= 0n || needsApproval || busy}
                    onClick={() =>
                      run('Submitting lock...', () => lockToken(provider!, config.lockAddress, account, parsedLockAmount))
                    }
                    type="button"
                  >
                    Lock
                  </button>
                </div>

                <div class="mt-4 grid gap-3 sm:grid-cols-3">
                  <Metric compact label="Allowance" value={amountLabel(dashboard?.allowance, dashboard)} />
                  <Metric compact label="Your locked" value={amountLabel(account ? dashboard?.accountLocked : undefined, dashboard)} />
                  <Metric compact label="Your matured" value={amountLabel(account ? dashboard?.accountMatured : undefined, dashboard)} />
                </div>
              </section>

              <section class="rounded-lg border border-neutral-300 bg-white p-4">
                <h2 class="text-lg font-semibold">Address lookup</h2>
                <div class="mt-4 flex gap-2">
                  <input
                    class="h-11 min-w-0 flex-1 rounded-md border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-950"
                    onInput={(event) => setLookupAddress(event.currentTarget.value)}
                    placeholder="0x..."
                    value={lookupAddress}
                  />
                  <button
                    class="h-11 rounded-md border border-neutral-950 px-4 text-sm font-semibold"
                    onClick={() => refresh().catch((error: unknown) => setStatus(errorMessage(error)))}
                    type="button"
                  >
                    Check
                  </button>
                </div>
                <div class="mt-4 grid gap-3">
                  <Metric compact label="Locked" value={amountLabel(dashboard?.lookupLocked, dashboard)} />
                  <Metric compact label="Matured still locked" value={amountLabel(dashboard?.lookupMatured, dashboard)} />
                </div>
              </section>
            </div>

            <section class="rounded-lg border border-neutral-300 bg-white">
              <div class="flex flex-col gap-3 border-b border-neutral-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <h2 class="text-lg font-semibold">Your positions</h2>
                <button
                  class="h-10 rounded-md border border-neutral-950 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!account || maturePositions.length === 0 || busy}
                  onClick={() => run('Withdrawing matured positions...', () => withdrawAllMatured(provider!, config.lockAddress, account))}
                  type="button"
                >
                  Withdraw all matured
                </button>
              </div>

              <div class="divide-y divide-neutral-200">
                {dashboard?.positions.length ? (
                  dashboard.positions.map((position) => (
                    <article class="grid gap-3 p-4 md:grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center" key={position.id.toString()}>
                      <div class="text-sm font-semibold">#{position.id.toString()}</div>
                      <div>
                        <p class="text-sm font-medium">{formatUnits(position.amount, dashboard.decimals)} {dashboard.symbol}</p>
                        <p class="text-xs text-neutral-600">Locked {formatDate(position.lockedAt)}</p>
                      </div>
                      <div>
                        <p class="text-sm font-medium">{position.withdrawn ? 'Withdrawn' : position.unlockAt <= nowSeconds() ? 'Matured' : 'Locked'}</p>
                        <p class="text-xs text-neutral-600">Unlocks {formatDate(position.unlockAt)}</p>
                      </div>
                      <button
                        class="h-10 rounded-md bg-neutral-950 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={position.withdrawn || position.unlockAt > nowSeconds() || busy}
                        onClick={() => run('Withdrawing position...', () => withdrawPosition(provider!, config.lockAddress, account, position.id))}
                        type="button"
                      >
                        Withdraw
                      </button>
                    </article>
                  ))
                ) : (
                  <p class="p-4 text-sm text-neutral-600">No connected-wallet positions loaded.</p>
                )}
              </div>
            </section>
          </section>

          <aside class="rounded-lg border border-neutral-950 bg-neutral-950 p-4 text-white">
            <h2 class="text-lg font-semibold">Status</h2>
            <p class="mt-3 text-sm leading-6 text-neutral-300">{status}</p>
            {txHash && (
              <a class="mt-4 inline-flex text-sm font-semibold text-emerald-300" href={explorerTxUrl(txHash)} rel="noreferrer" target="_blank">
                View transaction
              </a>
            )}
            <div class="mt-6 space-y-3 text-sm text-neutral-300">
              <p>Network: {chainLabel()}</p>
              <p>Token: {shortOrUnset(config.tokenAddress)}</p>
              <p>Lock: {shortOrUnset(config.lockAddress)}</p>
            </div>
          </aside>
        </div>
      </section>
    </section>
  )
}

function Metric({ compact = false, label, value }: { compact?: boolean; label: string; value: string }) {
  return (
    <div class={`${compact ? 'rounded-md p-3' : 'rounded-lg p-4'} border border-neutral-300 bg-white`}>
      <p class="text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p class={`${compact ? 'text-lg' : 'text-2xl'} mt-1 break-words font-semibold text-neutral-950`}>{value}</p>
    </div>
  )
}

function amountLabel(value: bigint | undefined, dashboard: Dashboard | null): string {
  if (value === undefined || !dashboard) return '-'
  return `${formatUnits(value, dashboard.decimals)} ${dashboard.symbol}`
}

function shortOrUnset(value: string): string {
  return isAddress(value) ? shortAddress(value) : 'not set'
}

function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000))
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return 'Request failed.'
}
