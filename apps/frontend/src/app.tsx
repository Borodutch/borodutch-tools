import { useState } from 'preact/hooks'
import { boroTokenBasescanUrl, configuredBoroTokenAddress } from './boro-address'
import { App as ClaimApp } from './claim-app'
import { shortAddress } from './evm'
import { App as LockApp } from './lock-app'

const boroTokenAddress = configuredBoroTokenAddress(import.meta.env.VITE_BORO_TOKEN_ADDRESS)

export function App() {
  return (
    <main class="min-h-svh bg-[#f7f7f4] text-neutral-950">
      <div class="mx-auto grid max-w-full grid-cols-1 gap-4 px-4 py-4 md:max-w-6xl md:grid-cols-2 md:px-6 lg:px-8">
        <ClaimApp />
        <LockApp />
        <BoroAddressCard />
      </div>
    </main>
  )
}

function BoroAddressCard() {
  const [copied, setCopied] = useState(false)

  async function copyAddress() {
    if (!boroTokenAddress || !navigator.clipboard) return

    await navigator.clipboard.writeText(boroTokenAddress)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <section class="min-w-0 rounded-lg border border-neutral-300 bg-white p-4 shadow-sm md:col-span-2">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold">$BORO contract</h2>
          <p class="mt-1 text-sm text-neutral-600">Base mainnet</p>
        </div>
        {boroTokenAddress ? (
          <a
            class="rounded-md border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-900 hover:border-neutral-950"
            href={boroTokenBasescanUrl(boroTokenAddress)}
            rel="noreferrer"
            target="_blank"
          >
            Basescan
          </a>
        ) : (
          <span class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
            Pending deployment
          </span>
        )}
      </div>

      {boroTokenAddress ? (
        <div class="mt-4 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <code class="min-w-0 break-all rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 font-mono text-sm text-neutral-950">
            {boroTokenAddress}
          </code>
          <button
            class="h-10 rounded-md bg-neutral-950 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:text-neutral-600"
            disabled={!navigator.clipboard}
            onClick={copyAddress}
            type="button"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : (
        <p class="mt-4 text-sm text-neutral-700">
          The confirmed Base mainnet contract address will appear here after the $BORO deployment is recorded.
        </p>
      )}

      {boroTokenAddress && <p class="mt-3 text-sm text-neutral-600">{shortAddress(boroTokenAddress)} is the configured production token address.</p>}
    </section>
  )
}
