import bs58 from 'bs58'
import { useEffect, useMemo, useState } from 'preact/hooks'

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

type AllocationMessageResponse = {
  solanaAddress: string
  message: string
  messageDigest: string
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
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  const [walletAddress, setWalletAddress] = useState('')
  const [recipient, setRecipient] = useState('')
  const [allocation, setAllocation] = useState<AllocationResponse | null>(null)
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

  async function getSolanaPublicKey() {
    if (!provider) {
      throw new Error('No Solana wallet found in this browser.')
    }

    const connection = await provider.connect()
    const publicKey = connection.publicKey?.toBase58() ?? provider.publicKey?.toBase58()

    if (!publicKey) {
      throw new Error('Wallet did not return a Solana public key.')
    }

    setWalletAddress(publicKey)
    return publicKey
  }

  async function signMessage(message: string) {
    if (!provider) {
      throw new Error('No Solana wallet found in this browser.')
    }

    const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8')
    const signature = signed instanceof Uint8Array ? signed : signed.signature
    return bs58.encode(signature)
  }

  async function checkAllocation() {
    setError('')
    setBusy('allocation')

    try {
      const publicKey = await getSolanaPublicKey()
      const proof = await api<AllocationMessageResponse>('/api/claim/allocation-message', {
        method: 'POST',
        body: JSON.stringify({ solanaAddress: publicKey }),
      })
      const signatureBase58 = await signMessage(proof.message)
      const nextAllocation = await api<AllocationResponse>('/api/claim/allocation-check', {
        method: 'POST',
        body: JSON.stringify({ solanaAddress: publicKey, signatureBase58 }),
      })
      setAllocation(nextAllocation)
      setClaim(nextAllocation.existingClaim ?? null)
    } catch (connectError) {
      setError(messageForError(connectError))
    } finally {
      setBusy('')
    }
  }

  async function claimToRecipient() {
    setError('')
    setClaim(null)
    setBusy('challenge')

    try {
      const publicKey = walletAddress || (await getSolanaPublicKey())
      const nextChallenge = await api<ChallengeResponse>('/api/claim/challenges', {
        method: 'POST',
        body: JSON.stringify({ solanaAddress: publicKey, evmRecipient: recipient }),
      })
      const result = await api<SubmitResponse>('/api/claim/submit', {
        method: 'POST',
        body: JSON.stringify({
          challengeId: nextChallenge.challengeId,
          solanaAddress: publicKey,
          evmRecipient: recipient,
          signatureBase58: await signMessage(nextChallenge.message),
        }),
      })

      setClaim(result.claim)
    } catch (challengeError) {
      setError(messageForError(challengeError))
    } finally {
      setBusy('')
    }
  }

  return (
    <section class="bg-[#f6f4ef] text-neutral-950">
      <div class="mx-auto grid w-full max-w-7xl grid-cols-1 gap-6 px-4 py-5 md:grid-cols-[320px_1fr] md:px-6 lg:px-8">
        <aside class="border-b border-neutral-300 pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6">
          <div class="flex items-center justify-between gap-3 md:block">
            <div>
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
                  disabled={busy === 'allocation'}
                  onClick={checkAllocation}
                  type="button"
                >
                  {busy === 'allocation' ? 'Checking' : walletAddress ? 'Check allocation again' : 'Check allocation'}
                </button>
              </div>

              <div class="mt-6 grid gap-4">
                <label class="grid gap-2 text-sm font-medium">
                  Base Sepolia recipient
                  <input
                    class="h-12 rounded-md border border-neutral-300 bg-white px-3 font-mono text-sm outline-none ring-emerald-600 transition focus:ring-2"
                    onInput={(event) => {
                      setRecipient(event.currentTarget.value)
                    }}
                    placeholder="0x..."
                    value={recipient}
                  />
                </label>

                <div class="flex flex-wrap gap-3">
                  <button
                    class="rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
                    disabled={!canClaim || busy === 'challenge'}
                    onClick={claimToRecipient}
                    type="button"
                  >
                    {busy === 'challenge' ? 'Signing claim' : 'Claim to address'}
                  </button>
                </div>
              </div>
            </div>

            <AllocationPanel allocation={allocation} claim={claim} />
          </section>

          {claim && <ClaimPanel claim={claim} />}
          {error && <div class="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">{error}</div>}
        </div>
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
