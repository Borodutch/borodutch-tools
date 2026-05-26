import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import {
  approveToken,
  chainLabel,
  connectWallet,
  createEvmWalletStore,
  type EthereumProvider,
  type EvmWalletOption,
  ensureConfiguredChain,
  explorerTxUrl,
  formatUnits,
  getConnectedAccount,
  getEvmWalletOptions,
  getLockConfig,
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
const evmWalletStore = createEvmWalletStore()

export function App() {
  const [walletOptions, setWalletOptions] = useState<EvmWalletOption[]>([])
  const [selectedProvider, setSelectedProvider] = useState<EthereumProvider | null>(null)
  const [walletPickerOpen, setWalletPickerOpen] = useState(false)
  const [account, setAccount] = useState('')
  const [lockAmount, setLockAmount] = useState('')
  const [walletState, setWalletState] = useState<WalletState | null>(null)
  const [status, setStatus] = useState('Connect an EVM wallet.')
  const [txHash, setTxHash] = useState('')
  const [busy, setBusy] = useState(false)

  const configured = config.configured
  const provider = selectedProvider ?? (walletOptions.length === 1 ? walletOptions[0]?.provider : undefined)
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
    async (accountOverride?: string, providerOverride = provider) => {
      if (!providerOverride) {
        setStatus('No injected EVM wallet detected.')
        return
      }

      if (!configured) {
        setStatus('Lock contract pending.')
        return
      }

      const connected =
        accountOverride === undefined ? account || (await getConnectedAccount(providerOverride)) || '' : accountOverride
      if (!connected) {
        setStatus('Connect an EVM wallet.')
        setWalletState(null)
        if (account) setAccount('')
        return
      }

      if (connected !== account) setAccount(connected)

      const details = await readTokenDetails(providerOverride, config.tokenAddress)
      const [balance, allowance, locked] = await Promise.all([
        readTokenBalance(providerOverride, config.tokenAddress, connected),
        readAllowance(providerOverride, config.tokenAddress, connected, config.lockAddress),
        readLockedAmount(providerOverride, config.lockAddress, connected),
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
    const updateWalletOptions = () => setWalletOptions(getEvmWalletOptions(window, evmWalletStore.getProviders()))

    updateWalletOptions()
    return evmWalletStore.subscribe(() => updateWalletOptions())
  }, [])

  useEffect(() => {
    if (!selectedProvider && walletOptions.length === 1) {
      refresh().catch((error: unknown) => setStatus(errorMessage(error)))
      return
    }

    if (!selectedProvider && walletOptions.length > 1) {
      setStatus('Choose an EVM wallet.')
      return
    }

    refresh().catch((error: unknown) => setStatus(errorMessage(error)))
  }, [refresh, selectedProvider, walletOptions.length])

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

  async function connect(nextProvider = provider) {
    if (!selectedProvider && walletOptions.length > 1 && !nextProvider) {
      setWalletPickerOpen(true)
      return
    }
    if (!nextProvider) return

    setBusy(true)
    setStatus('Connecting wallet...')
    setTxHash('')

    try {
      setSelectedProvider(nextProvider)
      setWalletPickerOpen(false)
      const connected = await connectWallet(nextProvider)
      await refresh(connected, nextProvider)
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
      await ensureConfiguredChain(provider, config)
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
        <div>
          <h1 class="text-xl font-semibold">Lock $BORO</h1>
          <p class="mt-1 text-xs font-medium uppercase text-neutral-500">{chainLabel(config)}</p>
        </div>
        <button
          class="h-10 rounded-md bg-neutral-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
          disabled={walletOptions.length === 0 || busy}
          onClick={() => connect()}
          type="button"
        >
          {account ? shortAddress(account) : 'Connect wallet'}
        </button>
      </div>

      {walletPickerOpen && (
        <div class="mt-4 grid gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <div class="text-xs font-semibold uppercase text-neutral-500">Choose EVM wallet</div>
          <div class="grid gap-2 sm:grid-cols-2">
            {walletOptions.map((wallet) => (
              <button
                class="flex h-11 items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-left text-sm font-semibold text-neutral-950 hover:border-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy}
                key={wallet.id}
                onClick={() => connect(wallet.provider)}
                type="button"
              >
                {wallet.icon && <img alt="" class="h-5 w-5 shrink-0 rounded-sm" src={wallet.icon} />}
                <span class="min-w-0 truncate">{wallet.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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
