import { getBoroLaunchConfig, shortAddress } from './launch-config'

export function App() {
  const config = getBoroLaunchConfig()

  return (
    <section class="min-w-0 w-[calc(100vw-2rem)] rounded-lg border border-neutral-300 bg-white p-4 shadow-sm md:w-auto">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold">Claim $BORO</h1>
          <p class="mt-1 text-xs font-medium uppercase text-neutral-500">Base mainnet</p>
        </div>
        <StatusPill status="pending" />
      </div>

      <div class="mt-4 grid min-w-0 gap-3">
        <dl class="grid min-w-0 gap-3 sm:grid-cols-2">
          <Metric label="Network" value="Base mainnet" />
          <Metric label="Claim method" value="Merkle distributor" />
          <Metric
            label="$BORO contract"
            value={config.tokenConfigured ? shortAddress(config.tokenAddress) : 'Pending confirmation'}
            href={config.tokenConfigured ? config.tokenExplorerUrl : undefined}
          />
          <Metric label="Claim status" value="Pending launch" />
        </dl>

        <button
          class="h-11 min-w-0 max-w-full rounded-md bg-neutral-300 px-4 text-sm font-semibold text-neutral-600"
          disabled
          type="button"
        >
          Claims pending
        </button>

        <div class="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm leading-6 text-neutral-700">
          Claims open after the Base mainnet distributor, funding transaction, and proof source are verified.
        </div>
      </div>
    </section>
  )
}

function StatusPill({ status }: { status: string }) {
  return <span class="inline-flex rounded-full bg-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-700">{status}</span>
}

function Metric({ href, label, value }: { href?: string; label: string; value: string }) {
  return (
    <div>
      <dt class="text-xs font-semibold uppercase text-neutral-500">{label}</dt>
      <dd class="mt-1 break-words font-mono text-xs leading-5 text-neutral-950 sm:text-sm">
        {href ? (
          <a class="font-semibold text-emerald-700" href={href} rel="noreferrer" target="_blank">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}
