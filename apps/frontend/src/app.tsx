import bs58 from 'bs58'
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

type Snapshot = {
  mint: string
  supplyRaw: string
  supply: string
  heliusLastIndexedSlot: number
  uniqueHolders: number
}

type ConfigResponse = {
  chainId: number
  snapshot: Snapshot
  claimPoolRaw: string
  missingRuntimeEnv: string[]
}

type AllocationResponse = {
  eligible: boolean
  solanaAddress: string
  holder?: {
    rank: number
    amountRaw: string
    amount: string
  }
  claimAmountRaw?: string
  existingClaim?: ClaimRecord
}

type ChallengeResponse = {
  challengeId: string
  message: string
  messageDigest: string
  claimAmountRaw: string
  expiresAt: string
}

type ClaimRecord = {
  id: string
  solanaAddress: string
  evmRecipient: string
  claimAmountRaw: string
  status: 'pending' | 'sent' | 'confirmed' | 'failed'
  txHash: string | null
  errorCode: string | null
}

type SubmitResponse = {
  claim: ClaimRecord
  idempotent: boolean
}

export function App() {
  const [tool, setTool] = useState<ToolMode>(initialTool)

  useEffect(() => {
    const handleHashChange = () => setTool(initialTool())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  function selectTool(nextTool: ToolMode) {
    setTool(nextTool)
    window.history.replaceState(null, '', nextTool === 'claim' ? '#claim' : '#lock')
  }

  return (
    <main class="min-h-svh bg-[#f6f4ef] text-neutral-950">
      <header class="border-b border-neutral-300 bg-white/75">
        <div class="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6 lg:px-8">
          <div>
            <p class="text-sm font-semibold text-emerald-700">tools.borodutch.com</p>
            <h1 class="mt-1 text-2xl font-semibold leading-tight">Borodutch tools</h1>
          </div>
          <nav class="grid grid-cols-2 gap-2 rounded-md border border-neutral-300 bg-neutral-100 p-1 text-sm font-semibold">
            <button
              class={navClass(tool === 'claim')}
              onClick={() => selectTool('claim')}
              type="button"
            >
              $bdtch claim
            </button>
            <button
              class={navClass(tool === 'lock')}
              onClick={() => selectTool('lock')}
              type="button"
            >
              $testcoin lock
            </button>
          </nav>
        </div>
      </header>

      {tool === 'claim' ? <ClaimFlow /> : <LockFlow />}
    </main>
  )
}

type ToolMode = 'claim' | 'lock'

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

const lockConfig = getLockConfig()

function initialTool(): ToolMode {
  return window.location.hash === '#lock' ? 'lock' : 'claim'
}

function navClass(active: boolean) {
  return [
    'h-10 rounded px-3 transition',
    active ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-600 hover:text-neutral-950',
  ].join(' ')
}

function ClaimFlow() {
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  const [walletAddress, setWalletAddress] = useState('')
  const [recipient, setRecipient] = useState('')
  const [allocation, setAllocation] = useState<AllocationResponse | null>(null)
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null)
  const [claim, setClaim] = useState<ClaimRecord | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const provider = typeof window !== 'undefined' ? window.solana : undefined
  const missingConfig = config?.missingRuntimeEnv ?? []
  const canClaim = Boolean(allocation?.eligible && recipient && missingConfig.length === 0)

  const status = useMemo(() => {
    if (claim?.txHash) return 'sent'
    if (claim?.status === 'failed') return 'failed'
    if (allocation?.existingClaim) return 'claimed'
    if (allocation?.eligible) return 'eligible'
    if (walletAddress && allocation && !allocation.eligible) return 'ineligible'
    if (walletAddress) return 'checking'
    return 'connect'
  }, [allocation, claim, walletAddress])

  useEffect(() => {
    api<ConfigResponse>('/api/claim/config')
      .then(setConfig)
      .catch((apiError: Error) => setError(apiError.message))
  }, [])

  async function connectWallet() {
    setError('')
    setBusy('wallet')

    try {
      if (!provider) {
        throw new Error('No Solana wallet found in this browser.')
      }

      const connection = await provider.connect()
      const publicKey = connection.publicKey?.toBase58() ?? provider.publicKey?.toBase58()

      if (!publicKey) {
        throw new Error('Wallet did not return a Solana public key.')
      }

      setWalletAddress(publicKey)
      await refreshAllocation(publicKey)
    } catch (connectError) {
      setError(messageForError(connectError))
    } finally {
      setBusy('')
    }
  }

  async function refreshAllocation(solanaAddress = walletAddress) {
    if (!solanaAddress) return

    setError('')
    setBusy('allocation')

    try {
      const nextAllocation = await api<AllocationResponse>(
        `/api/claim/allocation?solanaAddress=${encodeURIComponent(solanaAddress)}`,
      )
      setAllocation(nextAllocation)
      setClaim(nextAllocation.existingClaim ?? null)
    } catch (allocationError) {
      setError(messageForError(allocationError))
    } finally {
      setBusy('')
    }
  }

  async function createChallenge() {
    setError('')
    setChallenge(null)
    setClaim(null)
    setBusy('challenge')

    try {
      const nextChallenge = await api<ChallengeResponse>('/api/claim/challenges', {
        method: 'POST',
        body: JSON.stringify({ solanaAddress: walletAddress, evmRecipient: recipient }),
      })
      setChallenge(nextChallenge)
    } catch (challengeError) {
      setError(messageForError(challengeError))
    } finally {
      setBusy('')
    }
  }

  async function signAndSubmit() {
    setError('')
    setBusy('sign')

    try {
      if (!provider || !challenge) {
        throw new Error('Connect a Solana wallet and create a claim message first.')
      }

      const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), 'utf8')
      const signature = signed instanceof Uint8Array ? signed : signed.signature
      const result = await api<SubmitResponse>('/api/claim/submit', {
        method: 'POST',
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          solanaAddress: walletAddress,
          evmRecipient: recipient,
          signatureBase58: bs58.encode(signature),
        }),
      })

      setClaim(result.claim)
      setChallenge(null)
    } catch (submitError) {
      setError(messageForError(submitError))
    } finally {
      setBusy('')
    }
  }

  return (
    <section class="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-4 py-5 md:grid-cols-[320px_1fr] md:px-6 lg:px-8">
        <aside class="border-b border-neutral-300 pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6">
          <div class="flex items-center justify-between gap-3 md:block">
            <div>
              <p class="text-sm font-semibold text-emerald-700">tools.borodutch.com</p>
              <h1 class="mt-2 text-3xl font-semibold leading-tight">$bdtch claim</h1>
            </div>
            <StatusPill status={status} />
          </div>

          <dl class="mt-6 grid grid-cols-2 gap-3 text-sm md:grid-cols-1">
            <Metric label="Snapshot holders" value={config?.snapshot.uniqueHolders.toString() ?? '...'} />
            <Metric label="Indexed slot" value={config?.snapshot.heliusLastIndexedSlot.toString() ?? '...'} />
            <Metric label="Base chain" value={config ? `${config.chainId}` : '...'} />
            <Metric label="Mint" value={shorten(config?.snapshot.mint)} />
          </dl>

          {missingConfig.length > 0 && (
            <div class="mt-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
              Backend setup is incomplete: {missingConfig.join(', ')}
            </div>
          )}
        </aside>

        <div class="grid content-start gap-5">
          <section class="grid gap-5 lg:grid-cols-[1fr_360px]">
            <div class="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 class="text-xl font-semibold">Claim Base Sepolia $testcoin</h2>
                  <p class="mt-1 text-sm leading-6 text-neutral-600">
                    Sign with the Solana wallet from the snapshot and receive the proportional test token allocation on Base Sepolia.
                  </p>
                </div>
                <button
                  class="rounded-md bg-neutral-950 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
                  disabled={busy === 'wallet'}
                  onClick={connectWallet}
                  type="button"
                >
                  {walletAddress ? shorten(walletAddress) : busy === 'wallet' ? 'Connecting' : 'Connect Solana'}
                </button>
              </div>

              <div class="mt-6 grid gap-4">
                <label class="grid gap-2 text-sm font-medium">
                  Base Sepolia recipient
                  <input
                    class="h-12 rounded-md border border-neutral-300 bg-white px-3 font-mono text-sm outline-none ring-emerald-600 transition focus:ring-2"
                    onInput={(event) => {
                      setRecipient(event.currentTarget.value)
                      setChallenge(null)
                    }}
                    placeholder="0x..."
                    value={recipient}
                  />
                </label>

                <div class="flex flex-wrap gap-3">
                  <button
                    class="rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
                    disabled={!canClaim || busy === 'challenge'}
                    onClick={createChallenge}
                    type="button"
                  >
                    {busy === 'challenge' ? 'Preparing message' : 'Prepare claim'}
                  </button>
                  <button
                    class="rounded-md border border-neutral-300 bg-white px-4 py-3 text-sm font-semibold text-neutral-900 disabled:cursor-not-allowed disabled:text-neutral-400"
                    disabled={!walletAddress || busy === 'allocation'}
                    onClick={() => refreshAllocation()}
                    type="button"
                  >
                    Refresh eligibility
                  </button>
                </div>
              </div>
            </div>

            <AllocationPanel allocation={allocation} claim={claim} />
          </section>

          {challenge && (
            <section class="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 class="text-lg font-semibold">Solana message</h2>
                  <p class="mt-1 text-sm text-neutral-600">Digest {shorten(challenge.messageDigest, 10, 10)}</p>
                </div>
                <button
                  class="rounded-md bg-neutral-950 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
                  disabled={busy === 'sign'}
                  onClick={signAndSubmit}
                  type="button"
                >
                  {busy === 'sign' ? 'Signing' : 'Sign and submit'}
                </button>
              </div>
              <textarea
                class="mt-4 min-h-80 w-full resize-y rounded-md border border-neutral-300 bg-neutral-50 p-3 font-mono text-xs leading-5 text-neutral-800"
                readOnly
                value={challenge.message}
              />
            </section>
          )}

          {claim && <ClaimPanel claim={claim} />}
          {error && <div class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">{error}</div>}
        </div>
    </section>
  )
}

function LockFlow() {
  const provider = typeof window !== 'undefined' ? window.ethereum : undefined
  const [account, setAccount] = useState('')
  const [lookupAddress, setLookupAddress] = useState('')
  const [lockAmount, setLockAmount] = useState('')
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [status, setStatus] = useState('Connect an EVM wallet to Base Sepolia.')
  const [txHash, setTxHash] = useState('')
  const [busy, setBusy] = useState(false)

  const configured = isAddress(lockConfig.tokenAddress) && isAddress(lockConfig.lockAddress)
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
    const details = await readTokenDetails(provider, lockConfig.tokenAddress)
    const [totalLocked, globalMatured, activePositionCount] = await Promise.all([
      readTotalLocked(provider, lockConfig.lockAddress),
      readMaturedLockedTotal(provider, lockConfig.lockAddress, lockConfig.maturedPageSize),
      readActivePositionCount(provider, lockConfig.lockAddress),
    ])

    const [lookupLocked, lookupMatured] = lookup
      ? await Promise.all([
          readLockedAmount(provider, lockConfig.lockAddress, lookup),
          readMaturedAmount(provider, lockConfig.lockAddress, lookup),
        ])
      : [0n, 0n]

    const [balance, allowance, accountLocked, accountMatured, positions] = connected
      ? await Promise.all([
          readTokenBalance(provider, lockConfig.tokenAddress, connected),
          readAllowance(provider, lockConfig.tokenAddress, connected, lockConfig.lockAddress),
          readLockedAmount(provider, lockConfig.lockAddress, connected),
          readMaturedAmount(provider, lockConfig.lockAddress, connected),
          readPositions(provider, lockConfig.lockAddress, connected),
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
    refresh().catch((error: unknown) => setStatus(messageForError(error)))
  }, [refresh])

  useEffect(() => {
    if (!provider?.on || !provider.removeListener) return undefined

    const handleAccounts = (accounts: unknown) => {
      setAccount(Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : '')
      setTxHash('')
    }
    const handleChain = () => {
      refresh().catch((error: unknown) => setStatus(messageForError(error)))
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
      await ensureBaseSepolia(provider, lockConfig.rpcUrl)
      const hash = await action()
      if (hash) setTxHash(hash)
      setStatus(hash ? 'Transaction submitted.' : 'Updated.')
      await refresh()
    } catch (error) {
      setStatus(messageForError(error))
    } finally {
      setBusy(false)
    }
  }

  const needsApproval = parsedLockAmount > 0n && dashboard ? dashboard.allowance < parsedLockAmount : false
  const maturePositions =
    dashboard?.positions.filter((position) => !position.withdrawn && position.unlockAt <= nowSeconds()) ?? []

  return (
    <section class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 md:px-6 lg:px-8">
      <div class="flex flex-col gap-4 border-b border-neutral-300 pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 class="text-3xl font-semibold md:text-4xl">$testcoin one-year lock</h2>
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
              .catch((error: unknown) => setStatus(messageForError(error)))
          }
          type="button"
        >
          {account ? shortAddress(account) : 'Connect wallet'}
        </button>
      </div>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section class="grid gap-4">
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <LockMetric label="Global locked" value={amountLabel(dashboard?.totalLocked, dashboard)} />
            <LockMetric
              label="Global matured"
              value={`${amountLabel(dashboard?.globalMatured, dashboard)}${dashboard?.globalMaturedPartial ? '+' : ''}`}
            />
            <LockMetric label="Active positions" value={dashboard?.activePositionCount.toString() ?? '-'} />
            <LockMetric label="Wallet balance" value={amountLabel(dashboard?.balance, dashboard)} />
          </div>

          <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <section class="rounded-lg border border-neutral-300 bg-white p-4">
              <div class="flex flex-col gap-2 border-b border-neutral-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 class="text-lg font-semibold">Lock {dashboard?.symbol ?? '$testcoin'}</h3>
                  <p class="text-sm text-neutral-600">Token {shortOrUnset(lockConfig.tokenAddress)}</p>
                </div>
                <span class="text-sm font-medium text-neutral-600">
                  Lock contract {shortOrUnset(lockConfig.lockAddress)}
                </span>
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
                      approveToken(provider!, lockConfig.tokenAddress, account, lockConfig.lockAddress, parsedLockAmount),
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
                    run('Submitting lock...', () => lockToken(provider!, lockConfig.lockAddress, account, parsedLockAmount))
                  }
                  type="button"
                >
                  Lock
                </button>
              </div>

              <div class="mt-4 grid gap-3 sm:grid-cols-3">
                <LockMetric compact label="Allowance" value={amountLabel(dashboard?.allowance, dashboard)} />
                <LockMetric compact label="Your locked" value={amountLabel(account ? dashboard?.accountLocked : undefined, dashboard)} />
                <LockMetric compact label="Your matured" value={amountLabel(account ? dashboard?.accountMatured : undefined, dashboard)} />
              </div>
            </section>

            <section class="rounded-lg border border-neutral-300 bg-white p-4">
              <h3 class="text-lg font-semibold">Address lookup</h3>
              <div class="mt-4 flex gap-2">
                <input
                  class="h-11 min-w-0 flex-1 rounded-md border border-neutral-300 px-3 text-sm outline-none focus:border-neutral-950"
                  onInput={(event) => setLookupAddress(event.currentTarget.value)}
                  placeholder="0x..."
                  value={lookupAddress}
                />
                <button
                  class="h-11 rounded-md border border-neutral-950 px-4 text-sm font-semibold"
                  onClick={() => refresh().catch((error: unknown) => setStatus(messageForError(error)))}
                  type="button"
                >
                  Check
                </button>
              </div>
              <div class="mt-4 grid gap-3">
                <LockMetric compact label="Locked" value={amountLabel(dashboard?.lookupLocked, dashboard)} />
                <LockMetric compact label="Matured still locked" value={amountLabel(dashboard?.lookupMatured, dashboard)} />
              </div>
            </section>
          </div>

          <section class="rounded-lg border border-neutral-300 bg-white">
            <div class="flex flex-col gap-3 border-b border-neutral-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <h3 class="text-lg font-semibold">Your positions</h3>
              <button
                class="h-10 rounded-md border border-neutral-950 px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!account || maturePositions.length === 0 || busy}
                onClick={() => run('Withdrawing matured positions...', () => withdrawAllMatured(provider!, lockConfig.lockAddress, account))}
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
                      <p class="text-sm font-medium">
                        {formatUnits(position.amount, dashboard.decimals)} {dashboard.symbol}
                      </p>
                      <p class="text-xs text-neutral-600">Locked {formatDate(position.lockedAt)}</p>
                    </div>
                    <div>
                      <p class="text-sm font-medium">
                        {position.withdrawn ? 'Withdrawn' : position.unlockAt <= nowSeconds() ? 'Matured' : 'Locked'}
                      </p>
                      <p class="text-xs text-neutral-600">Unlocks {formatDate(position.unlockAt)}</p>
                    </div>
                    <button
                      class="h-10 rounded-md bg-neutral-950 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={position.withdrawn || position.unlockAt > nowSeconds() || busy}
                      onClick={() => run('Withdrawing position...', () => withdrawPosition(provider!, lockConfig.lockAddress, account, position.id))}
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
          <h3 class="text-lg font-semibold">Status</h3>
          <p class="mt-3 text-sm leading-6 text-neutral-300">{status}</p>
          {txHash && (
            <a class="mt-4 inline-flex text-sm font-semibold text-emerald-300" href={explorerTxUrl(txHash)} rel="noreferrer" target="_blank">
              View transaction
            </a>
          )}
          <div class="mt-6 space-y-3 text-sm text-neutral-300">
            <p>Network: {chainLabel()}</p>
            <p>Token: {shortOrUnset(lockConfig.tokenAddress)}</p>
            <p>Lock: {shortOrUnset(lockConfig.lockAddress)}</p>
          </div>
        </aside>
      </div>
    </section>
  )
}

function AllocationPanel({ allocation, claim }: { allocation: AllocationResponse | null; claim: ClaimRecord | null }) {
  return (
    <section class="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
      <h2 class="text-lg font-semibold">Eligibility</h2>
      <div class="mt-5 grid gap-4">
        <Metric label="Wallet" value={shorten(allocation?.solanaAddress)} />
        <Metric label="$bdtch balance" value={allocation?.holder?.amount ?? 'Connect wallet'} />
        <Metric label="Snapshot rank" value={allocation?.holder ? `#${allocation.holder.rank}` : '...'} />
        <Metric label="$testcoin raw" value={allocation?.claimAmountRaw ?? '...'} />
      </div>
      {claim && (
        <div class="mt-5 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
          Claim status: {claim.status}
          {claim.txHash ? ` (${shorten(claim.txHash, 10, 8)})` : ''}
        </div>
      )}
    </section>
  )
}

function ClaimPanel({ claim }: { claim: ClaimRecord }) {
  return (
    <section class="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
      <h2 class="text-lg font-semibold">Submitted claim</h2>
      <dl class="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <Metric label="Status" value={claim.status} />
        <Metric label="Recipient" value={shorten(claim.evmRecipient, 8, 8)} />
        <Metric label="Amount raw" value={claim.claimAmountRaw} />
        <Metric label="Transaction" value={claim.txHash ? shorten(claim.txHash, 10, 10) : 'pending'} />
      </dl>
    </section>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone = status === 'sent' || status === 'eligible' ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-200 text-neutral-700'
  return <span class={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{status}</span>
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt class="text-xs font-semibold uppercase text-neutral-500">{label}</dt>
      <dd class="mt-1 break-all font-mono text-sm text-neutral-950">{value}</dd>
    </div>
  )
}

function LockMetric({ compact = false, label, value }: { compact?: boolean; label: string; value: string }) {
  return (
    <div class={`${compact ? 'rounded-md p-3' : 'rounded-lg p-4'} border border-neutral-300 bg-white`}>
      <p class="text-xs font-semibold uppercase text-neutral-500">{label}</p>
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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  const body = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(body.message ?? body.error ?? 'Request failed')
  }

  return body as T
}

function shorten(value?: string, start = 6, end = 4) {
  if (!value) return '...'
  if (value.length <= start + end + 3) return value
  return `${value.slice(0, start)}...${value.slice(-end)}`
}

function messageForError(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error'
}
