import { useEffect, useState } from 'preact/hooks'
import { App as ClaimApp } from './claim-app'
import { getBoroLaunchConfig } from './launch-config'
import { App as LockApp } from './lock-app'

export function App() {
  return (
    <main class="min-h-svh bg-[#f7f7f4] text-neutral-950">
      <div class="mx-auto grid max-w-full grid-cols-1 gap-4 px-4 py-4 md:max-w-7xl md:px-6 lg:px-8">
        <header class="grid gap-3 py-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <p class="text-xs font-semibold uppercase text-neutral-500">Borodutch Tools</p>
            <h1 class="mt-1 text-3xl font-semibold">Everything borodutch-crypto related</h1>
          </div>
          <BoroContractAddress />
        </header>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)] lg:items-start">
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ClaimApp />
            <LockApp />
          </div>
          <LaunchTweet />
        </div>
      </div>
    </main>
  )
}

function LaunchTweet() {
  useEffect(() => {
    const widgets = (window as typeof window & { twttr?: { widgets?: { load: () => void } } }).twttr?.widgets
    if (widgets) {
      widgets.load()
      return
    }

    if (document.getElementById('twitter-widgets-js')) return

    const script = document.createElement('script')
    script.id = 'twitter-widgets-js'
    script.async = true
    script.charset = 'utf-8'
    script.src = 'https://platform.twitter.com/widgets.js'
    document.body.appendChild(script)
  }, [])

  return (
    <section class="min-w-0 overflow-hidden rounded-lg border border-neutral-300 bg-white p-3 shadow-sm lg:sticky lg:top-4">
      <blockquote class="twitter-tweet mx-auto" data-dnt="true" data-theme="light">
        <a href="https://x.com/backmeupplz/status/2059067753684963349">BORO launch explanation on X</a>
      </blockquote>
    </section>
  )
}

function BoroContractAddress() {
  const [copied, setCopied] = useState(false)
  const config = getBoroLaunchConfig()

  async function copyAddress() {
    if (!config.tokenConfigured) return
    await navigator.clipboard.writeText(config.tokenAddress)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <aside class="min-w-0 rounded-lg border border-neutral-300 bg-white p-3 shadow-sm">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <span class="text-xs font-semibold uppercase text-neutral-500">$BORO contract</span>
        <span class="rounded-full bg-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-700">Base mainnet</span>
      </div>

      {config.tokenConfigured ? (
        <div class="mt-2 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
          <a
            class="min-w-0 break-all font-mono text-sm font-semibold text-emerald-700"
            href={config.tokenExplorerUrl}
            rel="noreferrer"
            target="_blank"
            title={config.tokenAddress}
          >
            {config.tokenAddress}
          </a>
          <button
            class="h-9 rounded-md border border-neutral-300 px-3 text-sm font-semibold"
            onClick={copyAddress}
            type="button"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <a
            class="inline-flex h-9 items-center rounded-md bg-neutral-950 px-3 text-sm font-semibold text-white"
            href={config.tokenExplorerUrl}
            rel="noreferrer"
            target="_blank"
          >
            Basescan
          </a>
        </div>
      ) : (
        <p class="mt-2 text-sm text-neutral-700">Contract address pending confirmation.</p>
      )}
    </aside>
  )
}
