import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import {
  approveToken,
  connectWallet,
  ensureBaseSepolia,
  explorerTxUrl,
  formatUnits,
  getConnectedAccount,
  getLockConfig,
  isAddress,
  lockToken,
  parseUnits,
  readAllowance,
  readLockedAmount,
  readTokenBalance,
  readTokenDetails,
  shortAddress,
} from './evm'

type WalletState = {
  allowance: bigint
  balance: bigint
  decimals: number
  locked: bigint
  symbol: string
}

const config = getLockConfig()

export function App() {
  const provider = typeof window !== 'undefined' ? window.ethereum : undefined
  const [account, setAccount] = useState('')
  const [lockAmount, setLockAmount] = useState('')
  const [walletState, setWalletState] = useState<WalletState | null>(null)
  const [status, setStatus] = useState('Connect an EVM wallet.')
  const [txHash, setTxHash] = useState('')
  const [busy, setBusy] = useState(false)

  const configured = isAddress(config.tokenAddress) && isAddress(config.lockAddress)
  const parsedLockAmount = useMemo(() => {
    if (!walletState || !lockAmount.trim()) return 0n
    try {
      return parseUnits(lockAmount, walletState.decimals)
    } catch {
      return 0n
    }
  }, [lockAmount, walletState])
  const needsApproval = parsedLockAmount > 0n && walletState ? walletState.allowance < parsedLockAmount : false

  const refresh = useCallback(
    async (accountOverride?: string) => {
      if (!provider) {
        setStatus('No injected EVM wallet detected.')
        return
      }

      if (!configured) {
        setStatus('Set VITE_BASE_SEPOLIA_TESTCOIN_ADDRESS and VITE_TESTCOIN_LOCK_ADDRESS.')
        return
      }

      const connected = accountOverride === undefined ? account || (await getConnectedAccount(provider)) || '' : accountOverride
      if (!connected) {
        setStatus('Connect an EVM wallet.')
        setWalletState(null)
        if (account) setAccount('')
        return
      }

      if (connected !== account) setAccount(connected)

      const details = await readTokenDetails(provider, config.tokenAddress)
      const [balance, allowance, locked] = await Promise.all([
        readTokenBalance(provider, config.tokenAddress, connected),
        readAllowance(provider, config.tokenAddress, connected, config.lockAddress),
        readLockedAmount(provider, config.lockAddress, connected),
      ])

      setWalletState({
        allowance,
        balance,
        decimals: details.decimals,
        locked,
        symbol: details.symbol,
      })
      setStatus(`Connected as ${shortAddress(connected)}.`)
    },
    [account, configured, provider],
  )

  useEffect(() => {
    refresh().catch((error: unknown) => setStatus(errorMessage(error)))
  }, [refresh])

  useEffect(() => {
    if (!provider?.on || !provider.removeListener) return undefined

    const handleAccounts = (accounts: unknown) => {
      const nextAccount = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : ''
      setAccount(nextAccount)
      setTxHash('')
      refresh(nextAccount).catch((error: unknown) => setStatus(errorMessage(error)))
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

  async function connect() {
    if (!provider) return

    setBusy(true)
    setStatus('Connecting wallet...')
    setTxHash('')

    try {
      const connected = await connectWallet(provider)
      await refresh(connected)
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function submitLockAction() {
    if (!provider || !account || parsedLockAmount <= 0n) return

    setBusy(true)
    setStatus(needsApproval ? 'Submitting approval...' : 'Submitting lock...')
    setTxHash('')

    try {
      await ensureBaseSepolia(provider, config.rpcUrl)
      const hash = needsApproval
        ? await approveToken(provider, config.tokenAddress, account, config.lockAddress, parsedLockAmount)
        : await lockToken(provider, config.lockAddress, account, parsedLockAmount)
      setTxHash(hash)
      setStatus(needsApproval ? 'Approval submitted.' : 'Lock submitted.')
      await refresh()
    } catch (error) {
      setStatus(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="min-w-0 w-[calc(100vw-2rem)] rounded-lg border border-neutral-300 bg-white p-4 shadow-sm md:w-auto">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-xl font-semibold">Lock $testcoin</h1>
        <button
          class="h-10 rounded-md bg-neutral-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
          disabled={!provider || busy}
          onClick={connect}
          type="button"
        >
          {account ? shortAddress(account) : 'Connect wallet'}
        </button>
      </div>

      <div class="mt-4 grid min-w-0 gap-3">
        <dl class="grid min-w-0 gap-3 sm:grid-cols-2">
          <Metric label="Available" value={amountLabel(walletState?.balance, walletState)} />
          <Metric label="Currently locked" value={amountLabel(walletState?.locked, walletState)} />
        </dl>

        <label class="grid min-w-0 gap-2 text-sm font-medium">
          Amount
          <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              class="h-11 min-w-0 max-w-full rounded-md border border-neutral-300 px-3 text-base outline-none focus:border-neutral-950"
              inputMode="decimal"
              onInput={(event) => setLockAmount(event.currentTarget.value)}
              placeholder="0.0"
              value={lockAmount}
            />
            <button
              class="h-11 rounded-md border border-neutral-300 px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!walletState || walletState.balance <= 0n || busy}
              onClick={() => walletState && setLockAmount(formatUnits(walletState.balance, walletState.decimals))}
              type="button"
            >
              Max
            </button>
          </div>
        </label>

        <button
          class="h-11 min-w-0 max-w-full rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
          disabled={!account || !configured || parsedLockAmount <= 0n || busy}
          onClick={submitLockAction}
          type="button"
        >
          {busy ? 'Working' : needsApproval ? 'Approve' : 'Lock'}
        </button>

        <div class="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          {status}
          {txHash && (
            <a class="ml-2 font-semibold text-emerald-700" href={explorerTxUrl(txHash)} rel="noreferrer" target="_blank">
              View transaction
            </a>
          )}
        </div>
      </div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt class="text-xs font-semibold uppercase text-neutral-500">{label}</dt>
      <dd class="mt-1 break-all font-mono text-sm text-neutral-950">{value}</dd>
    </div>
  )
}

function amountLabel(value: bigint | undefined, walletState: WalletState | null): string {
  if (value === undefined || !walletState) return '-'
  return `${formatUnits(value, walletState.decimals)} ${walletState.symbol}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return 'Request failed.'
}
