import bs58 from 'bs58'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { formatTestcoinAllocation } from './claim-format'
import { connectSolanaWallet, NO_SOLANA_WALLET_MESSAGE, type SolanaWallet } from './solana-wallet'

type ConfigResponse = {
  missingRuntimeEnv: string[]
}

type AllocationResponse = {
  eligible: boolean
  solanaAddress: string
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
  const [solanaWallet, setSolanaWallet] = useState<SolanaWallet | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

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

  useEffect(() => {
    if (!solanaWallet?.on) return undefined

    const clearSolanaState = (value?: unknown) => {
      const nextPublicKey = publicKeyFromWalletEvent(value)
      setWalletAddress(nextPublicKey)
      setAllocation(null)
      setClaim(null)
    }

    const cleanupAccount = solanaWallet.on('accountChanged', clearSolanaState)
    const cleanupDisconnect = solanaWallet.on('disconnect', () => clearSolanaState())
    return () => {
      cleanupAccount()
      cleanupDisconnect()
    }
  }, [solanaWallet])

  async function getSolanaPublicKey() {
    const connection = await connectSolanaWallet()
    setSolanaWallet(connection.wallet)

    if (walletAddress !== connection.publicKey) {
      setAllocation(null)
      setClaim(null)
    }

    setWalletAddress(connection.publicKey)
    return connection
  }

  async function signMessage(message: string, wallet = solanaWallet) {
    if (!wallet) {
      throw new Error(NO_SOLANA_WALLET_MESSAGE)
    }

    const signature = await wallet.signMessage(message)
    return bs58.encode(signature)
  }

  async function checkAllocation() {
    setError('')
    setBusy('allocation')

    try {
      const { publicKey, wallet } = await getSolanaPublicKey()
      const proof = await api<AllocationMessageResponse>('/api/claim/allocation-message', {
        method: 'POST',
        body: JSON.stringify({ solanaAddress: publicKey }),
      })
      const signatureBase58 = await signMessage(proof.message, wallet)
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
      const connection = walletAddress && solanaWallet ? { publicKey: walletAddress, wallet: solanaWallet } : await getSolanaPublicKey()
      const nextChallenge = await api<ChallengeResponse>('/api/claim/challenges', {
        method: 'POST',
        body: JSON.stringify({ solanaAddress: connection.publicKey, evmRecipient: recipient }),
      })
      const result = await api<SubmitResponse>('/api/claim/submit', {
        method: 'POST',
        body: JSON.stringify({
          challengeId: nextChallenge.challengeId,
          solanaAddress: connection.publicKey,
          evmRecipient: recipient,
          signatureBase58: await signMessage(nextChallenge.message, connection.wallet),
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
    <section class="min-w-0 w-[calc(100vw-2rem)] rounded-lg border border-neutral-300 bg-white p-4 shadow-sm md:w-auto">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-xl font-semibold">Claim $testcoin</h1>
        <StatusPill status={status} />
      </div>

      <div class="mt-4 grid min-w-0 gap-3">
        <button
          class="h-11 min-w-0 max-w-full rounded-md bg-neutral-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
          disabled={busy === 'allocation'}
          onClick={checkAllocation}
          type="button"
        >
          {busy === 'allocation' ? 'Checking allocation' : walletAddress ? 'Check allocation again' : 'Connect and check allocation'}
        </button>

        <dl class="grid min-w-0 gap-3 sm:grid-cols-2">
          <Metric label="Solana wallet" value={shorten(walletAddress || allocation?.solanaAddress)} />
          <Metric label="Allocation" value={allocationAmount(allocation)} />
          <Metric label="Claim status" value={claim?.status ?? status} />
          <Metric label="Transaction" value={claim?.txHash ? shorten(claim.txHash, 10, 8) : '...'} />
        </dl>

        <label class="grid min-w-0 gap-2 text-sm font-medium">
          Base recipient
          <input
            class="h-11 min-w-0 max-w-full rounded-md border border-neutral-300 bg-white px-3 font-mono text-sm outline-none ring-emerald-600 transition focus:ring-2"
            onInput={(event) => {
              setRecipient(event.currentTarget.value)
            }}
            placeholder="0x..."
            value={recipient}
          />
        </label>

        <button
          class="h-11 min-w-0 max-w-full rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
          disabled={!canClaim || busy === 'challenge'}
          onClick={claimToRecipient}
          type="button"
        >
          {busy === 'challenge' ? 'Signing claim' : 'Claim to address'}
        </button>

        {claim?.evmRecipient && (
          <div class="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <Metric label="Recipient" value={shorten(claim.evmRecipient, 8, 8)} />
          </div>
        )}

        {missingConfig.length > 0 && (
          <div class="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
            Backend setup is incomplete.
          </div>
        )}

        {error && <div class="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>}
      </div>
    </section>
  )
}

function allocationAmount(allocation: AllocationResponse | null): string {
  if (!allocation) return '...'
  if (!allocation.eligible) return formatTestcoinAllocation('0')
  return allocation.claimAmountRaw ? formatTestcoinAllocation(allocation.claimAmountRaw) : '...'
}

function StatusPill({ status }: { status: string }) {
  const tone = status === 'sent' || status === 'eligible' ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-200 text-neutral-700'
  return <span class={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{status}</span>
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt class="text-xs font-semibold uppercase text-neutral-500">{label}</dt>
      <dd class="mt-1 break-words font-mono text-xs leading-5 text-neutral-950 sm:text-sm">{value}</dd>
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

function publicKeyFromWalletEvent(value: unknown) {
  if (!value) return ''
  if (typeof value === 'string') return value

  if (typeof value === 'object' && 'toBase58' in value && typeof value.toBase58 === 'function') {
    return value.toBase58()
  }

  if (typeof value === 'object' && 'publicKey' in value) {
    return publicKeyFromWalletEvent(value.publicKey)
  }

  return ''
}
